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
import {
  KpiStatusBadge,
  ProgressBar,
  ScoreBadge,
  fmtScore,
} from "@/components/ui";
import { scoreStateOf } from "@/lib/kpi";
import KpiAdvisoryPanel from "@/components/kpi-advisory";
import ConfirmDialog from "@/components/confirm-dialog";

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
  // Mở sẵn người ĐANG CẦN mình xử lý (lệch số, chờ mình duyệt) — không phải
  // dòng của chính mình. Quản trị ngoại lệ: việc cần làm nổi lên trước.
  const waitingStatus =
    role === "CEO" ? "MANAGER_REVIEWED" : role === "MANAGER" ? "SELF_REVIEWED" : null;
  const [openEmp, setOpenEmp] = useState<string | null>(
    groups.find((g) => g.rows.some((r) => r.hasMismatch))?.employeeId ??
      (waitingStatus
        ? groups.find(
            (g) =>
              g.employeeId !== currentUserId &&
              g.rows.some((r) => r.status === waitingStatus)
          )?.employeeId
        : undefined) ??
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

  // Chốt KPI là KHOÁ VĨNH VIỄN — không dùng confirm() trống trơn mà mở hộp
  // xác nhận tóm tắt trước: bao nhiêu dòng sẽ khoá, bao nhiêu bị bỏ qua vì sao.
  const [approveTarget, setApproveTarget] = useState<
    { employeeId?: string; name: string } | null
  >(null);

  async function approveAll(employeeId?: string) {
    const data = await call("/api/kpi/approve", {
      periodId,
      employeeId,
      finalizePeriod: !employeeId,
    });
    setApproveTarget(null);
    if (data) {
      // Gom lý do bỏ qua theo từng loại, nói đúng lý do — không gộp hết thành
      // "chưa qua bước trưởng phòng".
      const reasons = new Map<string, number>();
      for (const sk of (data.skipped ?? []) as { reason: string }[]) {
        reasons.set(sk.reason, (reasons.get(sk.reason) ?? 0) + 1);
      }
      const skippedText = [...reasons.entries()]
        .map(([r, n]) => `${n} dòng: ${r}`)
        .join("; ");
      setMessage(
        `Đã chốt ${data.finalized} dòng KPI.${
          skippedText ? ` Chưa chốt — ${skippedText}.` : ""
        }${data.periodFinalized ? " Toàn kỳ đã khoá." : ""}`
      );
    }
  }

  // Tóm tắt cho hộp xác nhận: tính trên các dòng đang hiển thị
  const scopeRows = approveTarget
    ? groups
        .filter((g) => !approveTarget.employeeId || g.employeeId === approveTarget.employeeId)
        .flatMap((g) => g.rows)
    : [];
  const summary = {
    ready: scopeRows.filter((r) => r.status === "MANAGER_REVIEWED" && !r.hasMismatch).length,
    draft: scopeRows.filter((r) => r.status === "DRAFT").length,
    waitingManager: scopeRows.filter((r) => r.status === "SELF_REVIEWED").length,
    mismatch: scopeRows.filter((r) => r.hasMismatch && r.status !== "FINALIZED").length,
    locked: scopeRows.filter((r) => r.status === "FINALIZED").length,
  };

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
            onClick={() => setApproveTarget({ name: "toàn bộ kỳ" })}
          >
            <CheckCheck size={14} strokeWidth={2} /> Duyệt tất cả &amp; chốt kỳ
          </button>
        )}
      </div>

      <ConfirmDialog
        open={approveTarget !== null}
        busy={busy}
        error={error}
        tone="danger"
        title={`Duyệt & khoá KPI của ${approveTarget?.name ?? ""}?`}
        confirmLabel={`Khoá ${summary.ready} dòng`}
        confirmDisabled={summary.ready === 0}
        typeToConfirm={approveTarget && !approveTarget.employeeId ? "CHỐT KỲ" : undefined}
        onClose={() => setApproveTarget(null)}
        onConfirm={() => approveAll(approveTarget?.employeeId)}
      >
        <p>
          Sau khi khoá, chỉ Ban Giám đốc sửa được và mọi lần sửa đều ghi vào nhật
          ký không xoá được.
        </p>
        <ul className="space-y-1 rounded-lg border border-ink-200 bg-ink-50 p-3">
          <li>
            <b className="text-ink-900">{summary.ready}</b> dòng đã qua trưởng
            phòng — <b>sẽ khoá</b>
          </li>
          {summary.mismatch > 0 && (
            <li className="text-red-700">
              {summary.mismatch} dòng còn lệch số — bị bỏ qua, phải chốt ở trang
              Đối soát trước
            </li>
          )}
          {summary.waitingManager > 0 && (
            <li className="text-amber-800">
              {summary.waitingManager} dòng chờ trưởng phòng duyệt — bị bỏ qua
            </li>
          )}
          {summary.draft > 0 && (
            <li className="text-amber-800">
              {summary.draft} dòng nhân viên chưa khai — bị bỏ qua
            </li>
          )}
          {summary.locked > 0 && (
            <li className="text-ink-500">{summary.locked} dòng đã khoá từ trước</li>
          )}
        </ul>
        {summary.ready === 0 && (
          <p className="text-amber-800">
            Chưa có dòng nào đủ điều kiện để khoá.
          </p>
        )}
      </ConfirmDialog>

      {error && !approveTarget && (
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
          const state = scoreStateOf(periodStatus, g.rows);
          // Dòng lệch số lên đầu — đó là thứ phải quyết trước khi chốt
          const rows = [...g.rows].sort(
            (a, b) => Number(b.hasMismatch) - Number(a.hasMismatch)
          );

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
                  <ScoreBadge score={g.summary.totalScore} state={state} />
                  <span className="text-ink-400" aria-hidden>
                    {isOpen ? "▲" : "▼"}
                  </span>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-ink-100">
                  {/* Điện thoại: mỗi chỉ tiêu một thẻ, ô nhập nằm ngay trong
                      thẻ — không phải kéo ngang 900px mới thấy chỗ nhập. */}
                  <ul className="divide-y divide-ink-100 md:hidden">
                    {rows.map((r) => (
                      <RowEditor
                        key={r.id}
                        layout="card"
                        row={r}
                        role={role}
                        isMine={g.employeeId === currentUserId}
                        selfOpen={selfOpen}
                        managerOpen={managerOpen}
                        busy={busy}
                        onCall={call}
                      />
                    ))}
                    <li className="flex items-center justify-between bg-ink-50/70 px-4 py-3 text-sm font-semibold">
                      <span>Tổng · trọng số {g.summary.totalWeight}%</span>
                      <ScoreBadge score={g.summary.totalScore} state={state} />
                    </li>
                  </ul>

                  {/* Máy tính: cột Thao tác ghim bên phải, luôn nhìn thấy kể
                      cả khi bảng phải cuộn ngang. Ba cột số gộp thành một ô. */}
                  <div className="hidden overflow-x-auto md:block">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th className="min-w-52">Chỉ tiêu</th>
                          <th className="text-right">Trọng số</th>
                          <th className="text-right">Giao</th>
                          <th className="text-right">Số liệu</th>
                          <th className="min-w-28">Mức đạt</th>
                          <th className="text-right">Điểm</th>
                          <th>Trạng thái</th>
                          <th className="sticky right-0 z-10 w-60 min-w-60 bg-ink-50 shadow-[-8px_0_8px_-8px_rgb(0_0_0/0.12)]">
                            Thao tác
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <RowEditor
                            key={r.id}
                            layout="row"
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
                          <td colSpan={3}></td>
                          <td className="text-right">
                            {state === "UNSCORED"
                              ? "—"
                              : fmtScore(g.summary.totalScore)}
                          </td>
                          <td></td>
                          <td className="sticky right-0 bg-ink-50">
                            <ScoreBadge
                              score={g.summary.totalScore}
                              state={state}
                            />
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
                          onClick={() =>
                            setApproveTarget({
                              employeeId: g.employeeId,
                              name: g.employeeName,
                            })
                          }
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
  layout,
  row,
  role,
  isMine,
  selfOpen,
  managerOpen,
  busy,
  onCall,
}: {
  layout: "row" | "card";
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
  // Không ai tự duyệt KPI của chính mình (máy chủ cũng chặn) — không hiện nút.
  const canManager = locked || isMine
    ? false
    : role === "CEO"
      ? true
      : role === "MANAGER" && managerOpen && row.status !== "DRAFT";
  const canEditLocked = role === "CEO" && locked;

  const url = `/api/kpi/results/${row.id}`;
  const actual = row.actualFinal ?? row.actualSelf ?? row.actualSystem;
  const needsReason =
    row.actualSelf !== null &&
    finalValue !== "" &&
    Number(finalValue) !== row.actualSelf;

  // Vì sao dòng này không có ô nhập — nói đúng lý do, không chung chung.
  const idleText = locked
    ? "Đã khoá"
    : isMine && !selfOpen
      ? role === "EMPLOYEE"
        ? "Hết hạn tự khai"
        : "Ban Giám đốc duyệt KPI của bạn"
      : isMine && role === "MANAGER"
        ? "Ban Giám đốc duyệt KPI của bạn"
        : role === "MANAGER" && !managerOpen
          ? "Hết hạn duyệt (ngày 4)"
          : row.status === "DRAFT"
            ? "Chờ nhân viên tự khai"
            : "Chờ bước trước";

  const actions = (
    <>
      {/* Nhân viên tự khai */}
      {canSelf && (
        <div className="space-y-1.5">
          <input
            type="number"
            step="any"
            inputMode="decimal"
            className="input py-1.5 text-sm"
            aria-label={`Số thực tế (${row.unit})`}
            placeholder={`Số thực tế (${row.unit})`}
            value={selfValue}
            onChange={(e) => setSelfValue(e.target.value)}
          />
          <input
            className="input py-1.5 text-sm"
            aria-label="Giải trình ngắn"
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
            inputMode="decimal"
            className="input py-1.5 text-sm"
            aria-label="Số chốt"
            placeholder="Số chốt"
            value={finalValue}
            onChange={(e) => setFinalValue(e.target.value)}
          />
          {needsReason && (
            <input
              className="input py-1.5 text-sm"
              aria-label="Lý do điều chỉnh"
              placeholder="Lý do điều chỉnh (bắt buộc)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
          <button
            className="btn-success btn-sm w-full"
            disabled={
              busy || finalValue === "" || (needsReason && reason.trim() === "")
            }
            onClick={() =>
              onCall(url, {
                action: "MANAGER_REVIEW",
                actualFinal: Number(finalValue),
                reason: reason || undefined,
              })
            }
          >
            {needsReason ? "Điều chỉnh & duyệt" : "Duyệt số này"}
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
              inputMode="decimal"
              className="input py-1.5 text-sm"
              aria-label="Số chốt mới"
              value={finalValue}
              onChange={(e) => setFinalValue(e.target.value)}
            />
            <input
              className="input py-1.5 text-sm"
              aria-label="Lý do sửa"
              placeholder="Lý do sửa (tối thiểu 10 ký tự)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex gap-1.5">
              <button
                className="btn-danger btn-sm flex-1"
                disabled={busy || reason.trim().length < 10}
                onClick={async () => {
                  const ok = await onCall(url, {
                    action: "EDIT_LOCKED",
                    actualFinal: Number(finalValue),
                    reason,
                  });
                  // Lỗi thì giữ khung sửa (và lý do đã gõ) để sửa lại
                  if (ok) setEditing(false);
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
        <span className="text-xs text-ink-500">{idleText}</span>
      )}
    </>
  );

  const achievement =
    actual === null ? (
      <span className="text-xs text-ink-500">chưa có số</span>
    ) : (
      <>
        <div className="mb-1 text-xs text-ink-600">
          {pct(row.achievementPercent)}
          {row.isCapped && <span className="ml-1 text-amber-700">· chạm trần</span>}
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
      </>
    );

  const notes = (
    <>
      {row.hasMismatch && (
        <div className="mt-1 flex items-center gap-1 text-xs font-medium text-red-600">
          <AlertTriangle size={11} strokeWidth={2.5} /> Lệch{" "}
          {pct(row.mismatchPercent ?? 0)} so với số hệ thống
        </div>
      )}
      {row.selfNote && (
        <div className="mt-1 text-xs text-ink-500">NV: {row.selfNote}</div>
      )}
      {row.managerNote && (
        <div className="mt-1 text-xs text-violet-700">TP: {row.managerNote}</div>
      )}
    </>
  );

  if (layout === "card") {
    return (
      <li className={`px-4 py-3.5 ${row.hasMismatch ? "bg-red-50/50" : ""}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium text-ink-800">{row.kpiName}</div>
            <div className="text-xs text-ink-500">
              Trọng số {row.weightPercent}% ·{" "}
              {row.isHigherBetter ? "càng cao càng tốt" : "càng thấp càng tốt"}
            </div>
          </div>
          <KpiStatusBadge status={row.status} />
        </div>
        {notes}
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink-500">Giao</dt>
          <dd className="text-right text-ink-700">
            {fmt(row.targetValue)} {row.unit}
          </dd>
          <dt className="text-ink-500">Hệ thống / NV khai</dt>
          <dd className="text-right text-ink-700">
            {fmt(row.actualSystem)} / {fmt(row.actualSelf)}
          </dd>
          <dt className="text-ink-500">Số chốt · Điểm</dt>
          <dd className="text-right font-medium text-ink-900">
            {fmt(row.actualFinal)} ·{" "}
            {actual === null ? "—" : fmtScore(row.weightedScore)}
          </dd>
        </dl>
        <div className="mt-2">{achievement}</div>
        <div className="mt-3">{actions}</div>
      </li>
    );
  }

  return (
    <tr className={row.hasMismatch ? "bg-red-50/40" : undefined}>
      <td>
        <div className="font-medium text-ink-800">{row.kpiName}</div>
        <div className="text-xs text-ink-500">
          {row.isHigherBetter ? "↑ càng cao càng tốt" : "↓ càng thấp càng tốt"} ·{" "}
          {row.unit} · nguồn {sourceLabel(row.dataSource)}
        </div>
        {notes}
      </td>
      <td className="text-right text-ink-600">{row.weightPercent}%</td>
      <td className="text-right whitespace-nowrap text-ink-600">
        {fmt(row.targetValue)}
      </td>
      <td className="text-right text-xs whitespace-nowrap">
        <div className="text-ink-500">
          HT <span className="text-ink-700">{fmt(row.actualSystem)}</span>
        </div>
        <div className="text-ink-500">
          NV <span className="text-ink-700">{fmt(row.actualSelf)}</span>
        </div>
        <div className="text-ink-500">
          Chốt{" "}
          <span className="text-sm font-semibold text-ink-900">
            {fmt(row.actualFinal)}
          </span>
        </div>
      </td>
      <td>{achievement}</td>
      <td className="text-right font-semibold text-ink-900">
        {actual === null ? "—" : fmtScore(row.weightedScore)}
      </td>
      <td>
        <KpiStatusBadge status={row.status} />
      </td>
      <td
        className={`sticky right-0 z-10 shadow-[-8px_0_8px_-8px_rgb(0_0_0/0.12)] ${
          row.hasMismatch ? "bg-red-50" : "bg-white"
        }`}
      >
        {actions}
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

function pct(n: number) {
  return `${n.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
}

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n);
}

function sourceLabel(s: string) {
  return s === "IPOS_API" ? "iPOS/API" : s === "EXCEL" ? "Excel" : "nhập tay";
}
