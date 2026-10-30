"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { toast } from "@/components/toast";
import { fetchJson, jsonInit } from "@/lib/fetch-json";

export default function RequestActions({
  requestId,
  team,
}: {
  requestId: string;
  team: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [assigneeId, setAssigneeId] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(action: "ACCEPT" | "REJECT") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchJson(
        `/api/requests/${requestId}`,
        jsonInit("PATCH", {
          action,
          assigneeId: assigneeId || null,
          rejectReason: reason || undefined,
        })
      );
      if (!res.ok) {
        setError(res.message || "Không xử lý được.");
        return;
      }
      toast(
        action === "ACCEPT"
          ? "Đã tiếp nhận yêu cầu — việc đã được tạo cho phòng bạn."
          : "Đã từ chối yêu cầu."
      );
      router.refresh();
    } catch {
      setError("Mất kết nối tới máy chủ. Kiểm tra mạng rồi thử lại.");
    } finally {
      setBusy(false);
    }
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
            aria-label="Lý do từ chối yêu cầu"
            placeholder="Lý do từ chối (bắt buộc)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              className="btn-danger btn-sm"
              disabled={busy || !reason.trim()}
              onClick={() => send("REJECT")}
            >
              Xác nhận từ chối
            </button>
            <button
              className="btn-ghost btn-sm"
              disabled={busy}
              onClick={() => setRejecting(false)}
            >
              Quay lại
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input w-auto min-w-52"
            aria-label="Người phụ trách khi tiếp nhận"
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
          >
            <option value="">Nhận trước, phân công sau</option>
            {team.map((u) => (
              <option key={u.id} value={u.id}>
                Giao cho {u.name}
              </option>
            ))}
          </select>
          <button
            className="btn-primary btn-sm inline-flex items-center gap-1.5"
            disabled={busy}
            onClick={() => send("ACCEPT")}
          >
            <Check size={14} strokeWidth={2.5} /> Tiếp nhận &amp; tạo việc
          </button>
          <button
            className="btn-ghost btn-sm"
            onClick={() => setRejecting(true)}
          >
            Từ chối
          </button>
        </div>
      )}
    </div>
  );
}
