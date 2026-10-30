import { vnMonthRange, vnParts } from "../vn-time";
import { prisma } from "../db";
import { PRODUCTION_FEED_SOURCE } from "./constants";
import { safeDiv, safePercent } from "./kpi-engine";
import { reconcileCell } from "../services/reconciliation-service";
import { rescoreLockedShiftsWithoutResults } from "../services/production-service";

/**
 * CẦU NỐI: TỪ CA SẢN XUẤT HẰNG NGÀY SANG KPI THÁNG.
 *
 * Đây là chỗ hai hệ thống gặp nhau. Không có nó thì xưởng chấm điểm ca mỗi ngày
 * còn KPI tháng vẫn phải gõ tay — hai bộ số sống riêng, cuối tháng lệch nhau
 * không ai giải thích được.
 *
 * Cách chạy: gộp các ca **đã khoá** trong tháng, quy về từng người, rồi đẩy vào
 * `kpi_actual_feeds` như một nguồn tự động tên "production". Từ đó nó đi qua
 * đúng bộ đối soát Phase 3 — nghĩa là nếu công nhân tự khai lệch quá 5% so với
 * số máy tính ra từ nhật ký ca, hệ thống treo lại chờ người quyết.
 *
 * Chỉ tính ca đã khoá. Ca còn DRAFT hay chờ KCS thì số chưa chắc, đẩy sang KPI
 * tháng là làm bẩn dữ liệu. Ca bị mở lại thì số đã đẩy trước đó được đè bằng 0
 * (staleProductionCells) — không để số cũ tiếp tục vào đối soát.
 */

export type ProductionSyncResult = {
  month: number;
  year: number;
  shiftsCounted: number;
  employeesCounted: number;
  feedsWritten: number;
  mismatches: number;
  skippedNoKpi: string[];
};

export async function runProductionKpiSync(
  month: number,
  year: number
): Promise<ProductionSyncResult> {
  // Ranh giới tháng theo giờ Việt Nam, không theo múi giờ của server
  const shifts = await prisma.productionShiftLog.findMany({
    where: { status: "LOCKED", shiftDate: vnMonthRange(year, month) },
    include: {
      participants: { include: { user: true } },
      kpiResults: true,
      sku: true,
    },
  });

  const result: ProductionSyncResult = {
    month,
    year,
    shiftsCounted: shifts.length,
    employeesCounted: 0,
    feedsWritten: 0,
    mismatches: 0,
    skippedNoKpi: [],
  };

  // KHÔNG dừng sớm khi tháng không còn ca khoá: ca có thể vừa bị mở lại hết,
  // số đã đẩy sang KPI tháng ở lượt trước phải được đưa về 0 (xem dưới).

  /* ---------------- gộp số theo từng người ---------------- */

  type Agg = {
    email: string;
    attributedKg: number;
    personalDefectKg: number;
    personalViolations: number;
    shiftsOnTarget: number;
    shiftsTotal: number;
    scoreSum: number;
    scoreCount: number;
  };

  const byUser = new Map<string, Agg>();

  for (const s of shifts) {
    const totalHours =
      s.participants.reduce((x, p) => x + p.hoursWorked, 0) || s.totalLaborHours;
    const onTarget =
      s.targetOutputKg > 0 && s.qcPassedKg >= s.targetOutputKg;

    for (const p of s.participants) {
      const cur =
        byUser.get(p.userId) ??
        ({
          email: p.user.email,
          attributedKg: 0,
          personalDefectKg: 0,
          personalViolations: 0,
          shiftsOnTarget: 0,
          shiftsTotal: 0,
          scoreSum: 0,
          scoreCount: 0,
        } as Agg);

      const share = safeDiv(p.hoursWorked, totalHours) ?? 0;
      cur.attributedKg += s.qcPassedKg * share;
      cur.personalDefectKg += p.personalDefectKg;
      cur.personalViolations += p.violationCount;
      cur.shiftsTotal += 1;
      if (onTarget) cur.shiftsOnTarget += 1;

      const kpi = s.kpiResults.find((k) => k.userId === p.userId);
      if (kpi) {
        cur.scoreSum += kpi.finalWeightedScore;
        cur.scoreCount += 1;
      }

      byUser.set(p.userId, cur);
    }
  }

  result.employeesCounted = byUser.size;

  /* ---------------- tra kỳ KPI tháng tương ứng ---------------- */

  const period = await prisma.kpiPeriod.findUnique({
    where: { month_year: { month, year } },
  });

  /* ---------------- đẩy số vào từng chỉ tiêu ---------------- */

  const round2 = (n: number) => Math.round(n * 100) / 100;

  // Tra định nghĩa KPI một lần cho cả vòng lặp, không truy vấn lại mỗi người
  const defs = new Map(
    (
      await prisma.kpiDefinition.findMany({
        where: { code: { in: ["PROD_OUT", "PROD_DEFECT", "PROD_ONTIME", "PROD_SAFE"] } },
      })
    ).map((d) => [d.code, d])
  );

  // Tra MỘT LẦN số đã gộp lần trước của mọi (người × chỉ tiêu) trong tháng,
  // thay vì một findFirst cho từng ô — cron Vercel chỉ có 60 giây. Tra theo
  // TOÀN BỘ nguồn production của tháng (không chỉ người còn ca khoá) để biết
  // ai từng có số mà giờ không còn ca nào.
  const defIds = [...defs.values()].map((d) => d.id);
  const cellKey = (email: string, defId: string) => `${email}|${defId}`;
  const lastValue = new Map<string, number>();
  if (defIds.length > 0) {
    const prevFeeds = await prisma.kpiActualFeed.findMany({
      where: {
        kpiDefinitionId: { in: defIds },
        periodMonth: month,
        periodYear: year,
        sourceCode: PRODUCTION_FEED_SOURCE,
      },
      orderBy: { createdAt: "desc" },
      select: { employeeEmail: true, kpiDefinitionId: true, value: true },
    });
    for (const f of prevFeeds) {
      const k = cellKey(f.employeeEmail, f.kpiDefinitionId);
      if (!lastValue.has(k)) lastValue.set(k, f.value);
    }
  }

  type NewFeed = {
    kpiDefinitionId: string;
    employeeEmail: string;
    periodMonth: number;
    periodYear: number;
    value: number;
    source: string;
    sourceCode: string;
    rawPayload: string;
  };
  const newFeeds: NewFeed[] = [];
  const changedCells: { userId: string; defId: string }[] = [];
  // Ô (người × chỉ tiêu) lượt này còn tính được số từ ca đã khoá
  const liveCells: string[] = [];

  for (const [userId, agg] of byUser) {
    const values: Record<string, number | null> = {
      // Tổng thành phẩm quy cho người này trong tháng
      PROD_OUT: round2(agg.attributedKg),
      // Tỷ lệ lỗi thuộc công đoạn của người này
      PROD_DEFECT: safePercent(agg.personalDefectKg, agg.attributedKg),
      // Tỷ lệ ca người này tham gia mà ca đó đạt chỉ tiêu sản lượng
      PROD_ONTIME: safePercent(agg.shiftsOnTarget, agg.shiftsTotal),
      // Số vi phạm nội quy / an toàn của cá nhân
      PROD_SAFE: agg.personalViolations,
    };

    for (const [code, value] of Object.entries(values)) {
      if (value === null) continue;

      const def = defs.get(code);
      if (!def) {
        if (!result.skippedNoKpi.includes(code)) result.skippedNoKpi.push(code);
        continue;
      }
      liveCells.push(cellKey(agg.email, def.id));

      // Nhật ký thô ghi kể cả khi kỳ tháng chưa mở — nhưng CHỈ khi số đổi so
      // với lần gộp trước. Cron chạy mỗi 2 tiếng; ghi lặp cùng một số sẽ phình
      // bảng feed và làm bộ đối soát tưởng nguồn vừa đổi.
      const prev = lastValue.get(cellKey(agg.email, def.id));
      if (prev !== undefined && prev === value) continue;

      newFeeds.push({
        kpiDefinitionId: def.id,
        employeeEmail: agg.email,
        periodMonth: month,
        periodYear: year,
        value,
        source: "PRODUCTION",
        sourceCode: PRODUCTION_FEED_SOURCE,
        rawPayload: JSON.stringify({
          soCaThamGia: agg.shiftsTotal,
          soCaDatChiTieu: agg.shiftsOnTarget,
          kgQuyChoNguoiNay: round2(agg.attributedKg),
          loiCongDoanKg: round2(agg.personalDefectKg),
          diemCaTrungBinh:
            agg.scoreCount > 0 ? round2(agg.scoreSum / agg.scoreCount) : null,
        }),
      });
      changedCells.push({ userId, defId: def.id });
    }
  }

  /* -------- ô cũ không còn căn cứ: đưa về 0 --------
     Bộ đối soát luôn lấy feed MỚI NHẤT của từng nguồn (latestSources) và không
     có cách "rút" một feed. Nên khi ca bị mở lại khiến một người không còn ca
     khoá nào trong tháng (hoặc chỉ số không còn tính được), feed cũ vẫn là số
     production mới nhất và tiếp tục chảy vào cột Số hệ thống. Ghi một feed 0
     (trung tính: chưa có ca khoá nào ghi nhận cho người này) để đè lên —
     khớp nghĩa "số máy tính ra từ nhật ký ca đã khoá"; nếu nhân viên tự khai
     khác 0 thì bộ đối soát treo lại chờ người quyết, đúng nguyên tắc không âm
     thầm chọn số. Ô đã là 0 thì không ghi lặp. */
  const stale = staleProductionCells(lastValue, new Set(liveCells));
  if (stale.length > 0) {
    const staleUsers = await prisma.user.findMany({
      where: { email: { in: [...new Set(stale.map((c) => c.email))] } },
      select: { id: true, email: true },
    });
    const idByEmail = new Map(staleUsers.map((u) => [u.email, u.id]));
    for (const c of stale) {
      newFeeds.push({
        kpiDefinitionId: c.defId,
        employeeEmail: c.email,
        periodMonth: month,
        periodYear: year,
        value: 0,
        source: "PRODUCTION",
        sourceCode: PRODUCTION_FEED_SOURCE,
        rawPayload: JSON.stringify({
          khongConCaKhoa: true,
          ghiChu: "Không còn ca đã khoá nào tính được chỉ số này trong tháng (ca bị mở lại) — đưa số production về 0.",
          soTruocDo: lastValue.get(cellKey(c.email, c.defId)),
        }),
      });
      const uid = idByEmail.get(c.email);
      if (uid) changedCells.push({ userId: uid, defId: c.defId });
    }
  }

  if (newFeeds.length > 0) {
    await prisma.kpiActualFeed.createMany({ data: newFeeds });
    result.feedsWritten = newFeeds.length;
  }

  // Chỉ đối soát lại những ô vừa có số mới. Ô không đổi đã được đối soát ở
  // lượt trước; bước runReconciliation ngay sau trong cron vẫn quét toàn bộ.
  if (!period || period.status === "FINALIZED" || changedCells.length === 0) {
    return result;
  }

  const rows = await prisma.kpiResult.findMany({
    where: {
      periodId: period.id,
      employeeId: { in: [...new Set(changedCells.map((c) => c.userId))] },
      kpiDefinitionId: { in: [...new Set(changedCells.map((c) => c.defId))] },
    },
    select: { id: true, status: true, employeeId: true, kpiDefinitionId: true },
  });
  const rowByCell = new Map(
    rows.map((r) => [`${r.employeeId}|${r.kpiDefinitionId}`, r])
  );

  for (const c of changedCells) {
    const row = rowByCell.get(`${c.userId}|${c.defId}`);
    // Không tự tạo dòng KPI mới — nếu quản lý chưa gán chỉ tiêu này cho người
    // đó thì đừng tự ý gán thay họ.
    if (!row || row.status === "FINALIZED") continue;

    const rec = await reconcileCell(row.id);
    if (!rec.skipped && !rec.matched) result.mismatches++;
  }

  return result;
}

/**
 * Đồng bộ tháng hiện tại và tháng trước.
 * Tháng trước vẫn cần vì có ca khoá muộn sau khi đã sang tháng mới.
 */
export async function runProductionKpiSyncRecent(now = new Date()) {
  const vn = vnParts(now);
  const cur = { month: vn.month, year: vn.year };
  const prev =
    cur.month === 1
      ? { month: 12, year: cur.year - 1 }
      : { month: cur.month - 1, year: cur.year };

  // Chữa ca đã khoá mà chấm điểm lỗi TRƯỚC khi gộp — để điểm ca kịp vào
  // số liệu tháng. Lỗi ở bước này không được chặn việc gộp.
  let chamLai: Awaited<ReturnType<typeof rescoreLockedShiftsWithoutResults>> | {
    error: string;
  };
  try {
    chamLai = await rescoreLockedShiftsWithoutResults();
  } catch (e) {
    console.error("[PRODUCTION] Chấm lại ca thiếu điểm lỗi:", e);
    chamLai = { error: e instanceof Error ? e.message : String(e) };
  }

  const a = await runProductionKpiSync(cur.month, cur.year);
  const b = await runProductionKpiSync(prev.month, prev.year);

  return {
    chamLaiCaThieuDiem: chamLai,
    thangNay: a,
    thangTruoc: b,
    tongCaDaGop: a.shiftsCounted + b.shiftsCounted,
    tongDongDay: a.feedsWritten + b.feedsWritten,
    tongLechSo: a.mismatches + b.mismatches,
  };
}

/**
 * Ô production (email × chỉ tiêu) cần đưa về 0: lượt trước có số KHÁC 0 mà
 * lượt này không còn tính được (người không còn ca khoá trong tháng, hoặc chỉ
 * số không xác định được nữa). Hàm thuần — để kiểm thử được.
 *
 * `lastValue`: số production mới nhất của từng ô, khoá "email|defId".
 */
export function staleProductionCells(
  lastValue: Map<string, number>,
  liveCells: Set<string>
): { email: string; defId: string }[] {
  const out: { email: string; defId: string }[] = [];
  for (const [key, value] of lastValue) {
    if (liveCells.has(key) || value === 0) continue;
    const sep = key.lastIndexOf("|");
    out.push({ email: key.slice(0, sep), defId: key.slice(sep + 1) });
  }
  return out;
}
