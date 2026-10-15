"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Download,
  Printer,
  CheckCheck,
  AlertTriangle,
  LockOpen,
  Upload,
} from "lucide-react";
import { KpiStatusBadge, ProgressBar, ScoreBadge } from "@/components/ui";
import KpiAdvisoryPanel from "@/components/kpi-advisory";

export type KpiRow = {
  id: string;
  kpiName: string;
  unit: string;
  isHigherBetter: boolean;
  dataSource: string;
  weightPercent: number;
  targetValue: number;
  actualSystem: number | null;
  actualSelf: number | null;
  actualFinal: number | null;
  achievementPercent: number;
  weightedScore: number;
  isCapped: boolean;
  hasMismatch: boolean;
  mismatchPercent: number | null;
  status: string;
  selfNote: string | null;
  managerNote: string | null;
  evidenceUrl: string | null;
};

type Group = {
  employeeId: string;
  employeeName: string;
  jobTitle: string;
  departmentName: string;
  rows: KpiRow[];
  summary: { totalWeight: number; totalScore: number; count: number };
};

export default function KpiWorkTable({
  periodId,
  periodStatus,
  role,
  currentUserId,
  selfOpen,
  managerOpen,
  groups,
}: {
  periodId: string;
  periodStatus: string;
  role: string;
  currentUserId: string;
  selfOpen: boolean;
  managerOpen: boolean;
  groups: Group[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [openEmp, setOpenEmp] = useState<string | null>(
    groups.find((g) => g.employeeId === currentUserId)?.employeeId ??
      groups[0]?.employeeId ??
      null
  );

  async function call(url: string, payload: unknown) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Thao tác thất bại.");
        return null;
      }
      router.refresh();
      return data;
    } catch {
      setError("Mất kết nối tới máy chủ.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function approveAll(employeeId?: string) {
    const label = employeeId ? "nhân sự này" : "toàn bộ kỳ";
    if (
      !confirm(
        `Duyệt và KHOÁ VĨNH VIỄN điểm KPI của ${label}?\n\nSau khi khoá, chỉ Ban Giám đốc mới sửa được và mọi lần sửa đều bị ghi vào nhật ký.`
      )
    )
      return;
    const data = await call("/api/kpi/approve", {
      periodId,
      employeeId,
      finalizePeriod: !employeeId,
    });
    if (data) {
      setMessage(
        `Đã chốt ${data.finalized} dòng KPI.${
          data.skipped?.length
            ? ` ${data.skipped.length} dòng chưa qua bước trưởng phòng nên chưa chốt.`
            : ""
        }${data.periodFinalized ? " Toàn kỳ đã khoá." : ""}`
      );
    }
  }

  return (
    <>
      {/* ---------- Thanh công cụ ---------- */}
      <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
        <a
          href={`/api/kpi/export?periodId=${periodId}`}
          className="btn-ghost btn-sm inline-flex items-center gap-1.5"
        >
          <Download size={14} strokeWidth={2} /> Tải bảng KPI (Excel)
        </a>
        <a
          href={`/reports/kpi/${periodId}`}
          target="_blank"
          rel="noreferrer"
          className="btn-ghost btn-sm inline-flex items-center gap-1.5"
        >
          <Printer size={14} strokeWidth={2} /> Báo cáo điều hành (PDF)
        </a>
        {(role === "MANAGER" || role === "CEO" || role === "ADMIN") && (
          <>
            <a href="/api/kpi/template" className="btn-ghost btn-sm inline-flex items-center gap-1.5">
              <Download size={14} strokeWidth={2} /> Tải file mẫu nhập số
            </a>
            <ImportButton periodId={periodId} />
          </>
        )}
        {role === "CEO" && periodStatus !== "FINALIZED" && (
          <button
            className="btn-primary btn-sm ml-auto inline-flex items-center gap-1.5"
            disabled={busy}
            onClick={() => approveAll()}
          >
            <CheckCheck size={14} strokeWidth={2} /> Duyệt tất cả &amp; chốt kỳ
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {message && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </div>
      )}

      {groups.length === 0 && (
        <div className="card p-8 text-center text-ink-500">
          Không có dòng KPI nào trong tầm quản lý của bạn ở kỳ này.
        </div>
      )}

      {/* ---------- Từng nhân sự ---------- */}
      <div className="space-y-4">
        {groups.map((g) => {
          const isOpen = openEmp === g.employeeId;
          const pendingSelf = g.rows.filter((r) => r.status === "DRAFT").length;
          const pendingManager = g.rows.filter(
            (r) => r.status === "SELF_REVIEWED"
          ).length;
          const pendingCeo = g.rows.filter(
            (r) => r.status === "MANAGER_REVIEWED"
          ).length;
          const mismatches = g.rows.filter((r) => r.hasMismatch).length;

          return (
            <div key={g.employeeId} className="card overflow-hidden">
              <button
                onClick={() => setOpenEmp(isOpen ? null : g.employeeId)}
                className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-ink-50/60"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink-900">
                      {g.employeeName}
                    </span>
                    {g.employeeId === currentUserId && (
                      <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold text-brand-700">
                        BẠN
                      </span>
                    )}
                    {mismatches > 0 && (
                      <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                        <AlertTriangle size={10} strokeWidth={2.5} /> LỆCH SỐ {mismatches}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-500">
                    {g.jobTitle || "—"} · {g.departmentName} · {g.rows.length}{" "}
                    chỉ tiêu · trọng số {g.summary.totalWeight}%
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {pendingSelf > 0 && (
                    <span className="badge border border-ink-200 bg-ink-100 text-ink-700">
                      {pendingSelf} chưa khai
                    </span>
                  )}
                  {pendingManager > 0 && (
                    <span className="badge border border-sky-200 bg-sky-50 text-sky-700">
                      {pendingManager} chờ TP
                    </span>
                  )}
                  {pendingCeo > 0 && (
                    <span className="badge border border-violet-200 bg-violet-50 text-violet-700">
                      {pendingCeo} chờ BGĐ
                    </span>
                  )}
                  <ScoreBadge score={g.summary.totalScore} />
                  <span className="text-ink-400">{isOpen ? "▲" : "▼"}</span>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-ink-100">
                  <div className="overflow-x-auto">
                    <table className="tbl min-w-[900px]">
                      <thead>
                        <tr>
                          <th className="min-w-56">Chỉ tiêu</th>
                          <th className="text-right">Trọng số</th>
                          <th className="text-right">Giao</th>
                          <th className="text-right">Số hệ thống</th>
                          <th className="text-right">NV khai</th>
                          <th className="text-right">Số chốt</th>
                          <th className="min-w-32">Mức đạt</th>
                          <th className="text-right">Điểm</th>
                          <th>Trạng thái</th>
                          <th className="min-w-64">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map((r) => (
                          <RowEditor
                            key={r.id}
                            row={r}
                            role={role}
                            isMine={g.employeeId === currentUserId}
                            selfOpen={selfOpen}
                            managerOpen={managerOpen}
                            busy={busy}
                            onCall={call}
                          />
                        ))}
                        <tr className="bg-ink-50/70 font-semibold">
                          <td>Tổng cộng</td>
                          <td className="text-right">
                            <span
                              className={
                                g.summary.totalWeight !== 100
                                  ? "text-amber-600"
                                  : ""
                              }
                            >
                              {g.summary.totalWeight}%
                            </span>
                          </td>
                          <td colSpan={5}></td>
                          <td className="text-right">
                            {g.summary.totalScore.toFixed(2)}
                          </td>
                          <td colSpan={2}>
                            <ScoreBadge score={g.summary.totalScore} />
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {role === "CEO" &&
                    periodStatus !== "FINALIZED" &&
                    pendingCeo + pendingManager + pendingSelf > 0 && (
                      <div className="border-t border-ink-100 p-3">
                        <button
                          className="btn-primary btn-sm inline-flex items-center gap-1.5"
                          disabled={busy}
                          onClick={() => approveAll(g.employeeId)}
                        >
                          <CheckCheck size={14} strokeWidth={2} /> Duyệt &amp; khoá KPI của {g.employeeName}
                        </button>
                      </div>
                    )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ 1 dòng */

function RowEditor({
  row,
  role,
  isMine,
  selfOpen,
  managerOpen,
  busy,
  onCall,
}: {
  row: KpiRow;
  role: string;
  isMine: boolean;
  selfOpen: boolean;
  managerOpen: boolean;
  busy: boolean;
  onCall: (url: string, payload: unknown) => Promise<unknown>;
}) {
  const [selfValue, setSelfValue] = useState(
    row.actualSelf ?? row.actualSystem ?? ""
  );
  const [selfNote, setSelfNote] = useState(row.selfNote ?? "");
  const [finalValue, setFinalValue] = useState(
    row.actualFinal ?? row.actualSelf ?? row.actualSystem ?? ""
  );
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);

  const locked = row.status === "FINALIZED";
  const canSelf = isMine && selfOpen && !locked;
  // Trưởng phòng chỉ vào cuộc sau khi nhân viên đã khai, và phải trong hạn ngày 4.
  // Ban Giám đốc thì vào được bất cứ lúc nào, kể cả dòng nhân viên chưa khai —
  // để không bị kẹt khi có người nghỉ việc hoặc bỏ khai giữa chừng.
  const canManager = locked
    ? false
    : role === "CEO"
      ? true
      : role === "MANAGER" && managerOpen && row.status !== "DRAFT";
  const canEditLocked = role === "CEO" && locked;

  const url = `/api/kpi/results/${row.id}`;

  return (
    <tr className={row.hasMismatch ? "bg-red-50/40" : undefined}>
      <td>
        <div className="font-medium text-ink-800">{row.kpiName}</div>
        <div className="text-xs text-ink-500">
          {row.isHigherBetter ? "↑ càng cao càng tốt" : "↓ càng thấp càng tốt"} ·{" "}
          {row.unit} · nguồn {sourceLabel(row.dataSource)}
        </div>
        {row.hasMismatch && (
          <div className="mt-1 flex items-center gap-1 text-xs font-medium text-red-600">
            <AlertTriangle size={11} strokeWidth={2.5} /> Lệch {row.mismatchPercent}% so với số hệ thống
          </div>
        )}
        {row.selfNote && (
          <div className="mt-1 text-xs text-ink-500">NV: {row.selfNote}</div>
        )}
        {row.managerNote && (
          <div className="mt-1 text-xs text-violet-600">
            TP: {row.managerNote}
          </div>
        )}
      </td>
      <td className="text-right text-ink-600">{row.weightPercent}%</td>
      <td className="text-right text-ink-600">{fmt(row.targetValue)}</td>
      <td className="text-right text-ink-500">{fmt(row.actualSystem)}</td>
      <td className="text-right text-ink-700">{fmt(row.actualSelf)}</td>
      <td className="text-right font-medium text-ink-900">
        {fmt(row.actualFinal)}
      </td>
      <td>
        <div className="mb-1 text-xs text-ink-600">
          {row.achievementPercent}%
          {row.isCapped && (
            <span className="ml-1 text-amber-600">· trần 150%</span>
          )}
        </div>
        <ProgressBar
          value={(row.achievementPercent / 150) * 100}
          tone={
            row.achievementPercent >= 100
              ? "green"
              : row.achievementPercent >= 80
                ? "amber"
                : "red"
          }
        />
      </td>
      <td className="text-right font-semibold text-ink-900">
        {row.weightedScore.toFixed(2)}
      </td>
      <td>
        <KpiStatusBadge status={row.status} />
      </td>
      <td>
        {/* Nhân viên tự khai */}
        {canSelf && (
          <div className="space-y-1.5">
            <input
              type="number"
              step="any"
              className="input py-1.5 text-sm"
              placeholder={`Số thực tế (${row.unit})`}
              value={selfValue}
              onChange={(e) => setSelfValue(e.target.value)}
            />
            <input
              className="input py-1.5 text-sm"
              placeholder="Giải trình ngắn (tuỳ chọn)"
              value={selfNote}
              onChange={(e) => setSelfNote(e.target.value)}
            />
            <button
              className="btn-primary btn-sm w-full"
              disabled={busy || selfValue === ""}
              onClick={() =>
                onCall(url, {
                  action: "SELF_REVIEW",
                  actualSelf: Number(selfValue),
                  selfNote: selfNote || undefined,
                })
              }
            >
              Gửi số tự khai
            </button>
          </div>
        )}

        {/* Trưởng phòng / BGĐ duyệt */}
        {canManager && (
          <div className="space-y-1.5">
            <input
              type="number"
              step="any"
              className="input py-1.5 text-sm"
              placeholder="Số chốt"
              value={finalValue}
              onChange={(e) => setFinalValue(e.target.value)}
            />
            {row.actualSelf !== null &&
              Number(finalValue) !== row.actualSelf && (
                <input
                  className="input py-1.5 text-sm"
                  placeholder="Lý do điều chỉnh (bắt buộc)"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              )}
            <button
              className="btn-success btn-sm w-full"
              disabled={busy || finalValue === ""}
              onClick={() =>
                onCall(url, {
                  action: "MANAGER_REVIEW",
                  actualFinal: Number(finalValue),
                  reason: reason || undefined,
                })
              }
            >
              {row.actualSelf !== null && Number(finalValue) !== row.actualSelf
                ? "Điều chỉnh & duyệt"
                : "Duyệt số này"}
            </button>

            {/* Cố vấn chỉ gợi ý mức đạt %, không phải số tuyệt đối, nên chỉ
                hiện phân tích chứ không tự điền vào ô số chốt. */}
            <KpiAdvisoryPanel kpiResultId={row.id} />
          </div>
        )}

        {/* CEO sửa sau khi đã khoá */}
        {canEditLocked &&
          (editing ? (
            <div className="space-y-1.5">
              <input
                type="number"
                step="any"
                className="input py-1.5 text-sm"
                value={finalValue}
                onChange={(e) => setFinalValue(e.target.value)}
              />
              <input
                className="input py-1.5 text-sm"
                placeholder="Lý do sửa (tối thiểu 10 ký tự)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="flex gap-1.5">
                <button
                  className="btn-danger btn-sm flex-1"
                  disabled={busy || reason.trim().length < 10}
                  onClick={async () => {
                    await onCall(url, {
                      action: "EDIT_LOCKED",
                      actualFinal: Number(finalValue),
                      reason,
                    });
                    setEditing(false);
                  }}
                >
                  Xác nhận sửa
                </button>
                <button
                  className="btn-ghost btn-sm"
                  onClick={() => setEditing(false)}
                >
                  Huỷ
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn-ghost btn-sm inline-flex items-center gap-1.5"
              onClick={() => setEditing(true)}
            >
              <LockOpen size={14} strokeWidth={2} /> Sửa điểm đã khoá
            </button>
          ))}

        {!canSelf && !canManager && !canEditLocked && (
          <span className="text-xs text-ink-400">
            {locked
              ? "Đã khoá"
              : isMine && !selfOpen
                ? "Hết hạn tự khai"
                : "Chờ bước trước"}
          </span>
        )}
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ nhập Excel */

function ImportButton({ periodId }: { periodId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("periodId", periodId);
    try {
      const res = await fetch("/api/kpi/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setResult(`Lỗi: ${data.message}`);
        return;
      }
      setResult(
        `Đã nạp ${data.rowsOk}/${data.rowsTotal} dòng.${
          data.rowsError ? ` ${data.rowsError} dòng lỗi.` : ""
        }`
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <label className="btn-ghost btn-sm inline-flex cursor-pointer items-center gap-1.5">
        {busy ? (
          "Đang nạp..."
        ) : (
          <>
            <Upload size={14} strokeWidth={2} /> Nạp số từ Excel
          </>
        )}
        <input
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
      </label>
      {result && <span className="text-xs text-ink-600">{result}</span>}
    </>
  );
}

/* ------------------------------------------------------------------ tiện ích */

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n);
}

function sourceLabel(s: string) {
  return s === "IPOS_API" ? "iPOS/API" : s === "EXCEL" ? "Excel" : "nhập tay";
}
