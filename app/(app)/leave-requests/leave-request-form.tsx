"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export default function LeaveRequestForm() {
  const router = useRouter();
  const tomorrow = new Date(Date.now() + 24 * 3600_000);
  const [startDate, setStartDate] = useState(toLocalInputValue(tomorrow));
  const [endDate, setEndDate] = useState(toLocalInputValue(tomorrow));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const noticeMs = new Date(startDate).getTime() - Date.now();
  const isUrgent = noticeMs < 24 * 3600_000;

  async function submit() {
    setBusy(true);
    setError(null);
    setOk(false);
    try {
      const res = await fetch("/api/leave-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: new Date(startDate).toISOString(),
          endDate: new Date(endDate).toISOString(),
          reason,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Không gửi được đơn.");
        return;
      }
      setOk(true);
      setReason("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3 p-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {ok && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          Đã gửi đơn — chờ người có thẩm quyền duyệt.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-600">
            Từ ngày giờ
          </span>
          <input
            type="datetime-local"
            className="input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-600">
            Đến ngày giờ
          </span>
          <input
            type="datetime-local"
            className="input"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-600">
          Lý do
        </span>
        <textarea
          className="input"
          rows={2}
          placeholder="Vd: Việc gia đình, khám bệnh..."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>

      {isUrgent && (
        <div className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <TriangleAlert size={13} strokeWidth={2.5} className="mt-0.5 shrink-0" />
          <span>
            Chưa đủ 24 tiếng báo trước — đơn vẫn gửi được nhưng sẽ gắn nhãn
            "Khẩn cấp" để người duyệt thấy rõ.
          </span>
        </div>
      )}

      <button
        className="btn-primary btn-sm"
        disabled={busy || reason.trim().length < 3}
        onClick={submit}
      >
        Gửi đơn
      </button>
    </div>
  );
}
