import { prisma } from "@/lib/db";
import { ANNUAL_LEAVE_QUOTA_DAYS, HALF_YEAR_LEAVE_CAP_DAYS } from "@/lib/constants";

/** Số ngày của một đơn nghỉ phép — dùng thống nhất ở mọi chỗ tính ngày. */
export function leaveDaysBetween(start: Date, end: Date): number {
  return Math.round(((end.getTime() - start.getTime()) / 86_400_000) * 10) / 10;
}

/**
 * Hạn mức phép năm — 12 ngày/người/năm, cố định trong code, áp dụng chung
 * cho mọi người dùng trang Nghỉ phép (chưa phân biệt thâm niên/loại hợp
 * đồng — làm sau nếu cần). "Đã dùng" chỉ tính đơn đã DUYỆT (APPROVED)
 * trong năm dương lịch hiện tại — đơn đang chờ/bị từ chối không trừ.
 *
 * Thêm trần nửa năm — chốt 15/09/2026: tối đa 6 ngày mỗi nửa (Th01-Th06 /
 * Th07-Th12), chống dồn hết 12 ngày vào nửa đầu năm. Nửa năm tính theo
 * NGÀY GỌI HÀM (thường là "hôm nay" lúc nhân viên vào form gửi đơn), không
 * theo ngày bắt đầu nghỉ họ chọn trong form — đơn giản hoá, chấp nhận lệch
 * nhỏ nếu ai đó xin nghỉ ở nửa năm sau nhưng xem số vào cuối nửa năm trước.
 */
export async function getAnnualLeaveQuota(userId: string, year: number) {
  const rangeStart = new Date(year, 0, 1, 0, 0, 0, 0);
  const rangeEnd = new Date(year + 1, 0, 1, 0, 0, 0, 0);

  const approved = await prisma.leaveRequest.findMany({
    where: {
      employeeId: userId,
      status: "APPROVED",
      startDate: { gte: rangeStart, lt: rangeEnd },
    },
    select: { startDate: true, endDate: true },
  });

  const used =
    Math.round(
      approved.reduce((s, r) => s + leaveDaysBetween(r.startDate, r.endDate), 0) * 10
    ) / 10;

  const now = new Date();
  const isFirstHalf = now.getFullYear() !== year || now.getMonth() < 6;
  const halfLabel = isFirstHalf
    ? "Nửa đầu năm (Th01–Th06)"
    : "Nửa cuối năm (Th07–Th12)";
  const halfUsed =
    Math.round(
      approved
        .filter((r) => (r.startDate.getMonth() < 6) === isFirstHalf)
        .reduce((s, r) => s + leaveDaysBetween(r.startDate, r.endDate), 0) * 10
    ) / 10;

  return {
    year,
    total: ANNUAL_LEAVE_QUOTA_DAYS,
    used,
    remaining: Math.round((ANNUAL_LEAVE_QUOTA_DAYS - used) * 10) / 10,
    half: {
      label: halfLabel,
      cap: HALF_YEAR_LEAVE_CAP_DAYS,
      used: halfUsed,
      remaining: Math.round((HALF_YEAR_LEAVE_CAP_DAYS - halfUsed) * 10) / 10,
    },
  };
}

/**
 * Chỉ Trưởng phòng, Ban Giám đốc và phòng Kế toán mới được tải file tổng
 * hợp nghỉ phép toàn công ty — theo yêu cầu 14/09/2026. Dùng chung cho cả
 * route xuất Excel và trang /leave-requests (ẩn/hiện nút tải).
 */
export async function canExportLeaveReport(user: {
  role: string;
  departmentId: string | null;
}): Promise<boolean> {
  if (user.role === "MANAGER" || user.role === "CEO") return true;
  if (!user.departmentId) return false;
  const dept = await prisma.department.findUnique({
    where: { id: user.departmentId },
  });
  return dept?.code === "ACC";
}
