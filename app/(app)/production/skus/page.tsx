import Link from "next/link";
import { redirect } from "next/navigation";
import { Package } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canSeeMoney, withProductionRole } from "@/lib/services/production-service";
import { PageHeader } from "@/components/ui";
import SkuManager from "./sku-manager";

export const dynamic = "force-dynamic";

export default async function SkusPage() {
  const base = (await requireSession())!;
  const user = await withProductionRole(base);

  const isInsider =
    user.role === "CEO" || user.role === "ADMIN" || !!user.productionRole;
  if (!isInsider) redirect("/dashboard");

  const showMoney = canSeeMoney(user);
  const canEdit =
    user.role === "CEO" ||
    user.role === "ADMIN" ||
    user.productionRole === "PRODUCTION_DIRECTOR";

  const [skus, rawMaterials] = await Promise.all([
    prisma.productSku.findMany({
      include: { _count: { select: { shiftLogs: true } }, rawMaterial: true },
      orderBy: [{ isActive: "desc" }, { skuCode: "asc" }],
    }),
    prisma.rawMaterial.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
    }),
  ]);

  return (
    <>
      <div className="mb-4">
        <Link
          href="/production"
          className="text-sm text-ink-500 hover:text-brand-700"
        >
          ← Xưởng sản xuất
        </Link>
      </div>

      <PageHeader
        title="Danh mục sản phẩm & chuẩn"
        subtitle="Chuẩn của mỗi mã phải đặt TRƯỚC khi chạy ca. Đây là thước đo để chấm điểm — Ban Giám đốc đặt chỉ tiêu khác chuẩn lúc khoá số thì bắt buộc ghi lý do."
        actions={
          <Link href="/production/raw-materials" className="btn-ghost btn-sm">
            <Package size={14} strokeWidth={2} /> Kho NVL
          </Link>
        }
      />

      <SkuManager
        canEdit={canEdit}
        showMoney={showMoney}
        rawMaterials={rawMaterials.map((m) => ({
          id: m.id,
          code: m.code,
          name: m.name,
        }))}
        skus={skus.map((s) => ({
          id: s.id,
          skuCode: s.skuCode,
          skuName: s.skuName,
          targetOutputKg: s.targetOutputKg,
          stdMaterialLossRate: s.stdMaterialLossRate,
          stdKgPerLaborHour: s.stdKgPerLaborHour,
          // Đơn giá là số tiền — chỉ BGĐ / Giám đốc SX mới nhận được
          unitPriceVnd: showMoney ? s.unitPriceVnd : null,
          isActive: s.isActive,
          shiftCount: s._count.shiftLogs,
          rawMaterialId: s.rawMaterialId,
          rawMaterialName: s.rawMaterial?.name ?? null,
        }))}
      />
    </>
  );
}
