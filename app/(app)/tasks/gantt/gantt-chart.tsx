"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarCheck, Triangle, TriangleAlert } from "lucide-react";
import type { GanttResult } from "@/lib/gantt";
import { TASK_STATUS_LABEL } from "@/lib/constants";
import { formatVnDate, vnDateKey, vnParts } from "@/lib/vn-time";

const DAY = 86400_000;
const ROW_H = 38;
// Bề rộng cột tên: 140px trên điện thoại, 300px từ mốc `sm` trở lên.
// Đặt qua biến CSS để server và trình duyệt vẽ ra cùng một HTML.
const LABEL_W_VARS = "[--gantt-label-w:140px] sm:[--gantt-label-w:300px]";
const LABEL_W = "var(--gantt-label-w)";
// Khoảng cách tối đa từ mép cột tên tới vạch "hôm nay" sau khi cuộn
const TODAY_OFFSET = 200;

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [dayWidth, setDayWidth] = useState(30);
  const [onlyCritical, setOnlyCritical] = useState(false);
  // Thời điểm hiện tại chỉ lấy sau khi gắn vào trình duyệt, tránh lệch HTML với server
  const [nowMs, setNowMs] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);

  const rangeStart = new Date(data.rangeStart).getTime();
  // Thứ tự hàng đã do lib/gantt sắp sẵn: trễ → đường găng → theo hạn → đã xong
  const items = useMemo(
    () => (onlyCritical ? data.items.filter((i) => i.isCritical) : data.items),
    [data.items, onlyCritical]
  );

  const chartW = data.totalDays * dayWidth;
  const chartH = items.length * ROW_H;

  const xOf = useCallback(
    (t: string | number) =>
      ((new Date(t).getTime() - rangeStart) / DAY) * dayWidth,
    [rangeStart, dayWidth]
  );

  // Tra hàng theo id bằng Map, không findIndex lặp trong vòng vẽ mũi tên
  const rowIndex = useMemo(
    () => new Map(items.map((it, i) => [it.id, i])),
    [items]
  );

  // Đổi bộ lọc thì giữ nguyên các tham số khác trên URL
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  // Cuộn ngang để "hôm nay" hiện ngay sau cột tên
  const scrollToToday = useCallback(
    (smooth: boolean) => {
      const el = scrollRef.current;
      if (!el) return;
      const labelW = labelRef.current?.offsetWidth ?? 0;
      const offset = Math.max(
        0,
        Math.min(TODAY_OFFSET, (el.clientWidth - labelW) / 3)
      );
      el.scrollTo({
        left: Math.max(0, xOf(Date.now()) - offset),
        behavior: smooth ? "smooth" : "auto",
      });
    },
    [xOf]
  );

  useEffect(() => {
    setNowMs(Date.now());
  }, []);

  // Mở trang (hoặc đổi bộ lọc làm đổi khoảng ngày) là nhảy tới hôm nay ngay
  useEffect(() => scrollToToday(false), [data.rangeStart, data.totalDays]);

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
      const toRow = rowIndex.get(it.id);
      if (toRow === undefined) continue;
      for (const depId of it.dependencies) {
        const fromRow = rowIndex.get(depId);
        if (fromRow === undefined) continue;
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
  }, [items, rowIndex, xOf]);

  const overdueCount = data.items.filter((i) => i.isOverdue).length;
  const todayX = nowMs !== null ? xOf(nowMs) : null;
  const todayInRange = todayX !== null && todayX >= 0 && todayX <= chartW;

  return (
    <>
      {/* ------------------ thanh công cụ ------------------ */}
      <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
        <select
          className="input w-auto"
          aria-label="Lọc theo dự án"
          value={activeProject}
          onChange={(e) => setParam("project", e.target.value)}
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
            aria-label="Lọc theo phòng ban"
            value={activeDept}
            onChange={(e) => setParam("dept", e.target.value)}
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

        <button
          type="button"
          className="btn-ghost"
          onClick={() => scrollToToday(true)}
        >
          <CalendarCheck size={14} strokeWidth={2} />
          Hôm nay
        </button>

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
        <Chip tone={overdueCount > 0 ? "red" : "slate"}>
          Trễ hạn: {overdueCount} việc
        </Chip>
        <Chip tone="critical">
          Đường găng: {data.criticalCount} việc · {data.criticalDurationDays} ngày
        </Chip>
        <Chip tone="slate">Tổng {data.items.length} việc</Chip>
        {data.cycleDetected && (
          <Chip tone="red">
            <TriangleAlert size={12} strokeWidth={2.5} className="mr-1 inline -mt-0.5" />
            Có vòng lặp phụ thuộc ở {data.cycleTaskIds.length} việc — phải gỡ
            mới tính được đường găng
          </Chip>
        )}
      </div>

      {/* ------------------ biểu đồ ------------------ */}
      {items.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm font-medium text-ink-700">
            Không có việc nào nằm trên đường găng
          </p>
          <p className="mt-1 text-xs text-ink-500">
            {data.cycleDetected
              ? "Đang có vòng lặp phụ thuộc nên chưa tính được đường găng — gỡ vòng lặp trước."
              : "Các việc đang xem chưa nối với nhau thành chuỗi phụ thuộc. Bỏ chọn “Chỉ đường găng” để xem toàn bộ."}
          </p>
        </div>
      ) : (
        <div className={`card overflow-hidden ${LABEL_W_VARS}`}>
          <div ref={scrollRef} className="overflow-x-auto">
            <div style={{ minWidth: `calc(${LABEL_W} + ${chartW}px)` }}>
              {/* Hàng ngày tháng */}
              <div className="flex border-b border-ink-200 bg-ink-50/70">
                <div
                  ref={labelRef}
                  className="sticky left-0 z-10 shrink-0 border-r border-ink-200 bg-ink-50 px-3 py-2 text-xs font-semibold text-ink-600"
                  style={{ width: LABEL_W }}
                >
                  Công việc
                </div>
                <div className="relative" style={{ width: chartW, height: 34 }}>
                  {ticks.map((t, i) => (
                    <div
                      key={i}
                      className={`absolute top-0 bottom-0 border-l text-xs ${
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
                  {todayInRange && (
                    <div
                      className="pointer-events-none absolute top-0 bottom-0 w-0.5 -translate-x-1/2 bg-brand-600"
                      style={{ left: todayX! }}
                    />
                  )}
                </div>
              </div>

              {/* Các hàng công việc */}
              <div className="flex">
                {/* Cột tên — dính bên trái khi cuộn ngang */}
                <div
                  className="sticky left-0 z-10 shrink-0 border-r border-ink-200 bg-white"
                  style={{ width: LABEL_W }}
                >
                  {items.map((it) => {
                    const isDone = it.status === "DONE";
                    // Dư địa chỉ có nghĩa với việc còn mở và có nằm trong chuỗi phụ thuộc
                    const showSlack =
                      !isDone && it.hasDependencies && it.slackDays > 0;
                    return (
                      <Link
                        key={it.id}
                        href={`/tasks/${it.id}`}
                        className="flex items-center gap-2 border-b border-ink-100 px-3 hover:bg-brand-50/40"
                        style={{ height: ROW_H }}
                      >
                        {it.isCritical && (
                          <span
                            className="shrink-0 text-ink-900"
                            title="Nằm trên đường găng"
                          >
                            <Triangle size={12} strokeWidth={2.5} className="fill-current" aria-label="Nằm trên đường găng" />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block truncate text-sm ${
                              it.isOverdue
                                ? "font-medium text-red-700"
                                : isDone
                                  ? "text-ink-400"
                                  : "text-ink-800"
                            }`}
                          >
                            {it.title}
                          </span>
                          <span className="block truncate text-xs text-ink-400">
                            {it.isOverdue && (
                              <span className="font-medium text-red-600">
                                Trễ hạn ·{" "}
                              </span>
                            )}
                            {it.assigneeName ?? "chưa giao"} ·{" "}
                            {TASK_STATUS_LABEL[it.status]}
                            {showSlack && ` · dư ${it.slackDays} ngày`}
                          </span>
                        </span>
                      </Link>
                    );
                  })}
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
                          a.critical ? "text-ink-800" : "text-ink-300"
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
                    const isDone = it.status === "DONE";
                    // Màu nền theo tình trạng: trễ = đỏ (đỏ chỉ dành cho trễ, ở mọi
                    // màn), xong = xám nhạt, còn lại = màu chính. Đường găng không
                    // đổi màu nền mà thêm viền đậm màu mực — việc găng mà trễ thì
                    // thấy cả hai dấu hiệu cùng lúc, và không bị nhầm thành "trễ".
                    const fill = isDone
                      ? "bg-ink-200"
                      : it.isOverdue
                        ? "bg-red-500"
                        : "bg-brand-500";
                    const ring = it.isCritical
                      ? "ring-2 ring-ink-900 ring-offset-1"
                      : "";
                    const showSlack =
                      !isDone && it.hasDependencies && it.slackDays > 0;

                    return (
                      <Link
                        key={it.id}
                        href={`/tasks/${it.id}`}
                        title={`${it.code} · ${it.title}\n${formatVnDate(
                          it.start
                        )} → ${formatVnDate(it.end)} (${it.durationDays} ngày)\n${
                          isDone ? "Đã hoàn thành" : `Tiến độ ${it.progress}%`
                        }${it.isOverdue ? "\nĐã trễ hạn" : ""}${
                          it.isCritical ? "\nNằm trên đường găng" : ""
                        }${showSlack ? `\nDư địa ${it.slackDays} ngày` : ""}`}
                        className="absolute flex items-center"
                        style={{
                          left,
                          width,
                          top: row * ROW_H + 8,
                          height: ROW_H - 16,
                        }}
                      >
                        <span
                          className={`relative h-full w-full overflow-hidden rounded-md ${fill} ${ring} transition hover:brightness-110`}
                        >
                          {!isDone && (
                            <span
                              className="absolute inset-y-0 left-0 bg-black/25"
                              style={{ width: `${it.progress}%` }}
                            />
                          )}
                          {!isDone && width > 60 && (
                            <span className="absolute inset-0 flex items-center px-2 text-xs font-medium text-white">
                              {it.progress}%
                            </span>
                          )}
                        </span>
                      </Link>
                    );
                  })}

                  {/* Vạch "hôm nay" */}
                  {todayInRange && (
                    <div
                      className="pointer-events-none absolute top-0 w-0.5 -translate-x-1/2 bg-brand-600/80"
                      style={{ left: todayX!, height: chartH }}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------ chú giải ------------------ */}
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-500">
        <Legend color="bg-red-500" label="Đã trễ hạn" />
        <Legend
          color="bg-brand-500 ring-2 ring-ink-900 ring-offset-1"
          label="Nằm trên đường găng (viền đậm)"
        />
        <Legend color="bg-brand-500" label="Đang trong kế hoạch" />
        <Legend color="bg-ink-200" label="Đã hoàn thành" />
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-0.5 bg-brand-600" />
          Hôm nay
        </span>
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
  tone: "red" | "critical" | "slate";
}) {
  const cls = {
    red: "border-red-200 bg-red-50 text-red-700",
    // Đường găng: viền đậm màu mực như trên thanh, khác hẳn ô "Trễ hạn" đỏ
    critical: "border-ink-900 bg-white text-ink-900",
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
