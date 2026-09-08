import { prisma } from "@/lib/db";
import { handle, requireUser } from "@/lib/api";
import { assertPermission } from "@/lib/rbac";
import { buildImportTemplate } from "@/lib/excel";

export const runtime = "nodejs";

/** Tải file Excel mẫu để phòng ban đổ số thực tế. */
export async function GET() {
  // Cùng lý do như mẫu nhân sự: không bọc thì lỗi phân quyền thành 500.
  return handle(async () => {
    const user = await requireUser();
    assertPermission(user, "kpi.import");

    const [defs, users] = await Promise.all([
      prisma.kpiDefinition.findMany({
        where: { isActive: true },
        include: { department: true },
        orderBy: { code: "asc" },
      }),
      prisma.user.findMany({
        where: { isActive: true, role: { not: "ADMIN" } },
        include: { department: true },
        orderBy: { fullName: "asc" },
      }),
    ]);

    const buffer = await buildImportTemplate(
      defs.map((d) => ({
        code: d.code,
        name: d.name,
        unit: d.unit,
        department: d.department?.name ?? "—",
      })),
      users.map((u) => ({
        email: u.email,
        fullName: u.fullName,
        department: u.department?.name ?? "—",
      })),
    );

    return new Response(buffer as ArrayBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="GANI_KPI_mau_nhap_so.xlsx"`,
      },
    });
  });
}
