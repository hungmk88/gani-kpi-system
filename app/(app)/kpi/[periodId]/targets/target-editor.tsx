"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Lock, Save } from "lucide-react";
import { formatVnNumber, parseVnNumber } from "@/lib/vn-number";
import { fmtNum } from "@/lib/format";
import { toast } from "@/components/toast";

export type TargetRow = {
  resultId: string;
  kpiName: string;
  unit: string;
  weightPercent: number;
  /** null = chưa đặt mục tiêu */
  targetValue: number | null;
  /** Dòng KPI đã chốt (hoặc đã duyệt, với trưởng phòng) — API không cho sửa mục tiêu nữa */
  locked: boolean;
  /** Nhãn cạnh ô bị khoá: "Đã chốt" / "Đã duyệt" */
  lockedLabel?: string;
  /** Khác null = chỉ tiêu ngưỡng (gatekeeper): hiện luật thay cho ô mục tiêu */
  gatekeeperText: string | null;
};

export type TargetGroup = {
  employeeId: string;
  employeeName: string;
  role: string;
  rows: TargetRow[];
};

// Phải khớp .max(200) trong schema của /api/kpi/results/targets
const BATCH_MAX = 200;

type CellState = {
  /** Lỗi chặn lưu (để trống / không phải số / số âm) */
  error: string | null;
  /** Khác giá trị đang lưu trên server (ô lỗi cũng tính là thay đổi) */
  changed: boolean;
  value: number | null;
};

function evaluate(raw: string, baseline: number | null): CellState {
  if (raw.trim() === "") {
    // Ô vốn trống (chưa đặt) mà người dùng chưa gõ gì thì không phải thay đổi
    return baseline === null
      ? { error: null, changed: false, value: null }
      : { error: "Không được để trống.", changed: true, value: null };
  }
  const v = parseVnNumber(raw);
  if (v === null) {
    return {
      error: "Không phải số hợp lệ (vd 135.000.000 hoặc 7,5).",
      changed: true,
      value: null,
    };
  }
  if (v < 0) {
    return { error: "Mục tiêu không được âm.", changed: true, value: v };
  }
  return { error: null, changed: v !== baseline, value: v };
}

/**
 * Trưởng phòng không tự đặt mục tiêu cho chính mình, cũng không đặt cho
 * trưởng phòng khác cùng phòng — Ban Giám đốc đặt. Giữ đúng luật của API
 * (kpiOversightDenial); Ban Giám đốc sửa được mọi dòng.
 */
function isOwnRowsLocked(
  g: TargetGroup,
  currentUserId: string,
  currentUserRole: string
) {
  return (
    currentUserRole === "MANAGER" &&
    (g.employeeId === currentUserId || g.role === "MANAGER" || g.role === "ADMIN")
  );
}

export default function TargetEditor({
  periodId,
  readOnlyReason,
  currentUserId,
  currentUserRole,
  groups,
}: {
  periodId: string;
  /** Khác null → cả trang chỉ xem, hiện lý do này */
  readOnlyReason: string | null;
  currentUserId: string;
  currentUserRole: string;
  groups: TargetGroup[];
}) {
  const router = useRouter();
  const canEdit = readOnlyReason === null;

  // Giá trị đang lưu trên server — mốc để biết ô nào đã đổi
  const [baseline, setBaseline] = useState<Record<string, number | null>>(
    () => {
      const init: Record<string, number | null> = {};
      for (const g of groups) {
        for (const r of g.rows) init[r.resultId] = r.targetValue;
      }
      return init;
    }
  );
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const g of groups) {
      for (const r of g.rows) {
        init[r.resultId] =
          r.targetValue === null ? "" : formatVnNumber(r.targetValue);
      }
    }
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [failure, setFailure] = useState<{
    messages: string[];
    rows: string[];
  } | null>(null);
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set());

  // Chỉ những dòng người đang đăng nhập được phép sửa
  const editableRows = useMemo(
    () =>
      canEdit
        ? groups.flatMap((g) =>
            isOwnRowsLocked(g, currentUserId, currentUserRole)
              ? []
              : g.rows
                  .filter((r) => !r.locked && r.gatekeeperText === null)
                  .map((r) => ({ ...r, employeeName: g.employeeName }))
          )
        : [],
    [canEdit, groups, currentUserId, currentUserRole]
  );

  const cells = useMemo(() => {
    const m: Record<string, CellState> = {};
    for (const r of editableRows) {
      m[r.resultId] = evaluate(
        values[r.resultId] ?? "",
        baseline[r.resultId] ?? null
      );
    }
    return m;
  }, [editableRows, values, baseline]);

  const changedRows = editableRows.filter((r) => cells[r.resultId]?.changed);
  const dirtyCount = changedRows.length;
  const invalidCount = changedRows.filter((r) => cells[r.resultId]?.error).length;
  const hasDirty = dirtyCount > 0;

  // Cảnh báo khi đóng / tải lại trang mà còn thay đổi chưa lưu
  useEffect(() => {
    if (!hasDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    // beforeunload không bắt được chuyển trang trong ứng dụng (thanh bên, thanh
    // dưới, tab phòng ban…) — chặn cú bấm vào liên kết ở pha capture.
    const onClickCapture = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm(`Còn ${dirtyCount} chỉ tiêu đã sửa nhưng chưa lưu. Rời trang và bỏ các thay đổi này?`)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClickCapture, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClickCapture, true);
    };
  }, [hasDirty, dirtyCount]);

  if (groups.length === 0) {
    return (
      <div className="card p-6 text-center text-sm text-ink-500">
        Phòng ban này chưa có nhân sự nào được gán chỉ tiêu trong kỳ này.
      </div>
    );
  }

  function onEdit(resultId: string, raw: string) {
    setValues((v) => ({ ...v, [resultId]: raw }));
    // Sửa tiếp thì thông báo "Đã lưu" cũ không còn đúng nữa
    setSavedCount(null);
    setFailedIds((prev) => {
      if (!prev.has(resultId)) return prev;
      const next = new Set(prev);
      next.delete(resultId);
      return next;
    });
  }

  async function save() {
    if (busy || dirtyCount === 0 || invalidCount > 0) return;

    // Chỉ gửi những dòng thực sự đổi — không gửi lại cả phòng
    const updates = changedRows.map((r) => ({
      resultId: r.resultId,
      targetValue: cells[r.resultId].value as number,
    }));
    const labelOf = new Map(
      changedRows.map((r) => [r.resultId, `${r.employeeName} — ${r.kpiName}`])
    );
    const chunks: (typeof updates)[] = [];
    for (let i = 0; i < updates.length; i += BATCH_MAX) {
      chunks.push(updates.slice(i, i + BATCH_MAX));
    }

    setBusy(true);
    setFailure(null);
    setFailedIds(new Set());
    setSavedCount(null);

    const saved: Record<string, number> = {};
    const messages: string[] = [];
    const failed = new Set<string>();
    try {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const done = Object.keys(saved).length;
        setProgress(
          chunks.length > 1
            ? `Đang lưu đợt ${i + 1}/${chunks.length} (${done}/${updates.length} dòng)...`
            : "Đang lưu..."
        );

        let message: string | null = null;
        try {
          const res = await fetch("/api/kpi/results/targets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ periodId, updates: chunk }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => null);
            message = data?.message ?? `Lưu thất bại (mã lỗi ${res.status}).`;
            // Lỗi validate (422) có chi tiết trong issues — nối vào cho dễ hiểu
            const issues: { message?: string }[] = Array.isArray(data?.issues)
              ? data.issues
              : [];
            const detail = issues.map((x) => x.message).filter(Boolean);
            if (detail.length > 0) message += ` (${detail.slice(0, 3).join("; ")})`;
          }
        } catch {
          message = "Mất kết nối tới máy chủ.";
        }

        // Mỗi đợt là một giao dịch riêng ở server: đợt lỗi thì cả đợt chưa
        // lưu, các đợt khác vẫn lưu tiếp được.
        if (message) {
          messages.push(
            chunks.length > 1 ? `Đợt ${i + 1}/${chunks.length}: ${message}` : message
          );
          for (const u of chunk) failed.add(u.resultId);
        } else {
          for (const u of chunk) saved[u.resultId] = u.targetValue;
        }
      }
    } finally {
      const savedIds = Object.keys(saved);
      if (savedIds.length > 0) {
        setBaseline((prev) => ({ ...prev, ...saved }));
        // Chuẩn hoá cách hiển thị (vd "1234.5" → "1.234,5") cho dòng đã lưu
        setValues((prev) => {
          const next = { ...prev };
          for (const id of savedIds) next[id] = formatVnNumber(saved[id]);
          return next;
        });
        setSavedCount(savedIds.length);
        toast(`Đã lưu ${fmtNum(savedIds.length)} mục tiêu`);
      }
      if (failed.size > 0) {
        setFailedIds(failed);
        setFailure({
          messages,
          rows: [...failed].map((id) => labelOf.get(id) ?? id),
        });
      }
      setProgress(null);
      setBusy(false);
      if (savedIds.length > 0) router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      {readOnlyReason && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {readOnlyReason}
        </div>
      )}

      {groups.map((g) => {
        const ownLocked =
          canEdit && isOwnRowsLocked(g, currentUserId, currentUserRole);
        return (
          <div key={g.employeeId} className="card p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="font-medium text-ink-800">{g.employeeName}</span>
              <span className="text-xs text-ink-500">
                {g.role === "MANAGER" ? "Trưởng phòng" : "Nhân viên"}
              </span>
              {ownLocked && (
                <span className="inline-flex items-center gap-1 text-xs text-ink-600">
                  <Lock size={12} strokeWidth={2} /> Ban Giám đốc đặt chỉ tiêu
                  này
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[13px] font-semibold text-ink-600">
                    <th className="py-1 pr-4">Chỉ tiêu</th>
                    <th className="py-1 pr-4">Trọng số</th>
                    <th className="py-1">Mục tiêu</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => {
                    const rowEditable =
                      canEdit && !ownLocked && !r.locked && r.gatekeeperText === null;
                    const cell = rowEditable ? cells[r.resultId] : undefined;
                    const notSaved = failedIds.has(r.resultId);
                    const tone = cell?.error
                      ? "border-red-400 bg-red-50"
                      : notSaved
                        ? "border-red-300 bg-red-50"
                        : cell?.changed
                          ? "border-amber-400 bg-amber-50"
                          : "";
                    return (
                      <tr key={r.resultId} className="border-t border-ink-100">
                        <td className="py-2 pr-4 text-ink-800">{r.kpiName}</td>
                        <td className="py-2 pr-4 text-ink-600 tabular-nums">
                          {r.gatekeeperText ? "—" : `${fmtNum(r.weightPercent)}%`}
                        </td>
                        <td className="py-2">
                          {r.gatekeeperText ? (
                            <span className="text-xs text-ink-600">
                              {r.gatekeeperText} · cố định, không cần đặt mục tiêu
                            </span>
                          ) : (
                            <>
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  autoComplete="off"
                                  disabled={!rowEditable || busy}
                                  aria-invalid={cell?.error ? true : undefined}
                                  placeholder={rowEditable ? "Chưa đặt" : "—"}
                                  className={`input w-40 ${tone}`}
                                  value={values[r.resultId] ?? ""}
                                  onChange={(e) => onEdit(r.resultId, e.target.value)}
                                />
                                <span className="text-xs text-ink-500">{r.unit}</span>
                                {canEdit && r.locked && !ownLocked && (
                                  <span className="inline-flex items-center gap-1 text-xs text-ink-500">
                                    <Lock size={12} strokeWidth={2} /> {r.lockedLabel ?? "Đã chốt"}
                                  </span>
                                )}
                              </div>
                              {cell?.error && (
                                <p className="mt-1 text-xs text-red-700">{cell.error}</p>
                              )}
                              {!cell?.error && notSaved && (
                                <p className="mt-1 text-xs text-red-700">Chưa lưu được.</p>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {failure && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {failure.messages.map((m, i) => (
            <div key={i}>{m}</div>
          ))}
          <div className="mt-1.5 font-medium">
            {failure.rows.length} dòng CHƯA được lưu:
          </div>
          <ul className="mt-0.5 list-disc pl-5 text-xs">
            {failure.rows.slice(0, 20).map((label, i) => (
              <li key={i}>{label}</li>
            ))}
            {failure.rows.length > 20 && (
              <li>và {failure.rows.length - 20} dòng khác (đánh dấu đỏ ở trên)</li>
            )}
          </ul>
        </div>
      )}

      {canEdit && (
        // Thanh lưu bám đáy màn hình — phòng đông người không phải cuộn xuống
        // cuối. Dưới lg còn thanh điều hướng dưới (56px) nên phải nằm ngay trên
        // nó, không thì nút Lưu bị che (StickyActions chung chỉ dính dưới sm,
        // từ sm trở lên thành hàng tĩnh — ở đây cần dính ở mọi cỡ màn hình).
        <div className="sticky bottom-[calc(56px+env(safe-area-inset-bottom))] z-20 flex flex-wrap items-center justify-between gap-3 border-t border-ink-200 bg-white/95 px-4 py-3 backdrop-blur lg:bottom-0 print:hidden">
          <div className="text-sm">
            {busy ? (
              <span className="text-ink-600">{progress ?? "Đang lưu..."}</span>
            ) : dirtyCount > 0 ? (
              <span className="text-ink-700">
                <b>{dirtyCount}</b> thay đổi chưa lưu
                {invalidCount > 0 && (
                  <span className="ml-2 inline-flex items-center gap-1 text-red-700">
                    <AlertTriangle size={14} strokeWidth={2} />
                    {invalidCount} ô chưa hợp lệ — sửa trước khi lưu
                  </span>
                )}
              </span>
            ) : savedCount !== null ? (
              <span className="inline-flex items-center gap-1.5 text-leaf-700">
                <CheckCircle2 size={15} strokeWidth={2} /> Đã lưu {savedCount}{" "}
                mục tiêu.
              </span>
            ) : (
              <span className="text-ink-500">Không có thay đổi.</span>
            )}
            {!busy && dirtyCount > 0 && savedCount !== null && (
              <span className="ml-2 text-leaf-700">
                (đã lưu {savedCount} dòng)
              </span>
            )}
          </div>
          <button
            onClick={save}
            disabled={busy || dirtyCount === 0 || invalidCount > 0}
            className="btn-primary max-sm:w-full"
          >
            {busy ? (
              "Đang lưu..."
            ) : (
              <>
                <Save size={16} strokeWidth={2} /> Lưu mục tiêu
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
