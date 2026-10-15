import { vnDate, vnDateKey, vnParts } from "@/lib/vn-time";
import Link from "next/link";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Flame,
  History,
  X,
} from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { taskScopeWhere } from "@/lib/rbac";
import { PageHeader, ShowingCount } from "@/components/ui";
import { TASK_PRIORITY_LABEL, TASK_STATUS_LABEL } from "@/lib/constants";
import { fmtDate, fmtDeadline } from "@/lib/format";
import { calendarRank, sortForCalendar } from "@/lib/urgency";

export const dynamic = "force-dynamic";

const WEEKDAY_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
/** Thứ trong tuần theo vnParts().weekday (0 = Chủ nhật) */
const WEEKDAY_SHORT = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
/** Số việc hiện trong một ô ngày trước khi gộp thành "+N" */
const CELL_LIMIT = 3;
/** Dải "Trễ từ trước" chỉ nêu tên chừng này việc, còn lại báo tổng */
const CARRYOVER_LIMIT = 12;

const OPEN_STATUSES = ["BACKLOG", "TO_DO", "IN_PROGRESS", "BLOCKED", "REVIEW"];

/** "2026-10-15" → [năm, tháng, ngày]; sai định dạng thì null */
function parseDayParam(v: string | undefined): [number, number, number] | null {
  const m = v ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  if (!m) return null;
  const parts: [number, number, number] = [+m[1], +m[2], +m[3]];
  // Ngày không tồn tại (31/02…) thì vnDate cuộn sang tháng sau — coi như sai
  return vnDateKey(vnDate(...parts)) === v ? parts : null;
}

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
  const focusDay = parseDayParam(sp.day);
  const month = sp.m ? parseInt(sp.m, 10) : (focusDay?.[1] ?? nowVn.month);
  const year = sp.y ? parseInt(sp.y, 10) : (focusDay?.[0] ?? nowVn.year);

  const monthStart = vnDate(year, month, 1);
  const monthEnd = vnDate(year, month + 1, 1); // mốc loại trừ

  // Lưới lịch bắt đầu từ thứ Hai của tuần chứa ngày 1
  const shift = (vnParts(monthStart).weekday + 6) % 7; // thứ Hai = 0
  const gridStart = vnDate(year, month, 1 - shift);
  const gridEnd = vnDate(year, month, 1 - shift + 42); // mốc loại trừ

  // Việc đã trễ mà hạn nằm TRƯỚC khung lịch đang xem — không ô ngày nào
  // chứa chúng, nên nếu không có dải riêng thì chúng biến mất khỏi Lịch.
  const carryWhere = {
    ...taskScopeWhere(user),
    status: { in: OPEN_STATUSES },
    dueDate: { lt: gridStart < today ? gridStart : today },
  };

  const [tasks, carryover, carryCount] = await Promise.all([
    prisma.task.findMany({
      where: {
        ...taskScopeWhere(user),
        status: { not: "CANCELLED" },
        dueDate: { gte: gridStart, lt: gridEnd },
      },
      include: { assignee: true, department: true },
      orderBy: [{ dueDate: "asc" }, { riskScore: "desc" }],
    }),
    prisma.task.findMany({
      where: carryWhere,
      include: { assignee: true },
      orderBy: { dueDate: "asc" },
      take: CARRYOVER_LIMIT,
    }),
    prisma.task.count({ where: carryWhere }),
  ]);

  type CalTask = (typeof tasks)[number];

  // Gom theo ngày, trong mỗi ngày: trễ → gấp → đang mở → xong
  const byDay = new Map<string, CalTask[]>();
  for (const t of tasks) {
    const k = vnDateKey(t.dueDate);
    const list = byDay.get(k) ?? [];
    list.push(t);
    byDay.set(k, list);
  }
  for (const [k, list] of byDay) byDay.set(k, sortForCalendar(list, today));

  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    days.push(vnDate(year, month, 1 - shift + i));
  }

  const prev = month === 1 ? { m: 12, y: year - 1 } : { m: month - 1, y: year };
  const next = month === 12 ? { m: 1, y: year + 1 } : { m: month + 1, y: year };
  const todayKey = vnDateKey(today);
  const monthQs = `m=${month}&y=${year}`;
  const dayHref = (k: string) => `/tasks/calendar?${monthQs}&day=${k}#ngay`;

  const inMonth = tasks.filter(
    (t) => t.dueDate >= monthStart && t.dueDate < monthEnd
  );
  const overdue = inMonth.filter((t) => calendarRank(t, today) === 0).length;

  // Điện thoại: danh sách theo ngày (chỉ những ngày trong tháng có việc)
  const monthDays = days.filter((d) => vnParts(d).month === month);
  const listDays = monthDays
    .map((d) => ({ d, k: vnDateKey(d), list: byDay.get(vnDateKey(d)) ?? [] }))
    .filter((x) => x.list.length > 0);

  const focusKey = focusDay ? sp.day! : null;
  const focusList = focusKey ? (byDay.get(focusKey) ?? []) : [];

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
            aria-label="Tháng trước"
          >
            <ChevronLeft size={16} aria-hidden />
            <span className="hidden sm:inline">Tháng trước</span>
          </Link>
          <Link href="/tasks/calendar" className="btn-ghost btn-sm">
            Hôm nay
          </Link>
          <Link
            href={`/tasks/calendar?m=${next.m}&y=${next.y}`}
            className="btn-ghost btn-sm"
            aria-label="Tháng sau"
          >
            <span className="hidden sm:inline">Tháng sau</span>
            <ChevronRight size={16} aria-hidden />
          </Link>
        </div>
        <div className="text-lg font-bold text-ink-900">
          Tháng {String(month).padStart(2, "0")} / {year}
        </div>
      </div>

      {/* ---------------- trễ từ trước ---------------- */}
      {carryCount > 0 && (
        <section className="card mb-4 border-l-[3px] border-l-red-600 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-red-700">
            <History size={16} strokeWidth={2} aria-hidden />
            Trễ từ trước ({carryCount.toLocaleString("vi-VN")} việc)
            <span className="font-normal text-ink-500">
              · hạn trước {fmtDate(gridStart < today ? gridStart : today)}, vẫn
              chưa xong
            </span>
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {carryover.map((t) => {
              const dl = fmtDeadline(t.dueDate, { now: today });
              return (
                <li key={t.id} className="min-w-0 max-w-full">
                  <Link
                    href={`/tasks/${t.id}`}
                    title={`${t.title}\n${t.assignee?.fullName ?? "chưa giao"} · hạn ${dl.date}`}
                    className="flex min-w-0 items-center gap-1.5 rounded-md bg-red-50 px-2 py-1 text-xs text-red-800 hover:bg-red-100"
                  >
                    <span className="max-w-56 truncate font-medium">{t.title}</span>
                    <span className="shrink-0">{dl.relative}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {carryCount > carryover.length && (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 text-xs">
              <ShowingCount shown={carryover.length} total={carryCount} />
              <Link
                href="/tasks?filter=overdue"
                className="mt-2 font-medium text-brand-600 hover:underline"
              >
                Xem tất cả việc trễ →
              </Link>
            </div>
          )}
        </section>
      )}

      {/* ---------------- danh sách đủ của một ngày ---------------- */}
      {focusKey && (
        <section id="ngay" className="card mb-4 scroll-mt-4 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink-900">
              Ngày {fmtDate(vnDate(...focusDay!))} ·{" "}
              {focusList.length} việc tới hạn
            </h2>
            <Link
              href={`/tasks/calendar?${monthQs}`}
              className="btn btn-sm"
              aria-label="Đóng danh sách ngày"
            >
              <X size={16} aria-hidden /> Đóng
            </Link>
          </div>
          {focusList.length === 0 ? (
            <p className="text-sm text-ink-500">Không có việc nào tới hạn ngày này.</p>
          ) : (
            <TaskLines list={focusList} today={today} />
          )}
        </section>
      )}

      {/* ---------------- điện thoại: danh sách theo ngày ---------------- */}
      <div className="space-y-3 sm:hidden">
        {listDays.length === 0 && (
          <div className="card p-6 text-center text-sm text-ink-500">
            Không có việc nào tới hạn trong tháng này.
          </div>
        )}
        {listDays.map(({ d, k, list }) => {
          const dp = vnParts(d);
          return (
            <section key={k} className="card p-3">
              <h2
                className={`mb-2 text-sm font-semibold ${
                  k === todayKey ? "text-brand-700" : "text-ink-800"
                }`}
              >
                {WEEKDAY_SHORT[dp.weekday]} · {fmtDate(d).slice(0, 5)}
                {k === todayKey && " · hôm nay"}
                <span className="ml-1 font-normal text-ink-500">
                  ({list.length} việc)
                </span>
              </h2>
              <TaskLines list={list} today={today} />
            </section>
          );
        })}
      </div>

      {/* ---------------- lưới lịch (từ sm trở lên) ---------------- */}
      <div className="table-wrap hidden sm:block">
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
              const k = vnDateKey(d);
              const list = byDay.get(k) ?? [];
              const dp = vnParts(d);
              const isOtherMonth = dp.month !== month;
              const isToday = k === todayKey;
              const isWeekend = dp.weekday === 0 || dp.weekday === 6;
              const isFocus = k === focusKey;
              // Số việc trễ bị gộp vào "+N" — nói rõ ra để không giấu ngoại lệ
              const hiddenLate = list
                .slice(CELL_LIMIT)
                .filter((t) => calendarRank(t, today) === 0).length;

              return (
                <div
                  key={k}
                  className={`min-h-28 border-r border-b border-ink-100 p-1.5 ${
                    isFocus
                      ? "bg-brand-50/60"
                      : isWeekend
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
                            ? "text-ink-400"
                            : "text-ink-600"
                      }`}
                    >
                      {dp.day}
                    </span>
                    {list.length > 2 && (
                      <Link
                        href={dayHref(k)}
                        className="text-xs text-ink-500 tabular-nums hover:text-brand-700 hover:underline"
                      >
                        {list.length} việc
                      </Link>
                    )}
                  </div>

                  <div className="space-y-1">
                    {list.slice(0, CELL_LIMIT).map((t) => (
                      <CellChip key={t.id} t={t} today={today} />
                    ))}
                    {list.length > CELL_LIMIT && (
                      <Link
                        href={dayHref(k)}
                        className={`block rounded px-1 text-xs hover:underline ${
                          hiddenLate > 0
                            ? "font-medium text-red-700"
                            : "text-brand-600"
                        }`}
                      >
                        +{list.length - CELL_LIMIT} việc nữa
                        {hiddenLate > 0 && ` · ${hiddenLate} trễ`}
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs text-ink-500">
        Việc được xếp vào ngày hết hạn của nó; trong mỗi ngày, việc trễ đứng
        trước, rồi việc khẩn cấp / ưu tiên cao, rồi việc đang mở, việc đã xong
        xuống cuối. Bấm &ldquo;+N việc nữa&rdquo; để xem đủ danh sách của ngày.
      </p>
    </>
  );
}

type ChipTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: Date;
  assignee: { fullName: string } | null;
  department?: { name: string } | null;
};

/** Một dòng việc trong ô lịch. Chỉ ngoại lệ (trễ, khẩn cấp, cao) mới tô nền. */
function CellChip({ t, today }: { t: ChipTask; today: Date }) {
  const rank = calendarRank(t, today);
  const tone =
    rank === 3
      ? "border-ink-200 bg-white text-ink-500"
      : rank === 0 || t.priority === "CRITICAL"
        ? "border-red-200 bg-red-50 text-red-800"
        : t.priority === "HIGH"
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-ink-200 bg-white text-ink-800";
  return (
    <Link
      href={`/tasks/${t.id}`}
      title={`${t.title}\n${t.department?.name ?? ""} · ${
        t.assignee?.fullName ?? "chưa giao"
      }\n${TASK_STATUS_LABEL[t.status]} · ${TASK_PRIORITY_LABEL[t.priority]}`}
      className={`flex min-w-0 items-center gap-1 rounded border px-1.5 py-1 text-xs leading-tight ${tone} hover:border-ink-300`}
    >
      {rank === 3 ? (
        <Check size={12} strokeWidth={2.5} className="shrink-0 text-leaf-600" aria-hidden />
      ) : (
        t.priority === "CRITICAL" && (
          <Flame size={12} strokeWidth={2.5} className="shrink-0" aria-hidden />
        )
      )}
      <span className="truncate">{t.title}</span>
    </Link>
  );
}

/** Danh sách đủ (ngày đang chọn / chế độ điện thoại): tên, người, trạng thái. */
function TaskLines({ list, today }: { list: ChipTask[]; today: Date }) {
  return (
    <ul className="divide-y divide-ink-100">
      {list.map((t) => {
        const rank = calendarRank(t, today);
        const dl = fmtDeadline(t.dueDate, { now: today, done: rank === 3 });
        return (
          <li key={t.id}>
            <Link
              href={`/tasks/${t.id}`}
              className="flex items-start gap-2 py-2 hover:bg-ink-50"
            >
              <span
                aria-hidden
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  rank === 0
                    ? "bg-red-500"
                    : rank === 1
                      ? "bg-amber-500"
                      : rank === 3
                        ? "bg-leaf-500"
                        : "bg-brand-500"
                }`}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-sm ${
                    rank === 3 ? "text-ink-500" : "font-medium text-ink-900"
                  }`}
                >
                  {t.priority === "CRITICAL" && rank !== 3 && (
                    <Flame size={12} strokeWidth={2.5} className="mr-1 inline -mt-0.5 text-red-700" aria-hidden />
                  )}
                  {t.title}
                </span>
                <span className="block truncate text-xs text-ink-500">
                  {t.assignee?.fullName ?? "chưa giao"} ·{" "}
                  {TASK_STATUS_LABEL[t.status] ?? t.status}
                  {rank === 0 && (
                    <span className="font-medium text-red-700"> · {dl.relative}</span>
                  )}
                  {rank === 1 && ` · ${TASK_PRIORITY_LABEL[t.priority]}`}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
