import { prisma } from "@/lib/db";
import { fail, handle, requireUser } from "@/lib/api";
import { kpiScopeWhere } from "@/lib/rbac";
import { buildKpiReport, type ExportRow } from "@/lib/excel";
import { classifyScoreFor, scoreStateOf, summarizeResults } from "@/lib/kpi";
import { KPI_STATUS_LABEL } from "@/lib/constants";

export const runtime = "nodejs";

/**
 * Xuất bảng KPI ra Excel — chỉ xuất phần dữ liệu người dùng có quyền xem.
 * Bọc handle(): chưa đăng nhập -> 401, đang bị buộc đổi mật khẩu -> 403 (đúng
 * format lỗi chung) thay vì nổ 500. Thành công vẫn trả file nhị phân.
 */
export async function GET(req: Request) {
  return handle(() => exportKpi(req));
}

async function exportKpi(req: Request): Promise<Response> {
  const user = await requireUser();
  const periodId = new URL(req.url).searchParams.get("periodId");
  if (!periodId) {
    return fail("VALIDATION_FAILED", "Thiếu periodId.", 400);
  }

  const period = await prisma.kpiPeriod.findUnique({ where: { id: periodId } });
  if (!period) {
    return fail("NOT_FOUND", "Không tìm thấy kỳ KPI.", 404);
  }

  const results = await prisma.kpiResult.findMany({
    where: { periodId, ...kpiScopeWhere(user) },
    include: {
      kpiDefinition: true,
      employee: { include: { department: true } },
    },
    orderBy: [
      { employee: { department: { name: "asc" } } },
      { employee: { fullName: "asc" } },
      { weightPercent: "desc" },
    ],
  });

  const rows: ExportRow[] = results.map((r) => ({
    department: r.employee.department?.name ?? "—",
    employee: r.employee.fullName,
    jobTitle: r.employee.jobTitle ?? "",
    kpiName: r.kpiDefinition?.name ?? "—",
    unit: r.kpiDefinition?.unit ?? "—",
    direction: r.kpiDefinition?.isHigherBetter
      ? "Càng cao càng tốt"
      : "Càng thấp càng tốt",
    weight: r.weightPercent ?? 0,
    target: r.targetValue ?? 0,
    actualSystem: r.actualSystem,
    actualSelf: r.actualSelf,
    actualFinal: r.actualFinal,
    achievement: r.achievementPercent,
    score: r.weightedScore,
    capped: r.isCapped,
    mismatch: r.hasMismatch,
    status: KPI_STATUS_LABEL[r.status] ?? r.status,
  }));

  // Tổng hợp theo nhân sự
  const byEmp = new Map<string, typeof results>();
  for (const r of results) {
    const list = byEmp.get(r.employeeId) ?? [];
    list.push(r);
    byEmp.set(r.employeeId, list);
  }
  const totals = [...byEmp.values()]
    .map((list) => {
      const s = summarizeResults(list);
      return {
        employee: list[0].employee.fullName,
        department: list[0].employee.department?.name ?? "—",
        weight: s.totalWeight,
        score: s.totalScore,
        rank: classifyScoreFor(s.totalScore, scoreStateOf(period.status, list)).label,
      };
    })
    .sort((a, b) => b.score - a.score);

  const buffer = await buildKpiReport(period.name, rows, totals);
  const safeName = period.name.replace(/[^\w]+/g, "_");

  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="GANI_KPI_${safeName}.xlsx"`,
    },
  });
}
