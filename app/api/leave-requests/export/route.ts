import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/api";
import { buildLeaveReport, type LeaveExportRow } from "@/lib/excel";
import { formatDateTime } from "@/components/ui";

export const runtime = "nodejs";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Đang chờ",
  APPROVED: "Đã duyệt",
  REJECTED: "Đã từ chối",
  CANCELLED: "Đã huỷ",
};

/**
 * Xuất Excel danh sách đơn nghỉ phép trong 1 tháng dương lịch — tự xuất lúc
 * bấm, không phải báo cáo hẹn giờ. `month`/`year` mặc định tháng hiện tại.
 */
export async function GET(req: Request) {
  const user = await requireUser();
  const url = new URL(req.url);
  const now = new Date();
  const month = Number(url.searchParams.get("month") ?? now.getMonth() + 1);
  const year = Number(url.searchParams.get("year") ?? now.getFullYear());

  const rangeStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const rangeEnd = new Date(year, month, 1, 0, 0, 0, 0);

  const scopeWhere =
    user.role === "CEO" || user.role === "ADMIN"
      ? {}
      : user.role === "MANAGER"
        ? {
            OR: [
              { employeeId: user.id },
              {
                departmentId: user.departmentId ?? "__none__",
                employee: { role: { not: "MANAGER" as const } },
              },
            ],
          }
        : { employeeId: user.id };

  const requests = await prisma.leaveRequest.findMany({
    where: {
      ...scopeWhere,
      startDate: { gte: rangeStart, lt: rangeEnd },
    },
    include: { employee: { include: { department: true } }, reviewedBy: true },
    orderBy: [{ startDate: "asc" }],
  });

  const rows: LeaveExportRow[] = requests.map((r) => ({
    employee: r.employee.fullName,
    department: r.employee.department?.name ?? "—",
    startDate: formatDateTime(r.startDate),
    endDate: formatDateTime(r.endDate),
    days:
      Math.round(
        ((r.endDate.getTime() - r.startDate.getTime()) / 86_400_000) * 10
      ) / 10,
    reason: r.reason,
    isUrgent: r.isUrgent,
    status: STATUS_LABEL[r.status] ?? r.status,
    reviewedBy: r.reviewedBy?.fullName ?? "—",
    reviewNote: r.reviewNote ?? "",
    createdAt: formatDateTime(r.createdAt),
  }));

  const rangeLabel = `Tháng ${String(month).padStart(2, "0")}/${year}`;
  const buffer = await buildLeaveReport(rangeLabel, rows);

  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="GANI_NghiPhep_${String(month).padStart(2, "0")}_${year}.xlsx"`,
    },
  });
}
