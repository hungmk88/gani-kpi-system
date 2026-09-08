import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { withProductionRole } from "@/lib/services/production-service";
import { PageHeader } from "@/components/ui";
import SkuManager from "./sku-manager";

export const dynamic = "force-dynamic";

export default async function SkusPage() {
  const base = (await requireSession())!;
  const user = await withProductionRole(base);

  const isInsider =
    user.role === "CEO" || user.role === "ADMIN" || !!user.productionRole;
  if (!isInsider) redirect("/dashboard");

  const canEdit =
    user.role === "CEO" ||
    user.role === "ADMIN" ||
    user.productionRole === "PRODUCTION_DIRECTOR";

  const skus = await prisma.productSku.findMany({
    include: { _count: { select: { shiftLogs: true } } },
    orderBy: [{ isActive: "desc" }, { skuCode: "asc" }],
  });

  return (
    <>
      <div className="mb-4">
        <Link
          href="/production"
          className="text-sm text-ink-500 hover:text-brand-600"
        >
          ← Xưởng sản xuất
        </Link>
      </div>

      <PageHeader
        title="Danh mục sản phẩm & chuẩn"
        subtitle="Chuẩn của mỗi mã phải đặt TRƯỚC khi chạy ca. Đây là thước đo để chấm điểm — Ban Giám đốc đặt chỉ tiêu khác chuẩn lúc khoá số thì bắt buộc ghi lý do."
      />

      <SkuManager
        canEdit={canEdit}
        skus={skus.map((s) => ({
          id: s.id,
          skuCode: s.skuCode,
          skuName: s.skuName,
          targetOutputKg: s.targetOutputKg,
          stdMaterialLossRate: s.stdMaterialLossRate,
          stdKgPerLaborHour: s.stdKgPerLaborHour,
          unitPriceVnd: s.unitPriceVnd,
          isActive: s.isActive,
          shiftCount: s._count.shiftLogs,
        }))}
      />
    </>
  );
}
