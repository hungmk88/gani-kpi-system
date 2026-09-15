import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/api";
import { buildLeaveReport, type LeaveExportRow } from "@/lib/excel";
import { formatDateTime } from "@/components/ui";
import { canExportLeaveReport, leaveDaysBetween } from "@/lib/services/leave-service";

export const runtime = "nodejs";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Đang chờ",
  APPROVED: "Đã duyệt",
  REJECTED: "Đã từ chối",
  CANCELLED: "Đã huỷ",
};

/**
 * Xuất Excel tổng hợp TOÀN CÔNG TY danh sách nghỉ phép của 1 THÁNG ĐÃ XONG.
 * Danh sách chốt vào ngày cuối tháng — nên chỉ tải được từ ngày 1 tháng sau
 * trở đi, không cho tải tháng đang chạy (số còn phát sinh thêm, chưa chốt).
 * Mặc định (không truyền month/year) là tháng liền trước tháng hiện tại.
 */
export async function GET(req: Request) {
  const user = await requireUser();

  const allowed = await canExportLeaveReport(user);
  if (!allowed) {
    return Response.json(
      {
        statusCode: 403,
        errorCode: "FORBIDDEN",
        message:
          "Chỉ Trưởng phòng, Ban Giám đốc và phòng Kế toán mới tải được file tổng hợp nghỉ phép.",
      },
      { status: 403 }
    );
  }

  const url = new URL(req.url);
  const now = new Date();
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const month = Number(
    url.searchParams.get("month") ?? prevMonthDate.getMonth() + 1
  );
  const year = Number(
    url.searchParams.get("year") ?? prevMonthDate.getFullYear()
  );

  const rangeStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const rangeEnd = new Date(year, month, 1, 0, 0, 0, 0);

  if (rangeEnd > now) {
    return Response.json(
      {
        statusCode: 400,
        errorCode: "VALIDATION_FAILED",
        message:
          "Tháng này chưa kết thúc nên chưa chốt được danh sách. Chỉ tải được tháng đã xong, từ ngày 1 tháng sau trở đi.",
      },
      { status: 400 }
    );
  }

  const requests = await prisma.leaveRequest.findMany({
    where: { startDate: { gte: rangeStart, lt: rangeEnd } },
    include: { employee: { include: { department: true } }, reviewedBy: true },
    orderBy: [
      { employee: { department: { name: "asc" } } },
      { startDate: "asc" },
    ],
  });

  const rows: LeaveExportRow[] = requests.map((r) => ({
    employee: r.employee.fullName,
    department: r.employee.department?.name ?? "—",
    startDate: formatDateTime(r.startDate),
    endDate: formatDateTime(r.endDate),
    days: leaveDaysBetween(r.startDate, r.endDate),
    reason: r.reason,
    isUrgent: r.isUrgent,
    status: STATUS_LABEL[r.status] ?? r.status,
    reviewedBy: r.reviewedBy?.fullName ?? "—",
    reviewNote: r.reviewNote ?? "",
    createdAt: formatDateTime(r.createdAt),
  }));

  const rangeLabel = `Tháng ${String(month).padStart(2, "0")}/${year} — toàn công ty`;
  const buffer = await buildLeaveReport(rangeLabel, rows);

  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="GANI_NghiPhep_${String(month).padStart(2, "0")}_${year}.xlsx"`,
    },
  });
}
