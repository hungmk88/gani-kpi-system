"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Download,
  Printer,
  CheckCheck,
  AlertTriangle,
  LockOpen,
  Upload,
  Check,
  ChevronDown,
  ChevronUp,
  Search,
  Send,
} from "lucide-react";
import { Badge, KpiStatusBadge, ScoreBadge } from "@/components/ui";
import { fmtNum, fmtPct, fmtScore } from "@/lib/format";
import { round2, scoreStateOf, type GatekeeperRule } from "@/lib/kpi";
import KpiAdvisoryPanel from "@/components/kpi-advisory";
import ConfirmDialog from "@/components/confirm-dialog";
import VnNumberInput from "@/components/vn-number-input";
import StickyActions from "@/components/sticky-actions";
import { toast } from "@/components/toast";
import {
  AchievementBar,
  GatekeeperStatus,
  achievementText,
  gatekeeperRuleText,
} from "../achievement";
import {
  FILTERS,
  exceptionRank,
  groupFlags,
  initialOpen,
  matchesFilter,
  matchesSearch,
  sortByException,
  type FilterKey,
} from "./exceptions";

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
  /** Trần mức đạt của chỉ tiêu này (150%, Sales 120%) — xem kpiCapFor */
  cap: number;
  /** Khác null = chỉ tiêu gatekeeper (không cộng điểm, vượt ngưỡng thì trừ) */
  gatekeeper: GatekeeperRule | null;
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
  employeeEmail: string;
  employeeRole: string;
  jobTitle: string;
  departmentName: string;
  rows: KpiRow[];
  summary: { totalWeight: number; totalScore: number; count: number };
};

/** Số nhân viên đang gõ cho một dòng tự khai — giữ ở bảng cha để "Gửi tất cả" gom được. */
type SelfDraft = { value: number | null; invalid: boolean; note: string };

/** Nhân viên còn sửa được số tự khai của dòng này không (máy chủ cũng chặn y vậy). */
function selfEditable(row: KpiRow, selfOpen: boolean) {
  return selfOpen && (row.status === "DRAFT" || row.status === "SELF_REVIEWED");
}

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

  // Sắp theo ngoại lệ: lệch số → chờ tôi → chạm trần → dưới 70 → còn lại.
  const ranked = useMemo(() => {
    const viewer = { userId: currentUserId, role, selfOpen, managerOpen };
    const list = groups.map((g) => {
      const state = scoreStateOf(periodStatus, g.rows);
      const flags = groupFlags(
        { ...g, rows: g.rows.map((r) => ({ ...r, isGatekeeper: r.gatekeeper !== null })) },
        viewer,
        state
      );
      return { g, state, flags };
    });
    return sortByException(list, (x) => exceptionRank(x.flags));
  }, [groups, periodStatus, currentUserId, role, selfOpen, managerOpen]);
  // Thứ tự chốt lúc mở trang: duyệt xong một người thì người đó KHÔNG nhảy
  // xuống cuối ngay dưới tay — mất chỗ đang làm. Tải lại trang mới xếp lại.
  const [order] = useState(() => ranked.map((x) => x.g.employeeId));
  const prepared = useMemo(() => {
    const pos = new Map(order.map((id, i) => [id, i]));
    return [...ranked].sort(
      (a, b) =>
        (pos.get(a.g.employeeId) ?? order.length) - (pos.get(b.g.employeeId) ?? order.length)
    );
  }, [ranked, order]);

  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  // Mở sẵn những người ĐANG CẦN mình xử lý — việc cần làm nổi lên trước.
  const [openSet, setOpenSet] = useState<Set<string>>(
    () =>
      new Set(
        initialOpen(
          prepared.map((x) => ({ employeeId: x.g.employeeId, flags: x.flags })),
          currentUserId
        )
      )
  );
  function toggle(id: string) {
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const counts = useMemo(() => {
    const c = {} as Record<FilterKey, number>;
    for (const f of FILTERS) {
      c[f.key] = prepared.filter((x) => matchesFilter(x.flags, f.key)).length;
    }
    return c;
  }, [prepared]);
  const visible = prepared.filter(
    (x) => matchesFilter(x.flags, filter) && matchesSearch(x.g, query)
  );
  // Nhân viên chỉ thấy bảng của chính mình — bộ lọc/tìm kiếm là thừa
  const showFilters = groups.length > 1;

  /* ---------------- tự khai: nháp chung cho cả hai bố cục + "Gửi tất cả" */

  const own = groups.find((g) => g.employeeId === currentUserId) ?? null;
  const [selfDrafts, setSelfDrafts] = useState<Record<string, SelfDraft>>(() => {
    const init: Record<string, SelfDraft> = {};
    for (const r of own?.rows ?? []) {
      init[r.id] = {
        value: r.actualSelf ?? r.actualSystem ?? null,
        invalid: false,
        note: r.selfNote ?? "",
      };
    }
    return init;
  });
  function setDraft(id: string, patch: Partial<SelfDraft>) {
    setSelfDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { value: null, invalid: false, note: "" }), ...patch },
    }));
  }
  const ownEditable = (own?.rows ?? []).filter((r) => selfEditable(r, selfOpen));
  // Dòng đã điền số hợp lệ mà chưa gửi (hoặc sửa khác số đã gửi)
  const bulkItems = ownEditable.filter((r) => {
    const d = selfDrafts[r.id];
    if (!d || d.value === null || d.invalid) return false;
    return (
      r.status === "DRAFT" ||
      d.value !== r.actualSelf ||
      d.note.trim() !== (r.selfNote ?? "").trim()
    );
  });

  async function call(url: string, payload: unknown, success?: string) {
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
      if (success) toast(success);
      router.refresh();
      return data;
    } catch {
      setError("Mất kết nối tới máy chủ.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function submitAll() {
    if (bulkItems.length === 0) return;
    const nameOf = new Map(bulkItems.map((r) => [r.id, r.kpiName]));
    const data = await call("/api/kpi/results/self-review", {
      items: bulkItems.map((r) => ({
        resultId: r.id,
        actualSelf: selfDrafts[r.id].value as number,
        selfNote: selfDrafts[r.id].note.trim() || undefined,
      })),
    });
    if (!data) return;
    if (data.submitted > 0) toast(`Đã gửi ${fmtNum(data.submitted)} chỉ tiêu tự khai`);
    const failed = (data.failed ?? []) as { resultId: string; message: string }[];
    if (failed.length > 0) {
      setError(
        `Chưa gửi được ${failed.length} chỉ tiêu: ` +
          failed.map((f) => `${nameOf.get(f.resultId) ?? "—"} (${f.message})`).join("; ")
      );
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
      toast(
        `Đã chốt ${fmtNum(data.finalized)} dòng KPI${data.periodFinalized ? " · toàn kỳ đã khoá" : ""}`
      );
      // Còn dòng bị bỏ qua thì giữ thông báo chi tiết trên trang để xử lý tiếp
      if (skippedText) {
        setMessage(`Đã chốt ${data.finalized} dòng KPI. Chưa chốt — ${skippedText}.`);
      }
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

  const periodFinalized = periodStatus === "FINALIZED";
  // Kỳ đã chốt: cột Thao tác của người không phải BGĐ toàn chữ "Đã khoá" — ẩn
  const showActions = !(periodFinalized && role !== "CEO");

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
        {role === "CEO" && !periodFinalized && (
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
        // Báo kết quả chi tiết: thẻ trung tính + dấu tích màu lá, không tô nền xanh
        <div className="card mb-4 flex items-start gap-2 px-3 py-2 text-sm text-ink-700">
          <Check size={16} strokeWidth={2.5} className="mt-0.5 shrink-0 text-leaf-600" aria-hidden />
          <span>{message}</span>
        </div>
      )}

      {/* ---------- Bộ lọc nhanh + tìm kiếm ---------- */}
      {showFilters && (
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div role="group" aria-label="Lọc nhân sự" className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => {
              const active = filter === f.key;
              const n = counts[f.key];
              // Bộ lọc không có ai thì làm mờ (vẫn bấm được) — đỡ rối mắt
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(f.key)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition ${
                    active
                      ? "border-ink-900 bg-ink-900 text-white"
                      : n === 0
                        ? "border-ink-200 text-ink-400 hover:text-ink-600"
                        : "border-ink-300 text-ink-700 hover:border-ink-400 hover:text-ink-900"
                  }`}
                >
                  {f.label}
                  <span
                    className={`tabular-nums text-xs ${
                      active
                        ? "text-white/80"
                        : f.key === "mismatch" && n > 0
                          ? "font-semibold text-red-700"
                          : "text-ink-500"
                    }`}
                  >
                    {fmtNum(n)}
                  </span>
                </button>
              );
            })}
          </div>
          <label className="relative block lg:w-72">
            <span className="sr-only">Tìm nhân sự</span>
            <Search
              size={16}
              strokeWidth={2}
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-400"
            />
            <input
              type="search"
              className="input pl-9"
              placeholder="Tìm theo tên, email, phòng ban…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
      )}

      {groups.length === 0 && (
        <div className="card p-8 text-center text-ink-500">
          Không có dòng KPI nào trong tầm quản lý của bạn ở kỳ này.
        </div>
      )}
      {groups.length > 0 && visible.length === 0 && (
        <div className="card p-8 text-center text-sm text-ink-500">
          Không có nhân sự nào khớp bộ lọc.{" "}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setFilter("all");
              setQuery("");
            }}
          >
            Xoá bộ lọc
          </button>
        </div>
      )}
      {showFilters && visible.length > 0 && visible.length < groups.length && (
        <div className="mb-2 text-xs text-ink-500">
          Đang hiển thị {fmtNum(visible.length)}/{fmtNum(groups.length)} nhân sự
        </div>
      )}

      {/* ---------- Từng nhân sự ---------- */}
      <div className="space-y-4">
        {visible.map(({ g, state, flags }) => {
          const isOpen = openSet.has(g.employeeId);
          const isOwn = g.employeeId === currentUserId;
          const pendingSelf = flags.draft;
          const pendingManager = g.rows.filter(
            (r) => r.status === "SELF_REVIEWED"
          ).length;
          const pendingCeo = g.rows.filter(
            (r) => r.status === "MANAGER_REVIEWED"
          ).length;
          // Dòng lệch số lên đầu — đó là thứ phải quyết trước khi chốt
          const rows = [...g.rows].sort(
            (a, b) => Number(b.hasMismatch) - Number(a.hasMismatch)
          );
          // Kỳ đã chốt: dòng số nào cả bảng toàn "—" thì bỏ, đỡ nhiễu
          const showSystem = !periodFinalized || g.rows.some((r) => r.actualSystem !== null);
          const showSelf = !periodFinalized || g.rows.some((r) => r.actualSelf !== null);
          const editorProps = {
            role,
            isMine: isOwn,
            selfOpen,
            managerOpen,
            busy,
            onCall: call,
            showSystem,
            showSelf,
            showActions,
          };

          return (
            <div key={g.employeeId} className="card overflow-hidden">
              <button
                onClick={() => toggle(g.employeeId)}
                aria-expanded={isOpen}
                className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-ink-50/60"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink-900">
                      {g.employeeName}
                    </span>
                    {isOwn && (
                      <span className="text-xs font-medium text-brand-700">
                        Bạn
                      </span>
                    )}
                    {flags.mismatch > 0 && (
                      <span className="badge border-transparent bg-red-50 text-red-700">
                        <AlertTriangle size={12} strokeWidth={2.5} aria-hidden /> Lệch số {flags.mismatch}
                      </span>
                    )}
                    {/* Bảng của chính mình đã có "n chưa khai" — không lặp */}
                    {flags.needsMe > 0 && !isOwn && (
                      <Badge tone="brand">{flags.needsMe} chờ bạn</Badge>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-500">
                    {g.jobTitle || "—"} · {g.departmentName} · {g.rows.length}{" "}
                    chỉ tiêu · trọng số {fmtNum(g.summary.totalWeight)}%
                  </div>
                </div>
                {/* Đếm trạng thái: trung tính; phần việc của người đang xem đã
                    có nhãn "chờ bạn" màu thương hiệu ở bên trái. */}
                <div className="flex flex-wrap items-center gap-2">
                  {pendingSelf > 0 && (
                    <Badge tone="slate">{pendingSelf} chưa khai</Badge>
                  )}
                  {pendingManager > 0 && (
                    <Badge tone="slate">{pendingManager} chờ trưởng phòng</Badge>
                  )}
                  {pendingCeo > 0 && (
                    <Badge tone="slate">{pendingCeo} chờ Ban Giám đốc</Badge>
                  )}
                  {flags.capped > 0 && (
                    <Badge tone="slate">{flags.capped} chạm trần</Badge>
                  )}
                  <ScoreBadge score={g.summary.totalScore} state={state} />
                  <span className="text-ink-400" aria-hidden>
                    {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
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
                        {...editorProps}
                        selfDraft={selfDrafts[r.id]}
                        onSelfDraft={(patch) => setDraft(r.id, patch)}
                      />
                    ))}
                    <li className="flex items-center justify-between bg-ink-50/70 px-4 py-3 text-sm font-semibold">
                      <span>Tổng · trọng số {fmtNum(g.summary.totalWeight)}%</span>
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
                          <th className="min-w-36">Mức đạt</th>
                          <th className="text-right">Điểm</th>
                          <th>Trạng thái</th>
                          {showActions && (
                            <th className="sticky right-0 z-10 w-60 min-w-60 bg-ink-50 shadow-[-8px_0_8px_-8px_rgb(0_0_0/0.12)]">
                              Thao tác
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <RowEditor
                            key={r.id}
                            layout="row"
                            row={r}
                            {...editorProps}
                            selfDraft={selfDrafts[r.id]}
                            onSelfDraft={(patch) => setDraft(r.id, patch)}
                          />
                        ))}
                        <tr className="bg-ink-50/70 font-semibold">
                          <td>Tổng cộng</td>
                          <td className="text-right">
                            <span
                              className={
                                g.summary.totalWeight !== 100
                                  ? "text-amber-700"
                                  : ""
                              }
                            >
                              {fmtNum(g.summary.totalWeight)}%
                            </span>
                          </td>
                          <td colSpan={3}></td>
                          <td className="text-right">
                            {state === "UNSCORED"
                              ? "—"
                              : fmtScore(g.summary.totalScore)}
                          </td>
                          <td>
                            {!showActions && (
                              <ScoreBadge score={g.summary.totalScore} state={state} />
                            )}
                          </td>
                          {showActions && (
                            <td className="sticky right-0 bg-ink-50">
                              <ScoreBadge
                                score={g.summary.totalScore}
                                state={state}
                              />
                            </td>
                          )}
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Nhân viên: gửi một lượt mọi chỉ tiêu đã điền. Trên điện
                      thoại nút dính đáy màn hình, không phải cuộn hết 8 thẻ. */}
                  {isOwn && ownEditable.length > 0 && (
                    <div className="border-t border-ink-100 px-4 pb-3 sm:pt-0">
                      <StickyActions>
                        <button
                          type="button"
                          className="btn-primary inline-flex items-center justify-center gap-1.5"
                          disabled={busy || bulkItems.length === 0}
                          onClick={submitAll}
                        >
                          <Send size={16} strokeWidth={2} aria-hidden />
                          {bulkItems.length > 0
                            ? `Gửi tất cả (${bulkItems.length})`
                            : "Đã gửi hết"}
                        </button>
                      </StickyActions>
                    </div>
                  )}

                  {role === "CEO" &&
                    !periodFinalized &&
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
  selfDraft,
  onSelfDraft,
  showSystem,
  showSelf,
  showActions,
}: {
  layout: "row" | "card";
  row: KpiRow;
  role: string;
  isMine: boolean;
  selfOpen: boolean;
  managerOpen: boolean;
  busy: boolean;
  onCall: (url: string, payload: unknown, success?: string) => Promise<unknown>;
  selfDraft: SelfDraft | undefined;
  onSelfDraft: (patch: Partial<SelfDraft>) => void;
  showSystem: boolean;
  showSelf: boolean;
  showActions: boolean;
}) {
  const [finalValue, setFinalValue] = useState<number | null>(
    row.actualFinal ?? row.actualSelf ?? row.actualSystem ?? null
  );
  const [finalInvalid, setFinalInvalid] = useState(false);
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);

  const locked = row.status === "FINALIZED";
  const canSelf = isMine && selfEditable(row, selfOpen);
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
    finalValue !== null &&
    round2(finalValue) !== round2(row.actualSelf);

  const selfValue = selfDraft?.value ?? null;
  const selfInvalid = selfDraft?.invalid ?? false;
  const selfNote = selfDraft?.note ?? "";

  // Vì sao dòng này không có ô nhập — nói đúng lý do, không chung chung.
  const idleText = locked
    ? "Đã khoá"
    : isMine && selfOpen && row.status === "MANAGER_REVIEWED"
      ? "Trưởng phòng đã duyệt"
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
          <VnNumberInput
            className="input py-1.5 text-sm"
            aria-label={`Số thực tế (${row.unit})`}
            placeholder={`Số thực tế (${row.unit})`}
            value={selfValue}
            onValue={(n, invalid) => onSelfDraft({ value: n, invalid })}
          />
          <input
            className="input py-1.5 text-sm"
            aria-label="Giải trình ngắn"
            placeholder="Giải trình ngắn (tuỳ chọn)"
            value={selfNote}
            onChange={(e) => onSelfDraft({ note: e.target.value })}
          />
          <button
            className="btn-ghost btn-sm w-full"
            disabled={busy || selfValue === null || selfInvalid}
            onClick={() =>
              onCall(
                url,
                {
                  action: "SELF_REVIEW",
                  actualSelf: selfValue,
                  selfNote: selfNote.trim() || undefined,
                },
                `Đã gửi số tự khai · ${row.kpiName}`
              )
            }
          >
            {row.status === "DRAFT" ? "Gửi dòng này" : "Gửi lại dòng này"}
          </button>
        </div>
      )}

      {/* Trưởng phòng / BGĐ duyệt */}
      {canManager && (
        <div className="space-y-1.5">
          <VnNumberInput
            className="input py-1.5 text-sm"
            aria-label="Số chốt"
            placeholder="Số chốt"
            value={finalValue}
            onValue={(n, invalid) => {
              setFinalValue(n);
              setFinalInvalid(invalid);
            }}
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
            className="btn-primary btn-sm w-full"
            disabled={
              busy ||
              finalValue === null ||
              finalInvalid ||
              (needsReason && reason.trim() === "")
            }
            onClick={() =>
              onCall(
                url,
                {
                  action: "MANAGER_REVIEW",
                  actualFinal: finalValue,
                  reason: reason || undefined,
                },
                needsReason ? `Đã điều chỉnh & duyệt · ${row.kpiName}` : `Đã duyệt · ${row.kpiName}`
              )
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
            <VnNumberInput
              className="input py-1.5 text-sm"
              aria-label="Số chốt mới"
              value={finalValue}
              onValue={(n, invalid) => {
                setFinalValue(n);
                setFinalInvalid(invalid);
              }}
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
                className="btn-ghost btn-sm"
                onClick={() => setEditing(false)}
              >
                Huỷ
              </button>
              <button
                className="btn-danger btn-sm flex-1"
                disabled={
                  busy || finalValue === null || finalInvalid || reason.trim().length < 10
                }
                onClick={async () => {
                  const ok = await onCall(
                    url,
                    {
                      action: "EDIT_LOCKED",
                      actualFinal: finalValue,
                      reason,
                    },
                    `Đã sửa điểm đã khoá · ${row.kpiName}`
                  );
                  // Lỗi thì giữ khung sửa (và lý do đã gõ) để sửa lại
                  if (ok) setEditing(false);
                }}
              >
                Xác nhận sửa
              </button>
            </div>
          </div>
        ) : (
          <button
            className="btn btn-sm inline-flex items-center gap-1.5"
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

  const gate = row.gatekeeper;
  // Gatekeeper: không có mức đạt / trần — hiện luật ngưỡng và đạt hay vượt
  const achievement = gate ? (
    <GatekeeperStatus rule={gate} actual={actual} />
  ) : actual === null ? (
    <span className="text-xs text-ink-500">chưa có số</span>
  ) : (
    <>
      <div className="mb-1 text-xs text-ink-600">
        {achievementText(row.achievementPercent, row.isCapped, row.cap)}
      </div>
      <AchievementBar percent={row.achievementPercent} cap={row.cap} />
    </>
  );
  // Gatekeeper chỉ có điểm khi bị trừ; trong ngưỡng là "không trừ", không phải 0 điểm
  const score = gate
    ? row.weightedScore < 0
      ? <span className="text-red-700">{fmtScore(row.weightedScore)}</span>
      : "—"
    : actual === null
      ? "—"
      : fmtScore(row.weightedScore);
  const subtitle = gate
    ? gatekeeperRuleText(gate)
    : row.isHigherBetter
      ? "càng cao càng tốt"
      : "càng thấp càng tốt";

  const notes = (
    <>
      {row.hasMismatch && (
        <div className="mt-1 flex items-center gap-1 text-xs font-medium text-red-600">
          <AlertTriangle size={12} strokeWidth={2.5} aria-hidden /> Lệch{" "}
          {fmtPct(row.mismatchPercent, { signed: true })} so với số hệ thống
        </div>
      )}
      {row.selfNote && (
        <div className="mt-1 text-xs text-ink-500">Nhân viên: {row.selfNote}</div>
      )}
      {row.managerNote && (
        <div className="mt-1 text-xs text-brand-700">Trưởng phòng: {row.managerNote}</div>
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
              {gate ? subtitle : `Trọng số ${fmtNum(row.weightPercent)}% · ${subtitle}`}
            </div>
          </div>
          <KpiStatusBadge status={row.status} />
        </div>
        {notes}
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm tabular-nums">
          <dt className="text-ink-500">Giao</dt>
          <dd className="text-right text-ink-700">
            {fmtNum(row.targetValue)} {row.unit}
          </dd>
          {(showSystem || showSelf) && (
            <>
              <dt className="text-ink-500">
                {showSystem && showSelf
                  ? "Hệ thống / nhân viên khai"
                  : showSystem
                    ? "Hệ thống"
                    : "Nhân viên khai"}
              </dt>
              <dd className="text-right text-ink-700">
                {showSystem && showSelf
                  ? `${fmtNum(row.actualSystem)} / ${fmtNum(row.actualSelf)}`
                  : fmtNum(showSystem ? row.actualSystem : row.actualSelf)}
              </dd>
            </>
          )}
          <dt className="text-ink-500">Số chốt · Điểm</dt>
          <dd className="text-right font-medium text-ink-900">
            {fmtNum(row.actualFinal)} · {score}
          </dd>
        </dl>
        <div className="mt-2">{achievement}</div>
        {showActions && <div className="mt-3">{actions}</div>}
      </li>
    );
  }

  return (
    <tr className={row.hasMismatch ? "bg-red-50/40" : undefined}>
      <td>
        <div className="font-medium text-ink-800">{row.kpiName}</div>
        <div className="text-xs text-ink-500">
          {gate ? subtitle : `${row.isHigherBetter ? "↑" : "↓"} ${subtitle}`} ·{" "}
          {row.unit} · nguồn {sourceLabel(row.dataSource)}
        </div>
        {notes}
      </td>
      <td
        className="text-right text-ink-600 tabular-nums"
        title={gate ? "Không cộng điểm — chỉ trừ khi vượt ngưỡng" : undefined}
      >
        {gate ? "—" : `${fmtNum(row.weightPercent)}%`}
      </td>
      <td className="text-right whitespace-nowrap text-ink-600 tabular-nums">
        {fmtNum(row.targetValue)}
      </td>
      <td className="text-right text-xs whitespace-nowrap tabular-nums">
        {showSystem && (
          <div className="text-ink-500" title="Số hệ thống">
            HT <span className="text-ink-700">{fmtNum(row.actualSystem)}</span>
          </div>
        )}
        {showSelf && (
          <div className="text-ink-500" title="Nhân viên tự khai">
            NV <span className="text-ink-700">{fmtNum(row.actualSelf)}</span>
          </div>
        )}
        <div className="text-ink-500" title="Số chốt">
          Chốt{" "}
          <span className="text-sm font-semibold text-ink-900">
            {fmtNum(row.actualFinal)}
          </span>
        </div>
      </td>
      <td>{achievement}</td>
      <td className="text-right font-semibold text-ink-900 tabular-nums">{score}</td>
      <td>
        <KpiStatusBadge status={row.status} />
      </td>
      {showActions && (
        <td
          className={`sticky right-0 z-10 shadow-[-8px_0_8px_-8px_rgb(0_0_0/0.12)] ${
            row.hasMismatch ? "bg-red-50" : "bg-white"
          }`}
        >
          {actions}
        </td>
      )}
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
        `Đã nạp ${fmtNum(data.rowsOk)}/${fmtNum(data.rowsTotal)} dòng.${
          data.rowsError ? ` ${fmtNum(data.rowsError)} dòng lỗi.` : ""
        }`
      );
      router.refresh();
    } catch {
      setResult("Lỗi: mất kết nối tới máy chủ.");
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

function sourceLabel(s: string) {
  return s === "IPOS_API" ? "iPOS/API" : s === "EXCEL" ? "Excel" : "nhập tay";
}
