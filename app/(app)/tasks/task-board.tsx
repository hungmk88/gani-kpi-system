"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Wand2, TriangleAlert } from "lucide-react";
import {
  KANBAN_COLUMNS,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
} from "@/lib/constants";
import {
  DueDate,
  PriorityBadge,
  ProgressBar,
  RiskBadge,
  TaskStatusBadge,
} from "@/components/ui";

export type TaskRow = {
  id: string;
  code: string;
  title: string;
  status: string;
  priority: string;
  progress: number;
  riskScore: number;
  riskReason: string | null;
  dueDate: string;
  assigneeName: string | null;
  departmentName: string;
  isAiGenerated?: boolean;
};

export default function TaskBoard({
  tasks,
  departments,
  role,
  showDeptFilter,
  totalCount,
  doneVisibleDays,
}: {
  tasks: TaskRow[];
  departments: { id: string; name: string }[];
  role: string;
  showDeptFilter: boolean;
  totalCount: number;
  doneVisibleDays: number;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const activeFilter = sp.get("filter");
  const activeDept = sp.get("dept") ?? "";
  const [showAllDone, setShowAllDone] = useState(false);

  /** Đổi một tham số lọc trên URL, giữ nguyên các tham số còn lại. */
  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.push(qs ? `/tasks?${qs}` : "/tasks");
  }
  const [view, setView] = useState<"board" | "list">("board");
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState("");
  const [onlyRisk, setOnlyRisk] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tasks.filter((t) => {
      if (needle && !`${t.title} ${t.code}`.toLowerCase().includes(needle))
        return false;
      if (priority && t.priority !== priority) return false;
      if (onlyRisk && t.riskScore < 60) return false;
      return true;
    });
  }, [tasks, q, priority, onlyRisk]);

  const byStatus = useMemo(() => {
    const map: Record<string, TaskRow[]> = {};
    for (const c of KANBAN_COLUMNS) map[c] = [];
    for (const t of filtered) {
      if (map[t.status]) map[t.status].push(t);
      else (map.TO_DO ||= []).push(t);
    }
    // Trong mỗi cột: việc trễ lên đầu (trễ lâu nhất trước), rồi rủi ro cao,
    // rồi hạn gần. Cột Hoàn thành: mới xong (hạn gần nhất) trước.
    const now = Date.now();
    for (const c of KANBAN_COLUMNS) {
      map[c].sort((a, b) => {
        if (c === "DONE") return +new Date(b.dueDate) - +new Date(a.dueDate);
        const la = isLate(a, now);
        const lb = isLate(b, now);
        if (la !== lb) return la ? -1 : 1;
        if (a.riskScore !== b.riskScore) return b.riskScore - a.riskScore;
        return +new Date(a.dueDate) - +new Date(b.dueDate);
      });
    }
    return map;
  }, [filtered]);

  // Điện thoại: một danh sách nhóm, ngoại lệ (trễ, bị chặn) lên đầu
  const mobileGroups = useMemo(() => {
    const now = Date.now();
    const late = filtered.filter((t) => isLate(t, now));
    const lateIds = new Set(late.map((t) => t.id));
    const rest = (st: string[]) =>
      filtered.filter((t) => !lateIds.has(t.id) && st.includes(t.status));
    return [
      { key: "late", label: "Đã trễ hạn", tone: "red" as const, items: late },
      { key: "blocked", label: "Bị chặn", tone: "red" as const, items: rest(["BLOCKED"]) },
      { key: "review", label: "Chờ duyệt", tone: "amber" as const, items: rest(["REVIEW"]) },
      { key: "doing", label: "Đang làm", tone: "brand" as const, items: rest(["IN_PROGRESS"]) },
      { key: "todo", label: "Cần làm", tone: "brand" as const, items: rest(["TO_DO", "BACKLOG"]) },
      { key: "done", label: "Hoàn thành", tone: "slate" as const, items: rest(["DONE"]) },
    ].filter((g) => g.items.length > 0);
  }, [filtered]);

  return (
    <>
      {/* ------------------- Bộ lọc ------------------- */}
      <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
        <input
          className="input max-w-xs flex-1"
          aria-label="Tìm việc"
          placeholder="Tìm theo tên việc hoặc mã..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="input w-auto"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        >
          <option value="">Mọi mức ưu tiên</option>
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {TASK_PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>

        {showDeptFilter && (
          <select
            className="input w-auto"
            aria-label="Lọc theo phòng ban"
            onChange={(e) => setParam("dept", e.target.value || null)}
            value={activeDept}
          >
            <option value="">Mọi phòng ban</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}

        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-600">
          <input
            type="checkbox"
            checked={onlyRisk}
            onChange={(e) => setOnlyRisk(e.target.checked)}
          />
          Chỉ việc có nguy cơ
        </label>

        <div className="ml-auto flex overflow-hidden rounded-lg border border-ink-200">
          <button
            onClick={() => setView("board")}
            className={`px-3 py-2 text-sm font-medium ${
              view === "board"
                ? "bg-brand-600 text-white"
                : "bg-white text-ink-600"
            }`}
          >
            Bảng
          </button>
          <button
            onClick={() => setView("list")}
            className={`px-3 py-2 text-sm font-medium ${
              view === "list"
                ? "bg-brand-600 text-white"
                : "bg-white text-ink-600"
            }`}
          >
            Danh sách
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-ink-500">
        <span>
          {filtered.length} công việc
          {filtered.length !== tasks.length && ` (lọc từ ${tasks.length})`}
        </span>
        {(activeFilter === "overdue" || activeFilter === "mine") && (
          <button
            onClick={() => setParam("filter", null)}
            className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700"
          >
            Đang lọc: {activeFilter === "overdue" ? "Trễ hạn" : "Việc của tôi"}
            <span aria-hidden>×</span>
            <span className="sr-only">Bỏ lọc</span>
          </button>
        )}
        {totalCount > tasks.length && (
          <span className="text-amber-700">
            · Đang hiển thị {tasks.length}/{totalCount} việc — lọc thêm để thấy hết
          </span>
        )}
        <span className="text-xs">
          · Cột Hoàn thành chỉ giữ việc xong trong {doneVisibleDays} ngày qua
        </span>
      </div>

      {/* ------------------- Bảng Kanban ------------------- */}
      {view === "board" ? (
        <>
          {/* Điện thoại: danh sách nhóm — 5 cột 288px trên màn 390px thì
              việc trễ nằm ở cột ngoài màn hình, không ai thấy. */}
          <div className="space-y-4 sm:hidden">
            {mobileGroups.length === 0 && (
              <div className="card p-6 text-center text-sm text-ink-500">
                Không có công việc nào khớp bộ lọc.
              </div>
            )}
            {mobileGroups.map((g) => (
              <section key={g.key}>
                <div className="mb-1.5 flex items-center justify-between px-1">
                  <span
                    className={`text-sm font-semibold ${
                      g.tone === "red" ? "text-red-700" : "text-ink-700"
                    }`}
                  >
                    {g.label}
                  </span>
                  <span className="rounded-md bg-ink-100 px-1.5 py-0.5 text-xs font-medium text-ink-600">
                    {g.items.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {(g.key === "done" && !showAllDone
                    ? g.items.slice(0, DONE_PREVIEW)
                    : g.items
                  ).map((t) => (
                    <TaskCard key={t.id} t={t} />
                  ))}
                  {g.key === "done" && !showAllDone && g.items.length > DONE_PREVIEW && (
                    <button
                      onClick={() => setShowAllDone(true)}
                      className="w-full rounded-lg border border-dashed border-ink-300 py-2 text-xs font-medium text-ink-600"
                    >
                      Xem thêm {g.items.length - DONE_PREVIEW} việc đã xong
                    </button>
                  )}
                </div>
              </section>
            ))}
          </div>

          {/* Máy tính lớn: 5 cột chia đều khung, không tràn ngang. Máy tính
              nhỏ/máy tính bảng: cuộn ngang trong khung. */}
          <div className="hidden overflow-x-auto pb-2 sm:block">
            <div className="flex min-w-max gap-3 lg:grid lg:min-w-0 lg:grid-cols-5">
              {KANBAN_COLUMNS.map((col) => {
                const items = byStatus[col] ?? [];
                const visible =
                  col === "DONE" && !showAllDone
                    ? items.slice(0, DONE_PREVIEW)
                    : items;
                const alarm = col === "BLOCKED" && items.length > 0;
                return (
                  <div key={col} className="w-72 shrink-0 lg:w-auto lg:min-w-0">
                    <div className="mb-2 flex items-center justify-between px-1">
                      <span
                        className={`text-sm font-semibold ${
                          alarm ? "text-red-700" : "text-ink-700"
                        }`}
                      >
                        {TASK_STATUS_LABEL[col]}
                      </span>
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${
                          alarm ? "bg-red-100 text-red-700" : "bg-ink-100 text-ink-600"
                        }`}
                      >
                        {items.length}
                      </span>
                    </div>
                    <div
                      className={`space-y-2 rounded-xl p-2 ${
                        alarm ? "bg-red-50" : "bg-ink-100/50"
                      }`}
                    >
                      {visible.map((t) => (
                        <TaskCard key={t.id} t={t} />
                      ))}
                      {col === "DONE" && !showAllDone && items.length > DONE_PREVIEW && (
                        <button
                          onClick={() => setShowAllDone(true)}
                          className="w-full rounded-lg border border-dashed border-ink-300 py-2 text-xs font-medium text-ink-600 hover:bg-white"
                        >
                          Xem thêm {items.length - DONE_PREVIEW} việc đã xong
                        </button>
                      )}
                      {items.length === 0 && (
                        <div className="px-2 py-4 text-center text-xs text-ink-400">
                          Không có
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        /* ------------------- Danh sách ------------------- */
        <div className="table-wrap">
          <table className="tbl tbl-stack">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Công việc</th>
                <th>Phòng ban</th>
                <th>Người phụ trách</th>
                <th>Hạn chót</th>
                <th>Ưu tiên</th>
                <th>Trạng thái</th>
                <th>Rủi ro</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td data-label="Mã" className="font-mono text-xs text-ink-500">{t.code}</td>
                  <td data-label="">
                    <Link
                      href={`/tasks/${t.id}`}
                      className="font-medium text-ink-900 hover:text-brand-700"
                    >
                      {t.title}
                    </Link>
                    <div className="mt-1 w-32">
                      <ProgressBar value={t.progress} />
                    </div>
                  </td>
                  <td data-label="Phòng ban" className="text-ink-600">{t.departmentName}</td>
                  <td data-label="Người phụ trách" className="text-ink-600">
                    {t.assigneeName ?? (
                      <span className="text-amber-600">Chưa giao</span>
                    )}
                  </td>
                  <td data-label="Hạn chót">
                    <DueDate date={t.dueDate} done={t.status === "DONE"} />
                  </td>
                  <td data-label="Ưu tiên">
                    <PriorityBadge priority={t.priority} />
                  </td>
                  <td data-label="Trạng thái">
                    <TaskStatusBadge status={t.status} />
                  </td>
                  <td data-label="Rủi ro">
                    <RiskBadge score={t.riskScore} />
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-ink-400">
                    Không có công việc nào khớp bộ lọc.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const DONE_PREVIEW = 5;
const OPEN_FOR_LATE = ["BACKLOG", "TO_DO", "IN_PROGRESS", "BLOCKED"];

/** Trễ = còn đang làm mà đã qua hạn. Việc chờ duyệt/đã xong không tính trễ. */
function isLate(t: TaskRow, now: number) {
  return OPEN_FOR_LATE.includes(t.status) && +new Date(t.dueDate) < now;
}

function TaskCard({ t }: { t: TaskRow }) {
  const late = isLate(t, Date.now());
  return (
    <Link
      href={`/tasks/${t.id}`}
      className={`block rounded-lg border bg-white p-3 shadow-sm transition hover:shadow-md ${
        late ? "border-red-200 border-l-[3px] border-l-red-500" : "border-ink-200/70"
      }`}
    >
      <div className="mb-2 line-clamp-2 text-sm font-medium text-ink-900">
        {t.isAiGenerated && (
          <span
            title="Việc này dựng từ bản nháp của máy, đã có người xác nhận"
            className="mr-1 inline-flex"
          >
            <Wand2 size={13} strokeWidth={2} />
          </span>
        )}
        {t.title}
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        <PriorityBadge priority={t.priority} />
        {t.riskScore >= 60 && <RiskBadge score={t.riskScore} />}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-1 text-xs text-ink-500">
        {t.assigneeName ?? (
          <span className="inline-flex items-center gap-1 text-amber-700">
            <TriangleAlert size={11} strokeWidth={2.5} /> Chưa giao
          </span>
        )}{" "}
        · <DueDate date={t.dueDate} done={!OPEN_FOR_LATE.includes(t.status)} />
      </div>
      <ProgressBar
        value={t.progress}
        tone={t.status === "DONE" ? "green" : late ? "red" : "brand"}
      />
    </Link>
  );
}
