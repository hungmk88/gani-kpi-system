import { prisma } from "@/lib/db";

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
