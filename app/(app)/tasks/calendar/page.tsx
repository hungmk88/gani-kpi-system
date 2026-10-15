import { vnDate, vnDateKey, vnParts } from "@/lib/vn-time";
import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, Flame } from "lucide-react";
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

  // Mọi mốc ngày theo lịch Việt Nam (server chạy UTC)
  const today = new Date();
  const nowVn = vnParts(today);
  const month = sp.m ? parseInt(sp.m, 10) : nowVn.month;
  const year = sp.y ? parseInt(sp.y, 10) : nowVn.year;

  const monthStart = vnDate(year, month, 1);
  const monthEnd = vnDate(year, month + 1, 1); // mốc loại trừ

  // Lưới lịch bắt đầu từ thứ Hai của tuần chứa ngày 1
  const shift = (vnParts(monthStart).weekday + 6) % 7; // thứ Hai = 0
  const gridStart = vnDate(year, month, 1 - shift);
  const gridEnd = vnDate(year, month, 1 - shift + 42); // mốc loại trừ

  const tasks = await prisma.task.findMany({
    where: {
      ...taskScopeWhere(user),
      status: { not: "CANCELLED" },
      dueDate: { gte: gridStart, lt: gridEnd },
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
    days.push(vnDate(year, month, 1 - shift + i));
  }

  const prev = month === 1 ? { m: 12, y: year - 1 } : { m: month - 1, y: year };
  const next = month === 12 ? { m: 1, y: year + 1 } : { m: month + 1, y: year };
  const todayKey = dayKey(today);

  const inMonth = tasks.filter(
    (t) => t.dueDate >= monthStart && t.dueDate < monthEnd
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
            <ChevronLeft size={16} aria-hidden /> Tháng trước
          </Link>
          <Link href="/tasks/calendar" className="btn-ghost btn-sm">
            Hôm nay
          </Link>
          <Link
            href={`/tasks/calendar?m=${next.m}&y=${next.y}`}
            className="btn-ghost btn-sm"
          >
            Tháng sau <ChevronRight size={16} aria-hidden />
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
                className="px-2 py-2 text-center text-xs font-semibold text-ink-500"
              >
                {w}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {days.map((d) => {
              const k = dayKey(d);
              const list = byDay.get(k) ?? [];
              const dp = vnParts(d);
              const isOtherMonth = dp.month !== month;
              const isToday = k === todayKey;
              const isWeekend = dp.weekday === 0 || dp.weekday === 6;

              return (
                <div
                  key={k}
                  className={`min-h-28 border-r border-b border-ink-100 p-1.5 ${
                    isWeekend
                      ? "bg-ink-50"
                      : isOtherMonth
                        ? "bg-ink-50/50"
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
                      {dp.day}
                    </span>
                    {list.length > 2 && (
                      <span className="text-xs text-ink-500 tabular-nums">
                        {list.length} việc
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    {list.slice(0, 3).map((t) => {
                      const late = t.dueDate < today && t.status !== "DONE";
                      // Chỉ ngoại lệ (trễ, khẩn cấp, ưu tiên cao) mới tô nền;
                      // việc bình thường và việc đã xong là ô trắng viền mảnh.
                      const tone =
                        t.status === "DONE"
                          ? "border-ink-200 bg-white text-ink-500"
                          : late
                            ? "border-red-200 bg-red-50 text-red-800"
                            : t.priority === "CRITICAL"
                              ? "border-red-200 bg-red-50 text-red-800"
                              : t.priority === "HIGH"
                                ? "border-amber-200 bg-amber-50 text-amber-800"
                                : "border-ink-200 bg-white text-ink-800";
                      return (
                        <Link
                          key={t.id}
                          href={`/tasks/${t.id}`}
                          title={`${t.title}\n${t.department.name} · ${
                            t.assignee?.fullName ?? "chưa giao"
                          }\n${TASK_STATUS_LABEL[t.status]} · ${
                            TASK_PRIORITY_LABEL[t.priority]
                          }`}
                          className={`flex min-w-0 items-center gap-1 rounded border px-1.5 py-1 text-xs leading-tight ${tone} hover:border-ink-300`}
                        >
                          {t.status === "DONE" ? (
                            <Check size={12} strokeWidth={2.5} className="shrink-0 text-leaf-600" aria-hidden />
                          ) : (
                            t.priority === "CRITICAL" && (
                              <Flame size={12} strokeWidth={2.5} className="shrink-0" aria-hidden />
                            )
                          )}
                          <span className="truncate">{t.title}</span>
                        </Link>
                      );
                    })}
                    {list.length > 3 && (
                      <div
                        className="px-1 text-xs text-ink-500"
                        title={list
                          .slice(3)
                          .map((t) => t.title)
                          .join("\n")}
                      >
                        +{list.length - 3} việc nữa
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
  return vnDateKey(d);
}
