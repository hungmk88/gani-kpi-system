import { prisma } from "../db";
import { BusinessError } from "../rbac";
import { DATA_MISMATCH_THRESHOLD_PERCENT, ERR } from "../constants";
import { round2 } from "../kpi";
import { writeAudit } from "../audit";
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
  });

  // Mỗi nguồn chỉ lấy bản ghi mới nhất — nạp lại file Excel lần hai thì lần đầu
  // không còn tính nữa.
  const latestBySource = new Map<string, SourceValue>();
  for (const f of feeds) {
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

export function computeVariance(sources: SourceValue[]) {
  const values = sources.map((s) => s.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const base = Math.max(Math.abs(maxValue), Math.abs(minValue), 1);
  const variancePercent = round2(((maxValue - minValue) / base) * 100);
  return { minValue, maxValue, variancePercent };
}

/**
 * Đối soát một ô KPI. Trả về kết quả và tự cập nhật bảng reconciliations.
 *
 * Chỉ có 1 nguồn thì không có gì để đối soát — vẫn đồng bộ vào "Số hệ thống"
 * như bình thường (trừ nguồn tự khai, vì số tự khai đã có chỗ riêng của nó).
 */
export async function reconcileCell(kpiResultId: string) {
  const row = await prisma.kpiResult.findUnique({
    where: { id: kpiResultId },
    include: {
      kpiDefinition: true,
      employee: { include: { department: true } },
      period: true,
    },
  });
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

  const sources = await collectSources(
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

  const existing = await prisma.reconciliation.findUnique({
    where: {
      periodId_employeeId_kpiDefinitionId: {
        periodId: row.periodId,
        employeeId: row.employeeId,
        kpiDefinitionId: row.kpiDefinitionId,
      },
    },
  });

  // Đã có người chốt tay rồi thì tôn trọng quyết định đó, trừ khi số nguồn đổi
  const alreadyResolved =
    existing?.status === "RESOLVED" &&
    existing.sourcesJson === JSON.stringify(sources);

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
    const chosen = await pickByPriority(external);
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

/** Quét đối soát toàn bộ các dòng KPI chưa chốt của một kỳ (hoặc mọi kỳ đang mở). */
export async function runReconciliation(periodId?: string) {
  const rows = await prisma.kpiResult.findMany({
    where: {
      status: { not: "FINALIZED" },
      ...(periodId ? { periodId } : { period: { status: { not: "FINALIZED" } } }),
    },
    select: { id: true },
  });

  let checked = 0;
  let matched = 0;
  let mismatched = 0;

  for (const r of rows) {
    const res = await reconcileCell(r.id);
    if (res.skipped) continue;
    checked++;
    if (res.matched) matched++;
    else mismatched++;
  }

  return { checked, matched, mismatched, total: rows.length };
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

  const before = { actualSystem: kpiRow.actualSystem };

  await prisma.kpiResult.update({
    where: { id: kpiRow.id },
    data: { actualSystem: input.value },
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

/** Nguồn nào đáng tin hơn khi các số đã khớp nhau. */
async function pickByPriority(sources: SourceValue[]): Promise<SourceValue> {
  const registered = await prisma.integrationSource.findMany({
    where: { code: { in: sources.map((s) => s.code) } },
    select: { code: true, priority: true },
  });
  const priorityOf = (code: string) =>
    registered.find((r) => r.code === code)?.priority ??
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

function fmt(n: number) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n);
}
