import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Undo2 } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  canResubmitReturnedShift,
  withProductionRole,
} from "@/lib/services/production-service";
import { extractShiftReturn } from "@/lib/production/shift-flow";
import { SHIFT_TYPE_LABEL } from "@/lib/production/constants";
import { fmtDate } from "@/lib/format";
import { vnDateKey } from "@/lib/vn-time";
import { PageHeader } from "@/components/ui";
import ShiftDraftForm from "../../new/shift-draft-form";
import { loadDraftFormData } from "../../new/form-data";

export const dynamic = "force-dynamic";

/**
 * Sửa ca bị KCS trả về rồi gửi lại. Chỉ người đã khai ca, chỉ khi ca đang ở
 * trạng thái "trả về" — mọi trường hợp khác quay về trang chi tiết (máy chủ
 * cũng chặn lại ở resubmitShiftDraft).
 */
export default async function EditShiftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const base = (await requireSession())!;
  const user = await withProductionRole(base);

  const log = await prisma.productionShiftLog.findUnique({
    where: { id },
    include: {
      participants: true,
      createdBy: { select: { id: true, isActive: true, role: true, productionRole: true } },
    },
  });
  if (!log) notFound();

  const returned = log.status === "DRAFT" ? extractShiftReturn(log.qcNote) : null;
  if (!returned || !canResubmitReturnedShift(user, log.createdBy)) {
    redirect(`/production/${id}`);
  }

  const { skus, staff } = await loadDraftFormData();

  return (
    <>
      <div className="mb-4">
        <Link
          href={`/production/${id}`}
          className="text-sm text-ink-500 hover:text-brand-700"
        >
          ← Chi tiết ca
        </Link>
      </div>

      <PageHeader
        title={`Sửa ca ${SHIFT_TYPE_LABEL[log.shiftType] ?? log.shiftType} · ${fmtDate(log.shiftDate)}`}
        subtitle="KCS đã trả ca này về. Sửa theo lý do bên dưới rồi gửi lại — ca quay về chờ KCS xác nhận."
      />

      <div
        role="status"
        className="mb-4 flex max-w-3xl items-start gap-3 rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        <Undo2 size={18} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
        <div className="min-w-0">
          <div className="font-semibold">{returned.by} yêu cầu sửa</div>
          <div className="mt-0.5 whitespace-pre-line">{returned.reason}</div>
        </div>
      </div>

      <ShiftDraftForm
        skus={skus}
        staff={staff}
        initial={{
          shiftId: log.id,
          shiftDate: vnDateKey(log.shiftDate),
          shiftType: log.shiftType,
          skuId: log.skuId,
          rawOutputKg: log.rawOutputKg,
          rawMaterialInputKg: log.rawMaterialInputKg,
          downtimeHours: log.downtimeHours,
          draftNote: log.draftNote ?? "",
          rows: log.participants.map((p) => ({
            userId: p.userId,
            stage: p.stage,
            hoursWorked: p.hoursWorked,
            scheduledHours: p.scheduledHours,
          })),
        }}
      />
    </>
  );
}
