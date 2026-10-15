"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Play,
  Ban,
  Check,
  Undo2,
  CircleCheck,
  type LucideIcon,
} from "lucide-react";
import ConfirmDialog from "@/components/confirm-dialog";
import StickyActions from "@/components/sticky-actions";
import { toast } from "@/components/toast";
import { TASK_STATUS_LABEL } from "@/lib/constants";
import {
  TASK_REASON_MIN_LENGTH,
  reasonRequiredFor,
  type TaskReasonKind,
} from "@/lib/task-rules";

type Quick = {
  label: string;
  icon: LucideIcon;
  status: string;
  primary: boolean;
  /** Lời xác nhận hiện ra sau khi máy chủ nhận */
  done: string;
};

/**
 * Nút bấm nhanh — nhân viên ngoài xưởng cập nhật việc trong 3 chạm.
 * Liệt kê theo thứ tự hiển thị: nút phụ trước, nút chính sau (nằm bên phải /
 * dưới ngón cái trên điện thoại).
 */
const QUICK: Record<string, Quick[]> = {
  TO_DO: [
    { label: "Báo tắc", icon: Ban, status: "BLOCKED", primary: false, done: "Đã báo tắc — trưởng phòng đã nhận thông báo" },
    { label: "Bắt đầu làm", icon: Play, status: "IN_PROGRESS", primary: true, done: "Đã chuyển sang Đang làm" },
  ],
  IN_PROGRESS: [
    { label: "Báo tắc", icon: Ban, status: "BLOCKED", primary: false, done: "Đã báo tắc — trưởng phòng đã nhận thông báo" },
    { label: "Xong, xin nghiệm thu", icon: Check, status: "REVIEW", primary: true, done: "Đã gửi nghiệm thu" },
  ],
  BLOCKED: [
    { label: "Đã gỡ, làm tiếp", icon: Play, status: "IN_PROGRESS", primary: true, done: "Đã chuyển sang Đang làm" },
  ],
  REVIEW: [
    { label: "Làm lại", icon: Undo2, status: "IN_PROGRESS", primary: false, done: "Đã trả việc về làm lại" },
  ],
  DONE: [
    { label: "Mở lại việc", icon: Undo2, status: "IN_PROGRESS", primary: false, done: "Đã mở lại việc" },
  ],
};

const REASON_COPY: Record<
  TaskReasonKind,
  { title: string; label: string; placeholder: string; body: string }
> = {
  BLOCK: {
    title: "Báo việc đang bị tắc",
    label: "Tắc vì gì, cần ai gỡ?",
    placeholder: "Ví dụ: chờ phòng Mua hàng giao bao bì, dự kiến 18/10",
    body: "Trưởng phòng sẽ nhận thông báo kèm lý do này. Lý do được ghi vào dòng trao đổi của việc.",
  },
  REOPEN: {
    title: "Trả việc về làm tiếp",
    label: "Cần sửa / làm thêm gì?",
    placeholder: "Ví dụ: ảnh nghiệm thu thiếu tem lô, chụp lại giúp",
    body: "Việc quay lại trạng thái Đang làm. Lý do được ghi vào dòng trao đổi để người làm biết cần sửa gì.",
  },
};

/**
 * Thanh nút đổi trạng thái của màn chi tiết công việc. Đặt ngay dưới trạng
 * thái + hạn chót ở đầu trang; trên điện thoại nó dính đáy màn hình.
 */
export default function StatusActions({
  taskId,
  status,
  canManage,
}: {
  taskId: string;
  status: string;
  /** Người giao việc / trưởng phòng phụ trách / BGĐ — khớp luật ở API */
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<Quick | null>(null);

  // Mở lại việc đã nghiệm thu là quyền của người quản việc — API cũng chặn.
  const quick: Quick[] =
    status === "DONE" && !canManage ? [] : [...(QUICK[status] ?? [])];
  if (status === "REVIEW" && canManage) {
    quick.push({
      label: "Nghiệm thu · Hoàn thành",
      icon: CircleCheck,
      status: "DONE",
      primary: true,
      done: "Đã nghiệm thu, việc hoàn thành",
    });
  }
  if (quick.length === 0) return null;

  async function apply(q: Quick, note?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: q.status, note: note || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "Không cập nhật được.");
        return;
      }
      setAsking(null);
      toast(q.done);
      router.refresh();
    } catch {
      setError("Mất kết nối tới máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  function press(q: Quick) {
    if (reasonRequiredFor(status, q.status)) {
      setError(null);
      setAsking(q);
    } else {
      apply(q);
    }
  }

  const kind = asking ? reasonRequiredFor(status, asking.status) : null;
  const copy = kind ? REASON_COPY[kind] : null;

  return (
    <>
      {error && !asking && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <StickyActions>
        {quick.map((q) => (
          <button
            key={q.status}
            type="button"
            disabled={busy}
            onClick={() => press(q)}
            className={`${q.primary ? "btn-primary" : "btn-ghost"} inline-flex items-center justify-center gap-1.5`}
          >
            <q.icon size={16} strokeWidth={2} aria-hidden /> {q.label}
          </button>
        ))}
      </StickyActions>

      <ConfirmDialog
        open={!!asking}
        title={copy?.title ?? ""}
        confirmLabel={asking?.label ?? "Xác nhận"}
        tone={kind === "BLOCK" ? "danger" : "primary"}
        reason={
          copy
            ? {
                label: copy.label,
                placeholder: copy.placeholder,
                minLength: TASK_REASON_MIN_LENGTH,
              }
            : undefined
        }
        busy={busy}
        error={asking ? error : null}
        onConfirm={(reason) => asking && apply(asking, reason)}
        onClose={() => {
          setAsking(null);
          setError(null);
        }}
      >
        {copy && asking && (
          <p>
            {TASK_STATUS_LABEL[status] ?? status} →{" "}
            <b>{TASK_STATUS_LABEL[asking.status] ?? asking.status}</b>. {copy.body}
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}
