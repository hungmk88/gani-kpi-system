import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { BusinessError } from "../rbac";
import { DATA_MISMATCH_THRESHOLD_PERCENT, ERR } from "../constants";
import { spreadPercent } from "../kpi";
import { writeAudit } from "../audit";
import { fmtNum } from "../format";
import { notify, sendCeoAlert } from "../telegram";
import { recalcResult } from "./kpi-service";
import type { SessionUser } from "../auth";

/**
 * BỘ ĐỐI SOÁT DỮ LIỆU ĐA NGUỒN.
 *
 * Nguyên tắc xương sống, lấy nguyên từ tài liệu thiết kế:
 * **Không âm thầm chọn một con số khi dữ liệu giữa các hệ thống bị lệch.**
 *
 * Cụ thể:
 *   - Các nguồn khớp nhau (lệch ≤ 5%) → tự đồng bộ vào cột "Số hệ thống", yên lặng.
 *   - Các nguồn đá nhau (lệch > 5%)   → TREO LẠI, không ghi số nào vào KPI, đẩy
 *     lên bảng ngoại lệ của Ban Giám đốc và bắn cảnh báo Telegram.
 *
 * Lý do làm chặt như vậy: nếu hệ thống tự chọn "nguồn ưu tiên" mỗi khi lệch, thì
 * đến cuối tháng không ai biết con số trên phiếu KPI đến từ đâu, và cãi nhau
 * không có căn cứ. Thà treo lại bắt người quyết, có ghi lý do.
 */

type Meta = { ip?: string | null; userAgent?: string | null };

export type SourceValue = {
  code: string;
  label: string;
  value: number;
  at: string;
};

/** Bản ghi feed tối thiểu cần cho đối soát (không kéo rawPayload). */
export type FeedLite = {
  value: number;
  source: string;
  sourceCode: string | null;
  createdAt: Date;
};

/**
 * Gom số mới nhất của từng nguồn từ danh sách feed ĐÃ SẮP XẾP mới → cũ.
 * Hàm thuần — dùng chung cho đối soát từng ô và quét hàng loạt.
 */
export function latestSources(
  feedsNewestFirst: FeedLite[],
  actualSelf: number | null | undefined
): SourceValue[] {
  // Mỗi nguồn chỉ lấy bản ghi mới nhất — nạp lại file Excel lần hai thì lần đầu
  // không còn tính nữa.
  const latestBySource = new Map<string, SourceValue>();
  for (const f of feedsNewestFirst) {
    const code = f.sourceCode ?? f.source;
    if (latestBySource.has(code)) continue;
    latestBySource.set(code, {
      code,
      label: sourceLabel(code, f.source),
      value: f.value,
      at: f.createdAt.toISOString(),
    });
  }

  const out = [...latestBySource.values()];

  // Số nhân viên tự khai cũng là một nguồn, và là nguồn hay lệch nhất
  if (actualSelf !== null && actualSelf !== undefined) {
    out.push({
      code: "SELF",
      label: "Nhân viên tự khai",
      value: actualSelf,
      at: new Date().toISOString(),
    });
  }

  return out;
}

const FEED_SELECT = {
  value: true,
  source: true,
  sourceCode: true,
  createdAt: true,
} as const;

/** Gom số mới nhất của từng nguồn cho một ô KPI cụ thể. */
export async function collectSources(
  employeeEmail: string,
  kpiDefinitionId: string,
  month: number,
  year: number,
  actualSelf: number | null
): Promise<SourceValue[]> {
  const feeds = await prisma.kpiActualFeed.findMany({
    where: {
      employeeEmail,
      kpiDefinitionId,
      periodMonth: month,
      periodYear: year,
    },
    orderBy: { createdAt: "desc" },
    select: FEED_SELECT,
  });
  return latestSources(feeds, actualSelf);
}

/** Dấu vân tay của bộ nguồn: chỉ mã + giá trị, sắp xếp ổn định. */
export function sourcesFingerprint(sources: Pick<SourceValue, "code" | "value">[]) {
  return JSON.stringify(
    sources
      .map(({ code, value }) => [code, value] as const)
      .sort((a, b) => a[0].localeCompare(b[0]))
  );
}

function parseSources(json: string | null | undefined): SourceValue[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function computeVariance(sources: SourceValue[]) {
  const values = sources.map((s) => s.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  // Cùng một công thức với cờ Data Mismatch (lib/kpi.ts)
  const variancePercent = spreadPercent(values);
  return { minValue, maxValue, variancePercent };
}

/**
 * Đối soát một ô KPI. Trả về kết quả và tự cập nhật bảng reconciliations.
 *
 * Chỉ có 1 nguồn thì không có gì để đối soát — vẫn đồng bộ vào "Số hệ thống"
 * như bình thường (trừ nguồn tự khai, vì số tự khai đã có chỗ riêng của nó).
 */
export async function reconcileCell(
  kpiResultId: string,
  preloaded?: ReconcilePreloaded
) {
  const row =
    preloaded?.row ??
    (await loadCell(kpiResultId));
  if (!row) {
    throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy dòng KPI.", 404);
  }
  if (!row.kpiDefinitionId || !row.kpiDefinition) {
    return { skipped: true as const, reason: "Dòng KPI chưa gán chỉ tiêu." };
  }

  // Dòng đã chốt thì đóng băng, không đối soát lại nữa
  if (row.status === "FINALIZED") {
    return { skipped: true as const, reason: "Dòng KPI đã chốt và khoá." };
  }

  const sources = preloaded?.feeds
    ? latestSources(preloaded.feeds, row.actualSelf)
    : await collectSources(
        row.employee.email,
        row.kpiDefinitionId,
        row.period.month,
        row.period.year,
        row.actualSelf
      );

  const external = sources.filter((s) => s.code !== "SELF");

  // Không có nguồn ngoài nào thì không có gì để đối soát
  if (external.length === 0) {
    await prisma.reconciliation.deleteMany({
      where: {
        periodId: row.periodId,
        employeeId: row.employeeId,
        kpiDefinitionId: row.kpiDefinitionId,
        status: { not: "RESOLVED" },
      },
    });
    return { skipped: true as const, reason: "Chưa có nguồn dữ liệu tự động." };
  }

  const { minValue, maxValue, variancePercent } = computeVariance(sources);
  const isMatched = variancePercent <= DATA_MISMATCH_THRESHOLD_PERCENT;

  const existing =
    preloaded?.existing !== undefined
      ? preloaded.existing
      : await prisma.reconciliation.findUnique({
          where: {
            periodId_employeeId_kpiDefinitionId: {
              periodId: row.periodId,
              employeeId: row.employeeId,
              kpiDefinitionId: row.kpiDefinitionId,
            },
          },
        });

  // Đã có người chốt tay rồi thì tôn trọng quyết định đó, trừ khi SỐ của các
  // nguồn đổi. So bằng "dấu vân tay" (mã nguồn + giá trị), bỏ qua thời điểm —
  // thời điểm đổi ở mỗi lượt cron nên so cả chuỗi JSON thì quyết định tay bị
  // xoá sau 2 tiếng.
  const alreadyResolved =
    existing?.status === "RESOLVED" &&
    sourcesFingerprint(parseSources(existing.sourcesJson)) ===
      sourcesFingerprint(sources);

  const record = await prisma.reconciliation.upsert({
    where: {
      periodId_employeeId_kpiDefinitionId: {
        periodId: row.periodId,
        employeeId: row.employeeId,
        kpiDefinitionId: row.kpiDefinitionId,
      },
    },
    update: alreadyResolved
      ? { minValue, maxValue, variancePercent }
      : {
          sourcesJson: JSON.stringify(sources),
          minValue,
          maxValue,
          variancePercent,
          status: isMatched ? "MATCHED" : "MISMATCH",
          resolvedValue: null,
          resolvedSource: null,
          resolveReason: null,
          resolvedById: null,
          resolvedAt: null,
        },
    create: {
      periodId: row.periodId,
      employeeId: row.employeeId,
      kpiDefinitionId: row.kpiDefinitionId,
      sourcesJson: JSON.stringify(sources),
      minValue,
      maxValue,
      variancePercent,
      status: isMatched ? "MATCHED" : "MISMATCH",
    },
  });

  if (alreadyResolved) {
    return { skipped: true as const, reason: "Đã có người chốt số cho ô này." };
  }

  if (isMatched) {
    // Các nguồn nhất trí -> lấy nguồn đáng tin nhất, đồng bộ, và im lặng
    const priorities =
      preloaded?.priorities ?? (await loadPriorities(external.map((s) => s.code)));
    const chosen = pickByPriority(external, priorities);
    await prisma.kpiResult.update({
      where: { id: kpiResultId },
      data: { actualSystem: chosen.value },
    });
    await recalcResult(kpiResultId);
    return {
      skipped: false as const,
      matched: true,
      variancePercent,
      chosen,
      recordId: record.id,
    };
  }

  // Lệch quá ngưỡng -> KHÔNG ghi số nào vào KPI, treo lại chờ người quyết
  const wasMismatch = existing?.status === "MISMATCH";
  const detail = sources
    .map((s) => `${s.label}: ${fmt(s.value)}`)
    .join(" · ");

  if (!wasMismatch) {
    await sendCeoAlert({
      title: `Lệch số liệu ${variancePercent}%: ${row.kpiDefinition.name}`,
      details: `${row.employee.fullName} (${row.employee.department?.name ?? "—"}) · ${detail} · Hệ thống chưa ghi số nào, đang chờ quyết định.`,
      actionPath: "/reconciliation",
    });
  }

  return {
    skipped: false as const,
    matched: false,
    variancePercent,
    sources,
    recordId: record.id,
  };
}

const CELL_INCLUDE = {
  kpiDefinition: true,
  employee: { include: { department: true } },
  period: true,
} as const;

function loadCell(kpiResultId: string) {
  return prisma.kpiResult.findUnique({
    where: { id: kpiResultId },
    include: CELL_INCLUDE,
  });
}

// Suy kiểu từ chính client (client có omit passwordHash toàn cục)
type CellRow = NonNullable<Awaited<ReturnType<typeof loadCell>>>;
type ReconRow = Prisma.ReconciliationGetPayload<object>;

/**
 * Dữ liệu nạp sẵn cho reconcileCell khi quét hàng loạt. Trường nào bỏ trống
 * thì reconcileCell tự truy vấn như cũ. `existing: null` nghĩa là ĐÃ tra và
 * chưa có bản đối soát (khác với undefined = chưa tra).
 */
export type ReconcilePreloaded = {
  row?: CellRow;
  /** Feed của đúng ô này, sắp xếp mới → cũ. */
  feeds?: FeedLite[];
  existing?: ReconRow | null;
  priorities?: Map<string, number>;
};

export type CellPlan =
  | { action: "noop"; outcome: "skipped" | "matched" | "mismatched" }
  | { action: "write" };

/**
 * Quyết định NHANH, không truy vấn: ô này có cần chạy reconcileCell không?
 * Chỉ trả "noop" khi chắc chắn reconcileCell sẽ không đổi gì có ý nghĩa
 * (dấu vân tay nguồn, trạng thái, số hệ thống đều như cũ) — còn lại cứ chạy
 * đường ghi đầy đủ để giữ nguyên ngữ nghĩa.
 */
export function planCell(input: {
  row: Pick<CellRow, "status" | "kpiDefinitionId" | "actualSelf" | "actualSystem"> & {
    kpiDefinition: unknown;
  };
  feeds: FeedLite[];
  existing: Pick<ReconRow, "status" | "sourcesJson" | "minValue" | "maxValue" | "variancePercent"> | null;
  priorities: Map<string, number>;
}): CellPlan {
  const { row, feeds, existing, priorities } = input;
  if (!row.kpiDefinitionId || !row.kpiDefinition || row.status === "FINALIZED") {
    return { action: "noop", outcome: "skipped" };
  }

  const sources = latestSources(feeds, row.actualSelf);
  const external = sources.filter((s) => s.code !== "SELF");

  if (external.length === 0) {
    // Không có nguồn ngoài: chỉ cần ghi khi còn bản đối soát chưa chốt để xoá
    return existing && existing.status !== "RESOLVED"
      ? { action: "write" }
      : { action: "noop", outcome: "skipped" };
  }

  if (!existing) return { action: "write" };
  if (
    sourcesFingerprint(parseSources(existing.sourcesJson)) !==
    sourcesFingerprint(sources)
  ) {
    return { action: "write" };
  }

  const { minValue, maxValue, variancePercent } = computeVariance(sources);
  const sameStats =
    existing.minValue === minValue &&
    existing.maxValue === maxValue &&
    existing.variancePercent === variancePercent;

  if (existing.status === "RESOLVED") {
    // reconcileCell chỉ cập nhật min/max/variance rồi bỏ qua
    return sameStats ? { action: "noop", outcome: "skipped" } : { action: "write" };
  }

  const isMatched = variancePercent <= DATA_MISMATCH_THRESHOLD_PERCENT;
  if (!sameStats) return { action: "write" };

  if (isMatched && existing.status === "MATCHED") {
    // Đã khớp từ trước: chỉ cần số hệ thống đang đúng nguồn ưu tiên
    const chosen = pickByPriority(external, priorities);
    return row.actualSystem === chosen.value
      ? { action: "noop", outcome: "matched" }
      : { action: "write" };
  }
  if (!isMatched && existing.status === "MISMATCH") {
    // Vẫn lệch như cũ: đã cảnh báo rồi, không ghi gì thêm
    return { action: "noop", outcome: "mismatched" };
  }
  return { action: "write" };
}

/** Quét đối soát toàn bộ các dòng KPI chưa chốt của một kỳ (hoặc mọi kỳ đang mở). */
export async function runReconciliation(periodId?: string) {
  // Nạp MỘT LẦN mọi thứ cần cho cả lượt quét, thay vì 5–7 truy vấn mỗi dòng —
  // cron trên Vercel chỉ có 60 giây.
  const rows = await prisma.kpiResult.findMany({
    where: {
      status: { not: "FINALIZED" },
      kpiDefinitionId: { not: null },
      ...(periodId ? { periodId } : { period: { status: { not: "FINALIZED" } } }),
    },
    include: CELL_INCLUDE,
  });

  const total = await prisma.kpiResult.count({
    where: {
      status: { not: "FINALIZED" },
      ...(periodId ? { periodId } : { period: { status: { not: "FINALIZED" } } }),
    },
  });

  let checked = 0;
  let matched = 0;
  let mismatched = 0;
  let written = 0;

  if (rows.length === 0) {
    return { checked, matched, mismatched, total, written };
  }

  const periodKeys = new Map<string, { periodMonth: number; periodYear: number }>();
  for (const r of rows) {
    periodKeys.set(`${r.period.month}/${r.period.year}`, {
      periodMonth: r.period.month,
      periodYear: r.period.year,
    });
  }
  const periodIds = [...new Set(rows.map((r) => r.periodId))];
  const defIds = [...new Set(rows.map((r) => r.kpiDefinitionId!))];

  const [feeds, recons, sourcesReg] = await Promise.all([
    prisma.kpiActualFeed.findMany({
      where: {
        OR: [...periodKeys.values()],
        kpiDefinitionId: { in: defIds },
      },
      orderBy: { createdAt: "desc" },
      select: {
        ...FEED_SELECT,
        employeeEmail: true,
        kpiDefinitionId: true,
        periodMonth: true,
        periodYear: true,
      },
    }),
    prisma.reconciliation.findMany({ where: { periodId: { in: periodIds } } }),
    prisma.integrationSource.findMany({ select: { code: true, priority: true } }),
  ]);

  // Gom feed theo ô (email + chỉ tiêu + tháng/năm), giữ thứ tự mới → cũ
  const feedKey = (email: string, defId: string, m: number, y: number) =>
    `${email}|${defId}|${m}|${y}`;
  const feedsByCell = new Map<string, FeedLite[]>();
  for (const f of feeds) {
    const k = feedKey(f.employeeEmail, f.kpiDefinitionId, f.periodMonth, f.periodYear);
    const list = feedsByCell.get(k);
    if (list) list.push(f);
    else feedsByCell.set(k, [f]);
  }

  const reconByCell = new Map<string, ReconRow>();
  for (const r of recons) {
    reconByCell.set(`${r.periodId}|${r.employeeId}|${r.kpiDefinitionId}`, r);
  }

  const priorities = new Map(sourcesReg.map((s) => [s.code, s.priority]));

  for (const r of rows) {
    const cellFeeds =
      feedsByCell.get(
        feedKey(r.employee.email, r.kpiDefinitionId!, r.period.month, r.period.year)
      ) ?? [];
    const existing =
      reconByCell.get(`${r.periodId}|${r.employeeId}|${r.kpiDefinitionId}`) ?? null;

    const plan = planCell({ row: r, feeds: cellFeeds, existing, priorities });
    if (plan.action === "noop") {
      if (plan.outcome === "skipped") continue;
      checked++;
      if (plan.outcome === "matched") matched++;
      else mismatched++;
      continue;
    }

    written++;
    const res = await reconcileCell(r.id, {
      row: r,
      feeds: cellFeeds,
      existing,
      priorities,
    });
    if (res.skipped) continue;
    checked++;
    if (res.matched) matched++;
    else mismatched++;
  }

  return { checked, matched, mismatched, total, written };
}

/**
 * Người có thẩm quyền chốt số cho một ô đang lệch.
 * Bắt buộc ghi lý do — sau này mở nhật ký ra là biết vì sao chọn nguồn đó.
 */
export async function resolveReconciliation(
  actor: SessionUser,
  reconciliationId: string,
  input: { value: number; sourceCode: string; reason: string },
  meta: Meta = {}
) {
  if (actor.role !== "CEO" && actor.role !== "MANAGER") {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Chỉ trưởng phòng và Ban Giám đốc mới chốt được số liệu lệch.",
      403
    );
  }
  if (!input.reason?.trim() || input.reason.trim().length < 10) {
    throw new BusinessError(
      ERR.REASON_REQUIRED,
      "Chốt số khi các nguồn đang đá nhau thì bắt buộc ghi lý do rõ ràng (tối thiểu 10 ký tự).",
      400
    );
  }

  const rec = await prisma.reconciliation.findUnique({
    where: { id: reconciliationId },
    include: {
      employee: { include: { department: true } },
      kpiDefinition: true,
      period: true,
    },
  });
  if (!rec) {
    throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy bản đối soát.", 404);
  }
  if (
    actor.role === "MANAGER" &&
    rec.employee.departmentId !== actor.departmentId
  ) {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Dòng này không thuộc phòng ban của bạn.",
      403
    );
  }
  // Không ai tự chốt số của chính mình — trưởng phòng lệch số thì Ban Giám
  // đốc quyết.
  if (rec.employeeId === actor.id) {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Không thể tự chốt số liệu KPI của chính bạn. Ban Giám đốc sẽ quyết dòng này.",
      403
    );
  }
  if (rec.status !== "MISMATCH") {
    throw new BusinessError(
      "RECONCILIATION_NOT_PENDING",
      "Dòng này không còn ở trạng thái lệch số (đã khớp hoặc đã có người chốt).",
      409
    );
  }
  // Trưởng phòng chỉ được chọn MỘT TRONG CÁC SỐ của nguồn. Nhập số thứ ba
  // (MANUAL_OVERRIDE) là quyền riêng của Ban Giám đốc.
  if (input.sourceCode === "MANUAL_OVERRIDE") {
    if (actor.role !== "CEO") {
      throw new BusinessError(
        ERR.FORBIDDEN,
        "Chỉ Ban Giám đốc được nhập số khác với các nguồn.",
        403
      );
    }
    if (!Number.isFinite(input.value)) {
      throw new BusinessError(ERR.VALIDATION_FAILED, "Số chốt không hợp lệ.", 400);
    }
  } else {
    const chosen = parseSources(rec.sourcesJson).find(
      (s) => s.code === input.sourceCode
    );
    if (!chosen || chosen.value !== input.value) {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        "Số chốt phải lấy đúng từ một trong các nguồn đang đối soát.",
        400
      );
    }
  }

  const kpiRow = await prisma.kpiResult.findUnique({
    where: {
      periodId_employeeId_kpiDefinitionId: {
        periodId: rec.periodId,
        employeeId: rec.employeeId,
        kpiDefinitionId: rec.kpiDefinitionId,
      },
    },
  });
  if (!kpiRow) {
    throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy dòng KPI tương ứng.", 404);
  }
  if (kpiRow.status === "FINALIZED") {
    throw new BusinessError(
      ERR.KPI_FINALIZED,
      "Dòng KPI đã chốt và khoá, không đổi số nữa.",
      409
    );
  }

  const before = {
    actualSystem: kpiRow.actualSystem,
    actualFinal: kpiRow.actualFinal,
  };

  // Số đã chốt khi đối soát là SỐ CHỐT của dòng KPI. Chỉ ghi vào actualSystem
  // thì vô nghĩa: điểm chấm theo actualFinal ?? actualSelf ?? actualSystem,
  // nên số nhân viên tự khai (đang lệch) vẫn thắng.
  await prisma.kpiResult.update({
    where: { id: kpiRow.id },
    data: { actualSystem: input.value, actualFinal: input.value },
  });
  const updated = await recalcResult(kpiRow.id);

  await prisma.reconciliation.update({
    where: { id: reconciliationId },
    data: {
      status: "RESOLVED",
      resolvedValue: input.value,
      resolvedSource: input.sourceCode,
      resolveReason: input.reason,
      resolvedById: actor.id,
      resolvedAt: new Date(),
    },
  });

  await writeAudit({
    actor,
    action: "RECONCILIATION_RESOLVE",
    entityName: "reconciliations",
    entityId: reconciliationId,
    before,
    after: {
      actualSystem: input.value,
      actualFinal: input.value,
      chonNguon: input.sourceCode,
      cacNguon: JSON.parse(rec.sourcesJson),
    },
    reason: input.reason,
    ...meta,
  });

  await notify({
    userId: rec.employeeId,
    title: `Đã chốt số liệu lệch: ${rec.kpiDefinition.name}`,
    body: `${actor.fullName} chốt số ${fmt(input.value)} theo nguồn "${input.sourceCode}". Lý do: ${input.reason}`,
    level: "WARNING",
    linkUrl: `/kpi/${rec.periodId}`,
  });

  return updated;
}

/* ------------------------------------------------------------ tiện ích */

/** Bảng ưu tiên của các nguồn đã đăng ký. */
async function loadPriorities(codes: string[]): Promise<Map<string, number>> {
  const registered = await prisma.integrationSource.findMany({
    where: { code: { in: codes } },
    select: { code: true, priority: true },
  });
  return new Map(registered.map((r) => [r.code, r.priority]));
}

/** Nguồn nào đáng tin hơn khi các số đã khớp nhau. */
export function pickByPriority(
  sources: SourceValue[],
  priorities: Map<string, number>
): SourceValue {
  const priorityOf = (code: string) =>
    priorities.get(code) ??
    // Nguồn chưa đăng ký: API tự động tin hơn file người nạp tay
    (code.includes("API") ? 20 : 50);

  return [...sources].sort((a, b) => priorityOf(a.code) - priorityOf(b.code))[0];
}

function sourceLabel(code: string, kind: string) {
  const map: Record<string, string> = {
    EXCEL: "File Excel",
    IPOS_API: "iPOS",
    CRM_API: "CRM",
    ERP_API: "ERP",
    SHEETS: "Google Sheets",
    MANUAL: "Nhập tay",
    SELF: "Nhân viên tự khai",
  };
  return map[code] ?? map[kind] ?? code;
}

/** Số trong câu thông báo — cùng một cách viết số với mọi màn hình */
function fmt(n: number) {
  return fmtNum(n);
}

/* ------------------------------------------------- TÌNH TRẠNG MỘT KỲ (màn hình) */

export type ReconPeriodState = "no_data" | "all_matched" | "has_mismatch";

/**
 * Tóm tắt một kỳ cho màn Đối soát. Ô đối soát chỉ sinh ra khi có ít nhất một
 * nguồn NGOÀI (iPOS, Excel, xưởng…) nạp số — nên kỳ không có ô nào nghĩa là
 * CHƯA CÓ GÌ ĐỂ SO, không phải "mọi thứ khớp". Nói "khớp" lúc đó là trấn an
 * sai: có khi nguồn ngoài đang hỏng nên mới không về số.
 */
export function reconPeriodState(counts: {
  matched: number;
  mismatched: number;
  resolved: number;
}): ReconPeriodState {
  if (counts.mismatched > 0) return "has_mismatch";
  if (counts.matched + counts.resolved === 0) return "no_data";
  return "all_matched";
}
