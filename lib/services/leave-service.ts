import { prisma } from "@/lib/db";
import { ANNUAL_LEAVE_QUOTA_DAYS } from "@/lib/constants";

/** Số ngày của một đơn nghỉ phép — dùng thống nhất ở mọi chỗ tính ngày. */
export function leaveDaysBetween(start: Date, end: Date): number {
  return Math.round(((end.getTime() - start.getTime()) / 86_400_000) * 10) / 10;
}

/**
 * Hạn mức phép năm — 12 ngày/người/năm, cố định trong code, áp dụng chung
 * cho mọi người dùng trang Nghỉ phép (chưa phân biệt thâm niên/loại hợp
 * đồng — làm sau nếu cần). "Đã dùng" chỉ tính đơn đã DUYỆT (APPROVED)
 * trong năm dương lịch hiện tại — đơn đang chờ/bị từ chối không trừ.
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

  return {
    year,
    total: ANNUAL_LEAVE_QUOTA_DAYS,
    used,
    remaining: Math.round((ANNUAL_LEAVE_QUOTA_DAYS - used) * 10) / 10,
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
