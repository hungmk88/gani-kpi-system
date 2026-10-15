import { prisma } from "@/lib/db";
import { handle, requireUser } from "@/lib/api";
import { buildLeaveReport, type LeaveExportRow } from "@/lib/excel";
import { leaveDaysBetween, leaveReportScope } from "@/lib/services/leave-service";
import { formatVnDate, formatVnDateTime, vnMonthRange, vnParts } from "@/lib/vn-time";

export const runtime = "nodejs";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Đang chờ",
  APPROVED: "Đã duyệt",
  REJECTED: "Đã từ chối",
  CANCELLED: "Đã huỷ",
};

/**
 * Xuất Excel tổng hợp danh sách nghỉ phép của 1 THÁNG ĐÃ XONG.
 * Danh sách chốt vào ngày cuối tháng — nên chỉ tải được từ ngày 1 tháng sau
 * trở đi, không cho tải tháng đang chạy (số còn phát sinh thêm, chưa chốt).
 * Mặc định (không truyền month/year) là tháng liền trước tháng hiện tại
 * (theo lịch VN). Phạm vi: BGĐ + phòng Kế toán xem toàn công ty; Trưởng phòng
 * chỉ xem phòng mình (xem leaveReportScope).
 */
export async function GET(req: Request) {
  // Bọc handle để chưa đăng nhập trả 401 đúng format thay vì lỗi 500.
  return handle(() => exportLeave(req));
}

async function exportLeave(req: Request) {
  const user = await requireUser();

  const scope = await leaveReportScope(user);
  if (!scope) {
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
  const today = vnParts(now);
  const prevMonth = today.month === 1 ? 12 : today.month - 1;
  const prevYear = today.month === 1 ? today.year - 1 : today.year;
  const month = Number(url.searchParams.get("month") ?? prevMonth);
  const year = Number(url.searchParams.get("year") ?? prevYear);

  if (
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2100
  ) {
    return Response.json(
      {
        statusCode: 400,
        errorCode: "VALIDATION_FAILED",
        message: "Tháng/năm không hợp lệ.",
      },
      { status: 400 }
    );
  }

  const { gte: rangeStart, lt: rangeEnd } = vnMonthRange(year, month);

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
    where: {
      startDate: { gte: rangeStart, lt: rangeEnd },
      ...(scope === "ALL" ? {} : { departmentId: scope.departmentId }),
    },
    include: {
      employee: {
        select: { fullName: true, department: { select: { name: true } } },
      },
      reviewedBy: { select: { fullName: true } },
    },
    orderBy: [
      { employee: { department: { name: "asc" } } },
      { startDate: "asc" },
    ],
  });

  const rows: LeaveExportRow[] = requests.map((r) => ({
    employee: r.employee.fullName,
    department: r.employee.department?.name ?? "—",
    startDate: formatVnDate(r.startDate),
    endDate: formatVnDate(r.endDate),
    days: leaveDaysBetween(r.startDate, r.endDate),
    reason: r.reason,
    isUrgent: r.isUrgent,
    status: STATUS_LABEL[r.status] ?? r.status,
    reviewedBy: r.reviewedBy?.fullName ?? "—",
    reviewNote: r.reviewNote ?? "",
    createdAt: formatVnDateTime(r.createdAt),
  }));

  const scopeLabel =
    scope === "ALL"
      ? "toàn công ty"
      : requests[0]?.employee.department?.name ?? "phòng của bạn";
  const rangeLabel = `Tháng ${String(month).padStart(2, "0")}/${year} — ${scopeLabel}`;
  const buffer = await buildLeaveReport(rangeLabel, rows);

  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="GANI_NghiPhep_${String(month).padStart(2, "0")}_${year}.xlsx"`,
    },
  });
}
