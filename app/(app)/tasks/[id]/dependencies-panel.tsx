"use client";

import { formatVnDate } from "@/lib/vn-time";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Rel = {
  id: string;
  code: string;
  title: string;
  status: string;
  dueDate: string;
  isLate: boolean;
};

/**
 * Quan hệ phụ thuộc giữa các công việc.
 * Đây là thứ nuôi biểu đồ Gantt và đường găng, đồng thời cộng điểm rủi ro khi
 * một việc đang đứng chờ một việc khác đã trễ.
 */
export default function DependenciesPanel({
  taskId,
  blockedBy,
  blocking,
  candidates,
  canEdit,
}: {
  taskId: string;
  blockedBy: Rel[];
  blocking: Rel[];
  candidates: { id: string; code: string; title: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/tasks/${taskId}/dependencies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dependsOnId: pick }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.message || "Không nối được.");
        return;
      }
      setPick("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(dependsOnId: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/tasks/${taskId}/dependencies?dependsOnId=${encodeURIComponent(dependsOnId)}`,
        { method: "DELETE" }
      );
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        setError(d?.message || "Không gỡ được quan hệ phụ thuộc.");
        return;
      }
      router.refresh();
    } catch {
      setError("Mất kết nối tới máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  const lateBlockers = blockedBy.filter((b) => b.isLate);

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="section-title">Phụ thuộc công việc</h3>
        <Link
          href="/tasks/gantt"
          className="text-xs text-brand-600 hover:underline"
        >
          Xem trên Gantt →
        </Link>
      </div>

      {lateBlockers.length > 0 && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          Việc này đang chờ {lateBlockers.length} việc <b>đã trễ hạn</b>. Hệ
          thống đã cộng điểm rủi ro tương ứng — gỡ mắt xích kia trước thì việc
          này mới chạy được.
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="mb-4">
        <div className="mb-1.5 text-xs font-semibold text-ink-500">
          Phải chờ xong ({blockedBy.length})
        </div>
        {blockedBy.length === 0 ? (
          <p className="text-xs text-ink-400">
            Không chờ việc nào — làm được ngay.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {blockedBy.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-ink-200 px-2.5 py-1.5"
              >
                <Link
                  href={`/tasks/${b.id}`}
                  className="min-w-0 flex-1 text-xs hover:text-brand-700"
                >
                  <span className="block truncate font-medium text-ink-800">
                    {b.title}
                  </span>
                  <span
                    className={`block ${b.isLate ? "font-medium text-red-600" : "text-ink-400"}`}
                  >
                    {b.code} · hạn{" "}
                    {formatVnDate(b.dueDate)}
                    {b.isLate && " · ĐÃ TRỄ"}
                  </span>
                </Link>
                {canEdit && (
                  <button
                    className="shrink-0 text-xs text-red-600 hover:underline"
                    disabled={busy}
                    onClick={() => remove(b.id)}
                  >
                    Gỡ
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {blocking.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-xs font-semibold text-ink-500">
            Đang chặn ({blocking.length})
          </div>
          <ul className="space-y-1.5">
            {blocking.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/tasks/${b.id}`}
                  className="block rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-xs hover:bg-amber-50"
                >
                  <span className="block truncate font-medium text-amber-900">
                    {b.title}
                  </span>
                  <span className="block text-amber-700">
                    {b.code} · đang đợi việc này xong
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canEdit && candidates.length > 0 && (
        <div className="border-t border-ink-100 pt-3">
          <label className="label">Thêm việc phải chờ</label>
          <div className="flex gap-2">
            <select
              className="input"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">— Chọn công việc —</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.title}
                </option>
              ))}
            </select>
            <button
              className="btn-ghost btn-sm shrink-0"
              disabled={busy || !pick}
              onClick={add}
            >
              Nối
            </button>
          </div>
          <p className="mt-1.5 text-xs text-ink-500">
            Hệ thống tự chặn nếu nối vào sẽ tạo vòng lặp.
          </p>
        </div>
      )}
    </div>
  );
}
