import Link from "next/link";
import { redirect } from "next/navigation";
import { Package } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { withProductionRole } from "@/lib/services/production-service";
import { EmptyState, PageHeader } from "@/components/ui";
import ShiftDraftForm from "./shift-draft-form";

export const dynamic = "force-dynamic";

export default async function NewShiftPage() {
  const base = (await requireSession())!;
  const user = await withProductionRole(base);

  const canDraft =
    user.role === "CEO" ||
    ["WORKER", "TEAM_LEADER", "SUPERVISOR", "PRODUCTION_DIRECTOR"].includes(
      user.productionRole ?? ""
    );
  if (!canDraft) redirect("/production");

  const [skus, staff] = await Promise.all([
    prisma.productSku.findMany({
      where: { isActive: true },
      orderBy: { skuCode: "asc" },
    }),
    // Ai làm ca: người có vai trò trong xưởng, hoặc nhân sự phòng Sản xuất
    prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { productionRole: { not: null } },
          { department: { code: "PROD" } },
        ],
      },
      include: { department: true },
      orderBy: { fullName: "asc" },
    }),
  ]);

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
        title="Khai ca sản xuất"
        subtitle="Bước 1 trong 3. Khai xong là KCS nhận thông báo vào xác nhận phẩm chất — bạn không tự xác nhận được phần đó."
      />

      {skus.length === 0 ? (
        <EmptyState
          icon={<Package size={32} strokeWidth={1.75} />}
          title="Chưa có mã sản phẩm nào"
          hint="Phải khai danh mục SKU kèm chuẩn sản lượng và định mức hao hụt trước, vì đó là thước đo để chấm điểm ca."
        />
      ) : (
        <ShiftDraftForm
          skus={skus.map((s) => ({
            id: s.id,
            skuCode: s.skuCode,
            skuName: s.skuName,
            targetOutputKg: s.targetOutputKg,
            stdMaterialLossRate: s.stdMaterialLossRate,
          }))}
          staff={staff.map((u) => ({
            id: u.id,
            name: u.fullName,
            role: u.productionRole,
            jobTitle: u.jobTitle ?? "",
          }))}
        />
      )}
    </>
  );
}
