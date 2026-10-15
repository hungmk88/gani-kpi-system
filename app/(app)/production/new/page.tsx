import Link from "next/link";
import { redirect } from "next/navigation";
import { Package } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { withProductionRole } from "@/lib/services/production-service";
import { EmptyState, PageHeader } from "@/components/ui";
import ShiftDraftForm from "./shift-draft-form";
import { canDraftShift, loadDraftFormData } from "./form-data";

export const dynamic = "force-dynamic";

export default async function NewShiftPage() {
  const base = (await requireSession())!;
  const user = await withProductionRole(base);

  if (!canDraftShift(user)) redirect("/production");

  const { skus, staff } = await loadDraftFormData();

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
        <ShiftDraftForm skus={skus} staff={staff} />
      )}
    </>
  );
}
