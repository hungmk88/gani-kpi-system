"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

export default function LeaveRequestActions({
  requestId,
  mode,
}: {
  requestId: string;
  mode: "review" | "cancel";
}) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
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
          onClick={() => send("CANCEL")}
        >
          Huỷ đơn
        </button>
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
