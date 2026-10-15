"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import type { GanttResult } from "@/lib/gantt";
import { TASK_STATUS_LABEL } from "@/lib/constants";
import { formatVnDate, vnDateKey, vnParts } from "@/lib/vn-time";

const DAY = 86400_000;
const ROW_H = 38;
const LABEL_W = 300;

export default function GanttChart({
  data,
  projects,
  departments,
  showDeptFilter,
  activeProject,
  activeDept,
}: {
  data: GanttResult;
  projects: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  showDeptFilter: boolean;
  activeProject: string;
  activeDept: string;
}) {
  const router = useRouter();
  const [dayWidth, setDayWidth] = useState(30);
  const [onlyCritical, setOnlyCritical] = useState(false);

  const rangeStart = new Date(data.rangeStart).getTime();
  const items = useMemo(
    () => (onlyCritical ? data.items.filter((i) => i.isCritical) : data.items),
    [data.items, onlyCritical]
  );

  const chartW = data.totalDays * dayWidth;
  const chartH = items.length * ROW_H;

  const xOf = (iso: string) =>
    ((new Date(iso).getTime() - rangeStart) / DAY) * dayWidth;

  const rowOf = (id: string) => items.findIndex((i) => i.id === id);

  // Vạch ngày trên đầu biểu đồ
  const ticks = useMemo(() => {
    const out: { x: number; label: string; isWeekend: boolean; isToday: boolean }[] =
      [];
    // Theo lịch VN để server (UTC) và trình duyệt vẽ ra cùng một trục ngày
    const todayKey = vnDateKey(new Date());
    for (let d = 0; d < data.totalDays; d++) {
      const date = new Date(rangeStart + d * DAY);
      const p = vnParts(date);
      out.push({
        x: d * dayWidth,
        label: dayWidth >= 26 ? `${p.day}/${p.month}` : `${p.day}`,
        isWeekend: p.weekday === 0 || p.weekday === 6,
        isToday: vnDateKey(date) === todayKey,
      });
    }
    return out;
  }, [data.totalDays, rangeStart, dayWidth]);

  // Đường nối giữa việc chờ và việc bị chờ
  const arrows = useMemo(() => {
    const out: { d: string; critical: boolean }[] = [];
    for (const it of items) {
      const toRow = rowOf(it.id);
      if (toRow < 0) continue;
      for (const depId of it.dependencies) {
        const fromRow = rowOf(depId);
        if (fromRow < 0) continue;
        const from = items[fromRow];
        const x1 = xOf(from.end);
        const y1 = fromRow * ROW_H + ROW_H / 2;
        const x2 = xOf(it.start);
        const y2 = toRow * ROW_H + ROW_H / 2;
        const midX = Math.max(x1 + 8, x2 - 12);
        out.push({
          d: `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2 - 4} ${y2}`,
          critical: it.isCritical && from.isCritical,
        });
      }
    }
    return out;
  }, [items, dayWidth, rangeStart]);

  return (
    <>
      {/* ------------------ thanh công cụ ------------------ */}
      <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
        <select
          className="input w-auto"
          value={activeProject}
          onChange={(e) => {
            const v = e.target.value;
            router.push(v ? `/tasks/gantt?project=${v}` : "/tasks/gantt");
          }}
        >
          <option value="">Mọi dự án</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        {showDeptFilter && (
          <select
            className="input w-auto"
            value={activeDept}
            onChange={(e) => {
              const v = e.target.value;
              router.push(v ? `/tasks/gantt?dept=${v}` : "/tasks/gantt");
            }}
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
            checked={onlyCritical}
            onChange={(e) => setOnlyCritical(e.target.checked)}
          />
          Chỉ đường găng
        </label>

        <div className="ml-auto flex items-center gap-2 text-sm text-ink-500">
          <span>Độ rộng ngày</span>
          <input
            type="range"
            min={14}
            max={60}
            step={2}
            value={dayWidth}
            onChange={(e) => setDayWidth(Number(e.target.value))}
            className="w-28 accent-brand-600"
          />
        </div>
      </div>

      {/* ------------------ tóm tắt ------------------ */}
      <div className="mb-4 flex flex-wrap gap-3 text-sm">
        <Chip tone="red">
          Đường găng: {data.criticalCount} việc · {data.criticalDurationDays} ngày
        </Chip>
        <Chip tone="slate">Tổng {data.items.length} việc</Chip>
        <Chip tone="amber">
          Trễ hạn: {data.items.filter((i) => i.isOverdue).length} việc
        </Chip>
        {data.cycleDetected && (
          <Chip tone="red">
            <TriangleAlert size={11} strokeWidth={2.5} className="mr-1 inline -mt-0.5" />
            Có vòng lặp phụ thuộc ở {data.cycleTaskIds.length} việc — phải gỡ
            mới tính được đường găng
          </Chip>
        )}
      </div>

      {/* ------------------ biểu đồ ------------------ */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <div style={{ minWidth: LABEL_W + chartW }}>
            {/* Hàng ngày tháng */}
            <div className="flex border-b border-ink-200 bg-ink-50/70">
              <div
                className="shrink-0 border-r border-ink-200 px-3 py-2 text-xs font-semibold tracking-wide text-ink-500 uppercase"
                style={{ width: LABEL_W }}
              >
                Công việc
              </div>
              <div className="relative" style={{ width: chartW, height: 34 }}>
                {ticks.map((t, i) => (
                  <div
                    key={i}
                    className={`absolute top-0 bottom-0 border-l text-[10px] ${
                      t.isToday
                        ? "border-brand-400 bg-brand-50"
                        : t.isWeekend
                          ? "border-ink-100 bg-ink-100/50"
                          : "border-ink-100"
                    }`}
                    style={{ left: t.x, width: dayWidth }}
                  >
                    <span
                      className={`block pt-2 text-center ${
                        t.isToday
                          ? "font-bold text-brand-700"
                          : "text-ink-400"
                      }`}
                    >
                      {t.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Các hàng công việc */}
            <div className="flex">
              {/* Cột tên */}
              <div
                className="shrink-0 border-r border-ink-200"
                style={{ width: LABEL_W }}
              >
                {items.map((it) => (
                  <Link
                    key={it.id}
                    href={`/tasks/${it.id}`}
                    className="flex items-center gap-2 border-b border-ink-100 px-3 hover:bg-brand-50/40"
                    style={{ height: ROW_H }}
                  >
                    {it.isCritical && (
                      <span className="shrink-0 text-xs text-red-600">▲</span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink-800">
                        {it.title}
                      </span>
                      <span className="block truncate text-[11px] text-ink-400">
                        {it.assigneeName ?? "chưa giao"} ·{" "}
                        {TASK_STATUS_LABEL[it.status]}
                        {it.slackDays > 0 && ` · dư ${it.slackDays} ngày`}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>

              {/* Vùng vẽ thanh */}
              <div
                className="relative"
                style={{ width: chartW, height: chartH }}
              >
                {/* Nền sọc ngày */}
                {ticks.map((t, i) => (
                  <div
                    key={i}
                    className={`absolute top-0 border-l ${
                      t.isToday
                        ? "border-brand-400 bg-brand-50/40"
                        : t.isWeekend
                          ? "border-ink-100 bg-ink-100/40"
                          : "border-ink-100"
                    }`}
                    style={{ left: t.x, width: dayWidth, height: chartH }}
                  />
                ))}

                {/* Đường nối phụ thuộc */}
                <svg
                  className="pointer-events-none absolute top-0 left-0"
                  width={chartW}
                  height={chartH}
                >
                  <defs>
                    <marker
                      id="gantt-arrow"
                      markerWidth="6"
                      markerHeight="6"
                      refX="5"
                      refY="3"
                      orient="auto"
                    >
                      <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
                    </marker>
                  </defs>
                  {arrows.map((a, i) => (
                    <path
                      key={i}
                      d={a.d}
                      fill="none"
                      strokeWidth={a.critical ? 2 : 1.2}
                      className={
                        a.critical ? "text-red-500" : "text-ink-300"
                      }
                      stroke="currentColor"
                      markerEnd="url(#gantt-arrow)"
                    />
                  ))}
                </svg>

                {/* Thanh công việc */}
                {items.map((it, row) => {
                  const left = xOf(it.start);
                  const width = Math.max(
                    dayWidth * 0.6,
                    xOf(it.end) - left
                  );
                  const tone = it.isCritical
                    ? "bg-red-500"
                    : it.isOverdue
                      ? "bg-amber-500"
                      : it.status === "DONE"
                        ? "bg-emerald-500"
                        : "bg-brand-500";

                  return (
                    <Link
                      key={it.id}
                      href={`/tasks/${it.id}`}
                      title={`${it.code} · ${it.title}\n${formatVnDate(
                        it.start
                      )} → ${formatVnDate(it.end)} (${it.durationDays} ngày)\nTiến độ ${
                        it.progress
                      }%${it.isCritical ? "\nNẰM TRÊN ĐƯỜNG GĂNG" : `\nDư địa ${it.slackDays} ngày`}`}
                      className="absolute flex items-center"
                      style={{
                        left,
                        width,
                        top: row * ROW_H + 8,
                        height: ROW_H - 16,
                      }}
                    >
                      <span
                        className={`relative h-full w-full overflow-hidden rounded-md ${tone} shadow-sm transition hover:brightness-110`}
                      >
                        <span
                          className="absolute inset-y-0 left-0 bg-black/25"
                          style={{ width: `${it.progress}%` }}
                        />
                        {width > 60 && (
                          <span className="absolute inset-0 flex items-center px-2 text-[11px] font-medium text-white">
                            {it.progress}%
                          </span>
                        )}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ------------------ chú giải ------------------ */}
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-500">
        <Legend color="bg-red-500" label="Nằm trên đường găng" />
        <Legend color="bg-amber-500" label="Đã trễ hạn" />
        <Legend color="bg-brand-500" label="Đang trong kế hoạch" />
        <Legend color="bg-emerald-500" label="Đã hoàn thành" />
        <span>Phần tối trong thanh là tiến độ đã làm được.</span>
      </div>
    </>
  );
}

function Chip({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "red" | "amber" | "slate";
}) {
  const cls = {
    red: "border-red-200 bg-red-50 text-red-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    slate: "border-ink-200 bg-ink-50 text-ink-600",
  }[tone];
  return (
    <span className={`rounded-lg border px-3 py-1.5 ${cls}`}>{children}</span>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-3 w-5 rounded ${color}`} />
      {label}
    </span>
  );
}
