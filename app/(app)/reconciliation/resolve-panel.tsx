"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type SourceRow = {
  code: string;
  label: string;
  value: number;
  at: string;
};

/**
 * Bảng chọn số cho một ô đang lệch.
 *
 * Cố tình không có nút "chọn giúp tôi" hay "lấy trung bình". Trung bình của hai
 * con số sai vẫn là một con số sai, mà lại còn không trùng nguồn nào để đối
 * chiếu về sau. Người quyết phải chỉ đúng một nguồn và nói vì sao.
 */
export default function ResolvePanel({
  reconciliationId,
  sources,
  unit,
  allowCustom = false,
}: {
  reconciliationId: string;
  sources: SourceRow[];
  unit: string;
  /** Nhập số khác với các nguồn — chỉ Ban Giám đốc. */
  allowCustom?: boolean;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<string>("");
  const [custom, setCustom] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCustom = picked === "__custom__";
  const pickedSource = sources.find((s) => s.code === picked);
  const value = isCustom ? Number(custom) : (pickedSource?.value ?? NaN);
  const canSubmit =
    Number.isFinite(value) && reason.trim().length >= 10 && !!picked;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/reconciliation/${reconciliationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value,
          sourceCode: isCustom ? "MANUAL_OVERRIDE" : picked,
          reason,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Không chốt được.");
        return;
      }
      router.refresh();
    } catch {
      setError("Mất kết nối tới máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  const max = Math.max(...sources.map((s) => Math.abs(s.value)), 1);

  return (
    <>
      <div className="mb-4 space-y-2">
        {sources.map((s) => {
          const active = picked === s.code;
          return (
            <button
              key={s.code}
              onClick={() => setPicked(s.code)}
              className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                active
                  ? "border-brand-400 bg-brand-50"
                  : "border-ink-200 bg-white hover:bg-ink-50"
              }`}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                  active ? "border-brand-600" : "border-ink-300"
                }`}
              >
                {active && (
                  <span className="h-2 w-2 rounded-full bg-brand-600" />
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink-800">
                  {s.label}
                </span>
                <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                  <span
                    className={`block h-full rounded-full ${
                      active ? "bg-brand-500" : "bg-ink-300"
                    }`}
                    style={{
                      width: `${(Math.abs(s.value) / max) * 100}%`,
                    }}
                  />
                </span>
              </span>

              <span className="shrink-0 text-right">
                <span className="block font-semibold text-ink-900 tabular-nums">
                  {fmt(s.value)}
                </span>
                <span className="block text-xs text-ink-400">{unit}</span>
              </span>
            </button>
          );
        })}

        {allowCustom && (
        <button
          onClick={() => setPicked("__custom__")}
          className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
            isCustom
              ? "border-amber-400 bg-amber-50"
              : "border-dashed border-ink-300 bg-white hover:bg-ink-50"
          }`}
        >
          <span
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
              isCustom ? "border-amber-600" : "border-ink-300"
            }`}
          >
            {isCustom && <span className="h-2 w-2 rounded-full bg-amber-600" />}
          </span>
          <span className="flex-1 text-sm text-ink-700">
            Không nguồn nào đúng — tôi nhập số khác
          </span>
        </button>
        )}

        {isCustom && (
          <input
            type="number"
            step="any"
            className="input"
            placeholder={`Số đúng (${unit})`}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
        )}
      </div>

      <div className="mb-3">
        <label className="label">
          Vì sao chọn số này? (bắt buộc, tối thiểu 10 ký tự)
        </label>
        <input
          className="input"
          placeholder="Ví dụ: đã đối chiếu hoá đơn giấy với kế toán, số iPOS đúng"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn-primary btn-sm"
          disabled={busy || !canSubmit}
          onClick={submit}
        >
          {busy
            ? "Đang chốt..."
            : `Chốt số ${Number.isFinite(value) ? fmt(value) : ""}`}
        </button>
        {!canSubmit && (
          <span className="text-xs text-ink-500">
            {!picked
              ? "Chọn một nguồn trước."
              : reason.trim().length < 10
                ? "Còn thiếu lý do."
                : "Số nhập vào chưa hợp lệ."}
          </span>
        )}
      </div>
    </>
  );
}

function fmt(n: number) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n);
}
