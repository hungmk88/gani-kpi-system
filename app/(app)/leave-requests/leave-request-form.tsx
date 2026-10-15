"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert, CalendarCheck } from "lucide-react";
import { addDays, parseVnDate, vnDateKey, vnDayDiff } from "@/lib/vn-time";
import { toast } from "@/components/toast";
import { fmtNum } from "@/lib/format";

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
  const [quota, setQuota] = useState<Quota | null>(null);

  useEffect(() => {
    fetch("/api/leave-requests/quota")
      .then((r) => r.json())
      .then((data) => setQuota(data.quota ?? null))
      .catch(() => {});
  }, []);

  const noticeMs = noticeMsUntil(startDate);
  // Cùng cách trừ phép với server (leaveDaysBetween): ngày lịch, gồm cả ngày
  // đầu và ngày cuối, không trừ cuối tuần.
  let days: number | null = null;
  try {
    days = Math.max(0, vnDayDiff(parseVnDate(startDate), parseVnDate(endDate)) + 1);
  } catch {
    days = null;
  }
  const isUrgent = noticeMs !== null && noticeMs < 24 * 3600_000;

  async function submit() {
    setBusy(true);
    setError(null);
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "Không gửi được đơn.");
        return;
      }
      toast("Đã gửi đơn — chờ người có thẩm quyền duyệt.");
      setReason("");
      router.refresh();
    } catch {
      setError("Mất kết nối tới máy chủ. Kiểm tra mạng rồi thử lại.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3 p-4">
      {quota && (
        <div className="space-y-1 rounded-md bg-ink-50 px-3 py-2 text-sm text-ink-700 tabular-nums">
          <div className="flex items-center gap-1.5">
            <CalendarCheck size={16} strokeWidth={2} className="text-ink-500" aria-hidden />
            Số ngày phép còn lại trong năm:{" "}
            <b>
              {fmtNum(quota.remaining)}/{fmtNum(quota.total)}
            </b>
          </div>
          <div className="pl-[22px] text-xs text-ink-500">
            {quota.half.label}:{" "}
            <b>
              {fmtNum(quota.half.remaining)}/{fmtNum(quota.half.cap)}
            </b>{" "}
            — tối đa {fmtNum(quota.half.cap)} ngày mỗi nửa năm
          </div>
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
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

      {days !== null && days > 0 && (
        <div className="text-xs text-ink-600 tabular-nums">
          Đơn này: <b>{fmtNum(days)} ngày lịch</b> (tính cả cuối tuần — đúng
          cách trừ phép)
        </div>
      )}

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
