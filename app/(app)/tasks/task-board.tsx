"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
}: {
  tasks: TaskRow[];
  departments: { id: string; name: string }[];
  role: string;
  showDeptFilter: boolean;
}) {
  const router = useRouter();
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
    return map;
  }, [filtered]);

  return (
    <>
      {/* ------------------- Bộ lọc ------------------- */}
      <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
        <input
          className="input max-w-xs flex-1"
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
            onChange={(e) => {
              const v = e.target.value;
              router.push(v ? `/tasks?dept=${v}` : "/tasks");
            }}
            defaultValue=""
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

      <div className="mb-3 text-sm text-ink-500">
        {filtered.length} công việc
        {filtered.length !== tasks.length && ` (lọc từ ${tasks.length})`}
      </div>

      {/* ------------------- Bảng Kanban ------------------- */}
      {view === "board" ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          <div className="flex min-w-max gap-3">
            {KANBAN_COLUMNS.map((col) => (
              <div key={col} className="w-72 shrink-0">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-sm font-semibold text-ink-700">
                    {TASK_STATUS_LABEL[col]}
                  </span>
                  <span className="rounded-md bg-ink-100 px-1.5 py-0.5 text-xs font-medium text-ink-600">
                    {byStatus[col]?.length ?? 0}
                  </span>
                </div>
                <div className="min-h-[120px] space-y-2 rounded-xl bg-ink-100/50 p-2">
                  {(byStatus[col] ?? []).map((t) => (
                    <Link
                      key={t.id}
                      href={`/tasks/${t.id}`}
                      className="block rounded-lg border border-ink-200/70 bg-white p-3 shadow-sm transition hover:shadow-md"
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
                      <div className="mb-2 flex items-center gap-1 text-xs text-ink-500">
                        {t.assigneeName ?? (
                          <span className="inline-flex items-center gap-1">
                            <TriangleAlert size={11} strokeWidth={2.5} /> Chưa giao
                          </span>
                        )}{" "}
                        ·{" "}
                        <DueDate
                          date={t.dueDate}
                          done={t.status === "DONE"}
                        />
                      </div>
                      <ProgressBar
                        value={t.progress}
                        tone={
                          t.status === "DONE"
                            ? "green"
                            : new Date(t.dueDate) < new Date()
                              ? "red"
                              : "brand"
                        }
                      />
                    </Link>
                  ))}
                  {(byStatus[col]?.length ?? 0) === 0 && (
                    <div className="px-2 py-6 text-center text-xs text-ink-400">
                      Trống
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* ------------------- Danh sách ------------------- */
        <div className="table-wrap">
          <table className="tbl">
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
                  <td className="font-mono text-xs text-ink-500">{t.code}</td>
                  <td>
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
                  <td className="text-ink-600">{t.departmentName}</td>
                  <td className="text-ink-600">
                    {t.assigneeName ?? (
                      <span className="text-amber-600">Chưa giao</span>
                    )}
                  </td>
                  <td>
                    <DueDate date={t.dueDate} done={t.status === "DONE"} />
                  </td>
                  <td>
                    <PriorityBadge priority={t.priority} />
                  </td>
                  <td>
                    <TaskStatusBadge status={t.status} />
                  </td>
                  <td>
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
