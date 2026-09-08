import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { withProductionRole } from "@/lib/services/production-service";
import { PageHeader } from "@/components/ui";
import RawMaterialManager from "./raw-material-manager";

export const dynamic = "force-dynamic";

export default async function RawMaterialsPage() {
  const base = (await requireSession())!;
  const user = await withProductionRole(base);

  const isInsider =
    user.role === "CEO" || user.role === "ADMIN" || !!user.productionRole;
  if (!isInsider) redirect("/dashboard");

  const canEdit =
    user.role === "CEO" ||
    user.role === "ADMIN" ||
    user.productionRole === "PRODUCTION_DIRECTOR";

  const materials = await prisma.rawMaterial.findMany({
    orderBy: [{ isActive: "desc" }, { code: "asc" }],
    include: {
      transactions: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { createdBy: { select: { fullName: true } } },
      },
    },
  });

  return (
    <>
      <div className="mb-4">
        <Link
          href="/production/skus"
          className="text-sm text-ink-500 hover:text-brand-600"
        >
          ← Danh mục sản phẩm & chuẩn
        </Link>
      </div>

      <PageHeader
        title="Kho NVL (lý thuyết)"
        subtitle='Trừ TỰ ĐỘNG theo định mức SKU mỗi khi Ban Giám đốc khoá số một ca — không phải số NVL thực tế đã dùng. Dùng để đối chiếu với kho thực tế sau này, không phải để đo hiệu suất (việc đó đã có ở "chống chạy chỉ tiêu").'
      />

      <RawMaterialManager canEdit={canEdit} materials={materials.map((m) => ({
        id: m.id,
        code: m.code,
        name: m.name,
        unit: m.unit,
        currentStockKg: m.currentStockKg,
        isActive: m.isActive,
        transactions: m.transactions.map((t) => ({
          id: t.id,
          type: t.type,
          quantityKg: t.quantityKg,
          balanceAfterKg: t.balanceAfterKg,
          note: t.note,
          createdByName: t.createdBy?.fullName ?? null,
          createdAt: t.createdAt.toISOString(),
        })),
      }))} />
    </>
  );
}
