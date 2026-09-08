import { prisma } from "@/lib/db";
import { handle, requireUser } from "@/lib/api";
import { assertPermission } from "@/lib/rbac";
import { buildUserTemplate } from "@/lib/excel-users";

export const runtime = "nodejs";

/** Tải file Excel mẫu để nạp danh sách nhân sự hàng loạt. */
export async function GET() {
  // Bọc trong handle(): thiếu nó thì lỗi phân quyền rơi ra ngoài thành 500,
  // người dùng đọc "Lỗi hệ thống" trong khi thực ra là họ không có quyền.
  return handle(async () => {
    const user = await requireUser();
    assertPermission(user, "admin.users");

    const departments = await prisma.department.findMany({
      select: { code: true, name: true },
      orderBy: { code: "asc" },
    });

    const buffer = await buildUserTemplate(departments);

    return new Response(buffer as ArrayBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="GANI_mau_nhap_nhan_su.xlsx"`,
      },
    });
  });
}
