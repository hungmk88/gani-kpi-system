"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { vnParts } from "@/lib/vn-time";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import ConfirmDialog from "@/components/confirm-dialog";

const YEAR_MIN = 2020;
const YEAR_MAX = 2100;

export default function OpenPeriodButton() {
  const router = useRouter();
  const monthId = useId();
  const yearId = useId();
  const yearErrId = useId();
  const lateId = useId();
  // Tháng/năm theo lịch VN — server (UTC) và trình duyệt ra cùng giá trị.
  const now = vnParts();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(now.month);
  // Năm giữ dạng chuỗi: ô type=number bị xoá trắng sẽ thành Number("") = 0 và
  // gửi lên "năm 0". Giữ nguyên chữ người dùng gõ, kiểm tra trước khi gửi.
  const [yearText, setYearText] = useState(String(now.year));
  const [allowLate, setAllowLate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const year = /^\d{4}$/.test(yearText.trim()) ? Number(yearText.trim()) : NaN;
  const yearOk = Number.isInteger(year) && year >= YEAR_MIN && year <= YEAR_MAX;

  function close() {
    if (busy) return;
    setOpen(false);
    setError(null);
  }

  async function submit() {
    if (!yearOk) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetchJson<{ period?: { id: string } }>(
        "/api/kpi/periods",
        // allowLate chỉ gửi khi người dùng chủ động tick: server từ chối mở kỳ
        // đã quá hạn tự khai, trừ khi được xác nhận rõ ràng là mở trễ.
        jsonInit("POST", { month, year, autoAssign: true, ...(allowLate ? { allowLate: true } : {}) })
      );
      if (!r.ok || !r.data.period) {
        // Hiện nguyên văn thông báo của server (vd "hạn tự khai đã qua") ngay trong hộp
        setError(r.message || "Không mở được kỳ.");
        return;
      }
      setOpen(false);
      router.push(`/kpi/${r.data.period.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)}>
        <Plus size={16} aria-hidden /> Mở kỳ KPI mới
      </button>
      <ConfirmDialog
        open={open}
        title="Mở kỳ KPI mới"
        confirmLabel="Mở kỳ"
        busy={busy}
        confirmDisabled={!yearOk}
        error={error}
        onConfirm={submit}
        onClose={close}
      >
        <p className="text-ink-500">
          Hệ thống tự đặt hạn theo lịch đã chốt: nhân viên khai đến hết ngày 2,
          trưởng phòng duyệt đến hết ngày 4, Ban Giám đốc chốt ngày 5 của tháng
          kế tiếp.
        </p>

        <div className="grid grid-cols-2 gap-3 pt-2">
          <div>
            <label className="label" htmlFor={monthId}>
              Tháng đánh giá
            </label>
            <select
              id={monthId}
              className="input"
              value={month}
              disabled={busy}
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
            <label className="label" htmlFor={yearId}>
              Năm
            </label>
            <input
              id={yearId}
              type="text"
              inputMode="numeric"
              maxLength={4}
              className="input"
              value={yearText}
              disabled={busy}
              aria-invalid={!yearOk}
              aria-describedby={yearOk ? undefined : yearErrId}
              onChange={(e) => setYearText(e.target.value.replace(/\D/g, ""))}
            />
          </div>
        </div>
        {!yearOk && (
          <p id={yearErrId} className="text-xs text-red-700">
            Năm phải từ {YEAR_MIN} đến {YEAR_MAX}.
          </p>
        )}

        <label htmlFor={lateId} className="flex items-start gap-2 pt-1">
          <input
            id={lateId}
            type="checkbox"
            className="mt-0.5"
            checked={allowLate}
            disabled={busy}
            onChange={(e) => setAllowLate(e.target.checked)}
          />
          <span>
            Mở kỳ trễ (hạn tự khai đã qua)
            <span className="block text-xs text-ink-500">
              Chỉ tick khi cố ý mở kỳ cũ; nhân viên sẽ khai sau hạn đã chốt.
            </span>
          </span>
        </label>

        <div className="rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-700">
          Toàn bộ nhân sự sẽ được gán sẵn bộ chỉ tiêu của phòng ban mình. Chỉ
          tiêu giao (target) lấy theo kỳ gần nhất, trưởng phòng chỉnh lại nếu
          cần.
        </div>
      </ConfirmDialog>
    </>
  );
}
