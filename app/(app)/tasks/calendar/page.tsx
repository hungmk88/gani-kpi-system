import Link from "next/link";
import { Flame } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { taskScopeWhere } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import { TASK_PRIORITY_LABEL, TASK_STATUS_LABEL } from "@/lib/constants";

export const dynamic = "force-dynamic";

const WEEKDAY_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = (await requireSession())!;
  const sp = await searchParams;

  const today = new Date();
  const month = sp.m ? parseInt(sp.m, 10) : today.getMonth() + 1;
  const year = sp.y ? parseInt(sp.y, 10) : today.getFullYear();

  const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

  // Lưới lịch bắt đầu từ thứ Hai của tuần chứa ngày 1
  const gridStart = new Date(monthStart);
  const shift = (monthStart.getDay() + 6) % 7; // thứ Hai = 0
  gridStart.setDate(gridStart.getDate() - shift);

  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridEnd.getDate() + 41);
  gridEnd.setHours(23, 59, 59, 999);

  const tasks = await prisma.task.findMany({
    where: {
      ...taskScopeWhere(user),
      status: { not: "CANCELLED" },
      dueDate: { gte: gridStart, lte: gridEnd },
    },
    include: { assignee: true, department: true },
    orderBy: [{ dueDate: "asc" }, { riskScore: "desc" }],
  });

  // Gom theo ngày
  const byDay = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const k = dayKey(t.dueDate);
    const list = byDay.get(k) ?? [];
    list.push(t);
    byDay.set(k, list);
  }

  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  const prev = month === 1 ? { m: 12, y: year - 1 } : { m: month - 1, y: year };
  const next = month === 12 ? { m: 1, y: year + 1 } : { m: month + 1, y: year };
  const todayKey = dayKey(today);

  const inMonth = tasks.filter(
    (t) => t.dueDate >= monthStart && t.dueDate <= monthEnd
  );
  const overdue = inMonth.filter(
    (t) => t.dueDate < today && t.status !== "DONE"
  ).length;

  return (
    <>
      <PageHeader
        title="Lịch công việc"
        subtitle={`${inMonth.length} việc tới hạn trong tháng ${String(month).padStart(2, "0")}/${year}${
          overdue > 0 ? ` · ${overdue} việc đã trễ` : ""
        }`}
        actions={
          <div className="flex gap-2">
            <Link href="/tasks" className="btn-ghost btn-sm">
              Bảng Kanban
            </Link>
            <Link href="/tasks/gantt" className="btn-ghost btn-sm">
              Gantt
            </Link>
          </div>
        }
      />

      {/* ---------------- điều hướng tháng ---------------- */}
      <div className="card mb-4 flex flex-wrap items-center justify-between gap-2 p-3">
        <div className="flex items-center gap-2">
          <Link
            href={`/tasks/calendar?m=${prev.m}&y=${prev.y}`}
            className="btn-ghost btn-sm"
          >
            ← Tháng trước
          </Link>
          <Link href="/tasks/calendar" className="btn-ghost btn-sm">
            Hôm nay
          </Link>
          <Link
            href={`/tasks/calendar?m=${next.m}&y=${next.y}`}
            className="btn-ghost btn-sm"
          >
            Tháng sau →
          </Link>
        </div>
        <div className="text-lg font-bold text-ink-900">
          Tháng {String(month).padStart(2, "0")} / {year}
        </div>
      </div>

      {/* ---------------- lưới lịch ---------------- */}
      <div className="table-wrap">
        <div className="min-w-[860px]">
          <div className="grid grid-cols-7 border-b border-ink-200 bg-ink-50/70">
            {WEEKDAY_LABELS.map((w) => (
              <div
                key={w}
                className="px-2 py-2 text-center text-xs font-semibold tracking-wide text-ink-500 uppercase"
              >
                {w}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {days.map((d) => {
              const k = dayKey(d);
              const list = byDay.get(k) ?? [];
              const isOtherMonth = d.getMonth() !== month - 1;
              const isToday = k === todayKey;
              const isWeekend = d.getDay() === 0 || d.getDay() === 6;

              return (
                <div
                  key={k}
                  className={`min-h-28 border-r border-b border-ink-100 p-1.5 ${
                    isOtherMonth
                      ? "bg-ink-50/40"
                      : isWeekend
                        ? "bg-ink-50/25"
                        : "bg-white"
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                        isToday
                          ? "bg-brand-600 font-bold text-white"
                          : isOtherMonth
                            ? "text-ink-300"
                            : "text-ink-600"
                      }`}
                    >
                      {d.getDate()}
                    </span>
                    {list.length > 2 && (
                      <span className="text-[10px] text-ink-400">
                        {list.length} việc
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    {list.slice(0, 3).map((t) => {
                      const late = t.dueDate < today && t.status !== "DONE";
                      const tone =
                        t.status === "DONE"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : late
                            ? "border-red-200 bg-red-50 text-red-800"
                            : t.priority === "CRITICAL"
                              ? "border-red-200 bg-red-50 text-red-800"
                              : t.priority === "HIGH"
                                ? "border-amber-200 bg-amber-50 text-amber-800"
                                : "border-brand-200 bg-brand-50 text-brand-800";
                      return (
                        <Link
                          key={t.id}
                          href={`/tasks/${t.id}`}
                          title={`${t.title}\n${t.department.name} · ${
                            t.assignee?.fullName ?? "chưa giao"
                          }\n${TASK_STATUS_LABEL[t.status]} · ${
                            TASK_PRIORITY_LABEL[t.priority]
                          }`}
                          className={`flex items-center gap-0.5 truncate rounded border px-1.5 py-1 text-[11px] leading-tight ${tone} hover:brightness-95`}
                        >
                          {t.priority === "CRITICAL" && (
                            <Flame size={10} strokeWidth={2.5} className="shrink-0" />
                          )}
                          {t.title}
                        </Link>
                      );
                    })}
                    {list.length > 3 && (
                      <div className="px-1 text-[10px] text-ink-400">
                        + {list.length - 3} việc nữa
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs text-ink-500">
        Việc được xếp vào ngày hết hạn của nó. Ô viền đỏ là việc đã quá hạn hoặc
        ở mức khẩn cấp.
      </p>
    </>
  );
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
