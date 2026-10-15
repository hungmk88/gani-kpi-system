"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { vnParts } from "@/lib/vn-time";

export default function OpenPeriodButton() {
  const router = useRouter();
  // Tháng/năm theo lịch VN — server (UTC) và trình duyệt ra cùng giá trị.
  const now = vnParts();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(now.month);
  const [year, setYear] = useState(now.year);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/kpi/periods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, year, autoAssign: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "Không mở được kỳ.");
        return;
      }
      setOpen(false);
      router.push(`/kpi/${data.period.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        <Plus size={16} aria-hidden /> Mở kỳ KPI mới
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-md p-5">
        <h3 className="mb-1 text-lg font-bold text-ink-900">Mở kỳ KPI mới</h3>
        <p className="mb-4 text-sm text-ink-500">
          Hệ thống tự đặt hạn theo lịch đã chốt: nhân viên khai đến hết ngày 2,
          trưởng phòng duyệt đến hết ngày 4, Ban Giám đốc chốt ngày 5 của tháng
          kế tiếp.
        </p>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="label">Tháng đánh giá</label>
            <select
              className="input"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  Tháng {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Năm</label>
            <input
              type="number"
              className="input"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="mb-4 rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-700">
          Toàn bộ nhân sự sẽ được gán sẵn bộ chỉ tiêu của phòng ban mình. Chỉ
          tiêu giao (target) lấy theo kỳ gần nhất, trưởng phòng chỉnh lại nếu
          cần.
        </div>

        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy} onClick={submit}>
            {busy ? "Đang mở..." : "Mở kỳ"}
          </button>
          <button className="btn-ghost" onClick={() => setOpen(false)}>
            Huỷ
          </button>
        </div>
      </div>
    </div>
  );
}
