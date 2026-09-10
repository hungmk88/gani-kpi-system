"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type TargetRow = {
  resultId: string;
  kpiName: string;
  unit: string;
  weightPercent: number;
  targetValue: number;
};

export type TargetGroup = {
  employeeId: string;
  employeeName: string;
  role: string;
  rows: TargetRow[];
};

export default function TargetEditor({
  periodId,
  canEdit,
  groups,
}: {
  periodId: string;
  canEdit: boolean;
  groups: TargetGroup[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const g of groups) {
      for (const r of g.rows) init[r.resultId] = String(r.targetValue);
    }
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  if (groups.length === 0) {
    return (
      <div className="card p-6 text-center text-sm text-ink-500">
        Phòng ban này chưa có nhân sự nào được gán chỉ tiêu trong kỳ này.
      </div>
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    setSavedAt(null);
    try {
      const updates = Object.entries(values).map(([resultId, v]) => ({
        resultId,
        targetValue: Number(v) || 0,
      }));
      const res = await fetch("/api/kpi/results/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodId, updates }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Lưu thất bại.");
        return;
      }
      setSavedAt(Date.now());
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {!canEdit && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Kỳ này đã chốt vĩnh viễn, chỉ xem — không sửa được nữa.
        </div>
      )}

      {groups.map((g) => (
        <div key={g.employeeId} className="card p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="font-medium text-ink-800">{g.employeeName}</span>
            <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-500">
              {g.role === "MANAGER" ? "Trưởng phòng" : "Nhân viên"}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="py-1 pr-4">Chỉ tiêu</th>
                  <th className="py-1 pr-4">Trọng số</th>
                  <th className="py-1">Mục tiêu</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.resultId} className="border-t border-ink-100">
                    <td className="py-2 pr-4 text-ink-800">{r.kpiName}</td>
                    <td className="py-2 pr-4 text-ink-600">{r.weightPercent}%</td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="0.01"
                          disabled={!canEdit}
                          className="input w-32"
                          value={values[r.resultId] ?? ""}
                          onChange={(e) =>
                            setValues((v) => ({ ...v, [r.resultId]: e.target.value }))
                          }
                        />
                        <span className="text-xs text-ink-500">{r.unit}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {savedAt && !error && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          ✅ Đã lưu mục tiêu.
        </div>
      )}

      {canEdit && (
        <button
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? "Đang lưu..." : "💾 Lưu mục tiêu"}
        </button>
      )}
    </div>
  );
}
