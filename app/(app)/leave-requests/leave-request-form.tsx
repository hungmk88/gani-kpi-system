"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert, CalendarCheck } from "lucide-react";
import { addDays, parseVnDate, vnDateKey } from "@/lib/vn-time";

type Quota = {
  total: number;
  used: number;
  remaining: number;
  half: { label: string; cap: number; used: number; remaining: number };
};

/**
 * Thời gian báo trước tính GIỐNG server: từ bây giờ tới 00:00 giờ VN của ngày
 * bắt đầu nghỉ (không theo múi giờ của trình duyệt).
 */
function noticeMsUntil(dateKey: string): number | null {
  try {
    return parseVnDate(dateKey).getTime() - Date.now();
  } catch {
    return null;
  }
}

export default function LeaveRequestForm() {
  const router = useRouter();
  const tomorrow = vnDateKey(addDays(new Date(), 1));
  const [startDate, setStartDate] = useState(tomorrow);
  const [endDate, setEndDate] = useState(tomorrow);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [quota, setQuota] = useState<Quota | null>(null);

  useEffect(() => {
    fetch("/api/leave-requests/quota")
      .then((r) => r.json())
      .then((data) => setQuota(data.quota ?? null))
      .catch(() => {});
  }, []);

  const noticeMs = noticeMsUntil(startDate);
  const isUrgent = noticeMs !== null && noticeMs < 24 * 3600_000;

  async function submit() {
    setBusy(true);
    setError(null);
    setOk(false);
    try {
      const res = await fetch("/api/leave-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Gửi nguyên "YYYY-MM-DD" — server quy về 00:00 giờ VN.
          startDate,
          endDate,
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
      {quota && (
        <div className="space-y-1 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-700">
          <div className="flex items-center gap-1.5">
            <CalendarCheck size={15} strokeWidth={2} />
            Số ngày phép còn lại trong năm: <b>{quota.remaining}/{quota.total}</b>
          </div>
          <div className="pl-[21px] text-xs text-brand-600">
            {quota.half.label}: <b>{quota.half.remaining}/{quota.half.cap}</b> — tối đa 6 ngày mỗi nửa năm
          </div>
        </div>
      )}
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
            Từ ngày
          </span>
          <input
            type="date"
            className="input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-600">
            Đến ngày
          </span>
          <input
            type="date"
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
