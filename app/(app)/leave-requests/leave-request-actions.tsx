"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import ConfirmDialog from "@/components/confirm-dialog";

/**
 * Nút thao tác trên một đơn nghỉ.
 * - review: Trưởng phòng / BGĐ duyệt hoặc từ chối đơn đang chờ.
 * - cancel: người gửi tự huỷ đơn của mình (đang chờ, hoặc đã duyệt nhưng
 *   chưa tới ngày nghỉ — `approved` = true thì hỏi xác nhận trước).
 * - cancel-other: Trưởng phòng / BGĐ huỷ hộ đơn ĐÃ DUYỆT chưa tới ngày nghỉ,
 *   bắt buộc ghi lý do (người gửi nhận thông báo kèm lý do).
 */
export default function LeaveRequestActions({
  requestId,
  mode,
  approved = false,
}: {
  requestId: string;
  mode: "review" | "cancel" | "cancel-other";
  approved?: boolean;
}) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(action: "APPROVE" | "REJECT" | "CANCEL") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/leave-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: note || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Không xử lý được.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (mode === "cancel") {
    return (
      <div>
        {error && <div className="mb-1 text-xs text-red-600">{error}</div>}
        <button
          className="btn-ghost btn-sm"
          disabled={busy}
          onClick={() => (approved ? setAskCancel(true) : send("CANCEL"))}
        >
          {approved ? "Huỷ đơn đã duyệt" : "Huỷ đơn"}
        </button>
        <ConfirmDialog
          open={askCancel}
          busy={busy}
          tone="danger"
          title="Huỷ đơn nghỉ đã duyệt?"
          confirmLabel="Huỷ đơn"
          cancelLabel="Giữ đơn"
          onClose={() => setAskCancel(false)}
          onConfirm={() => {
            setAskCancel(false);
            send("CANCEL");
          }}
        >
          <p>
            Ngày phép được trả lại và người đã duyệt sẽ nhận thông báo đơn bị huỷ.
          </p>
        </ConfirmDialog>
      </div>
    );
  }

  if (mode === "cancel-other") {
    return (
      <div>
        {error && <div className="mb-1 text-xs text-red-600">{error}</div>}
        {cancelling ? (
          <div className="space-y-2">
            <input
              className="input"
              placeholder="Lý do huỷ đơn đã duyệt (bắt buộc)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                className="btn-danger btn-sm"
                disabled={busy || !note.trim()}
                onClick={() => send("CANCEL")}
              >
                Xác nhận huỷ
              </button>
              <button className="btn-ghost btn-sm" onClick={() => setCancelling(false)}>
                Quay lại
              </button>
            </div>
          </div>
        ) : (
          <button className="btn-ghost btn-sm" onClick={() => setCancelling(true)}>
            Huỷ đơn
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="border-t border-ink-100 pt-3">
      {error && (
        <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {rejecting ? (
        <div className="space-y-2">
          <input
            className="input"
            placeholder="Lý do từ chối (bắt buộc)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              className="btn-danger btn-sm"
              disabled={busy || !note.trim()}
              onClick={() => send("REJECT")}
            >
              Xác nhận từ chối
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setRejecting(false)}>
              Quay lại
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn-success btn-sm inline-flex items-center gap-1.5"
            disabled={busy}
            onClick={() => send("APPROVE")}
          >
            <Check size={14} strokeWidth={2.5} /> Duyệt
          </button>
          <button className="btn-ghost btn-sm" onClick={() => setRejecting(true)}>
            Từ chối
          </button>
        </div>
      )}
    </div>
  );
}
