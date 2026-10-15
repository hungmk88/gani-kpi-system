import { vnMonthRange, vnParts } from "../vn-time";
import { prisma } from "../db";
import { PRODUCTION_FEED_SOURCE } from "./constants";
import { safeDiv, safePercent } from "./kpi-engine";
import { reconcileCell } from "../services/reconciliation-service";

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
 * tháng là làm bẩn dữ liệu.
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

  if (shifts.length === 0) return result;

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

      // Nhật ký thô ghi kể cả khi kỳ tháng chưa mở — nhưng CHỈ khi số đổi so
      // với lần gộp trước. Cron chạy mỗi 2 tiếng; ghi lặp cùng một số sẽ phình
      // bảng feed và làm bộ đối soát tưởng nguồn vừa đổi.
      const lastFeed = await prisma.kpiActualFeed.findFirst({
        where: {
          kpiDefinitionId: def.id,
          employeeEmail: agg.email,
          periodMonth: month,
          periodYear: year,
          sourceCode: PRODUCTION_FEED_SOURCE,
        },
        orderBy: { createdAt: "desc" },
        select: { value: true },
      });
      const changed = !lastFeed || lastFeed.value !== value;
      if (changed) await prisma.kpiActualFeed.create({
        data: {
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
              agg.scoreCount > 0
                ? round2(agg.scoreSum / agg.scoreCount)
                : null,
          }),
        },
      });
      if (changed) result.feedsWritten++;

      if (!period || period.status === "FINALIZED") continue;

      const row = await prisma.kpiResult.findUnique({
        where: {
          periodId_employeeId_kpiDefinitionId: {
            periodId: period.id,
            employeeId: userId,
            kpiDefinitionId: def.id,
          },
        },
      });
      // Không tự tạo dòng KPI mới — nếu quản lý chưa gán chỉ tiêu này cho người
      // đó thì đừng tự ý gán thay họ.
      if (!row || row.status === "FINALIZED") continue;

      const rec = await reconcileCell(row.id);
      if (!rec.skipped && !rec.matched) result.mismatches++;
    }
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

  const a = await runProductionKpiSync(cur.month, cur.year);
  const b = await runProductionKpiSync(prev.month, prev.year);

  return {
    thangNay: a,
    thangTruoc: b,
    tongCaDaGop: a.shiftsCounted + b.shiftsCounted,
    tongDongDay: a.feedsWritten + b.feedsWritten,
    tongLechSo: a.mismatches + b.mismatches,
  };
}
