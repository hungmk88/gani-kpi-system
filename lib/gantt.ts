import { vnDayRange, vnStartOfDay } from "./vn-time";
/**
 * BỘ DỰNG DỮ LIỆU GANTT + TÍNH ĐƯỜNG GĂNG.
 *
 * Đường găng (Critical Path) là chuỗi công việc nối tiếp nhau dài nhất. Chậm bất
 * kỳ việc nào trên chuỗi đó là cả dự án chậm theo. Việc nằm ngoài đường găng thì
 * còn dư địa (slack) để trễ mà không kéo dự án.
 *
 * Thuật toán CPM chuẩn: một lượt đi tới tính thời điểm sớm nhất, một lượt đi lui
 * tính thời điểm muộn nhất, hiệu hai bên là dư địa. Dư địa bằng 0 là nằm trên
 * đường găng.
 */

const DAY = 86400_000;

export type GanttTaskInput = {
  id: string;
  code: string;
  title: string;
  status: string;
  priority: string;
  progress: number;
  riskScore: number;
  startDate: Date | null;
  dueDate: Date;
  createdAt: Date;
  assigneeName: string | null;
  departmentName: string;
};

export type GanttItem = {
  id: string;
  code: string;
  title: string;
  start: string;
  end: string;
  durationDays: number;
  progress: number;
  status: string;
  priority: string;
  riskScore: number;
  assigneeName: string | null;
  departmentName: string;
  dependencies: string[];
  /** Nằm trên đường găng hay không */
  isCritical: boolean;
  /** Số ngày có thể trễ mà không kéo cả dự án */
  slackDays: number;
  isOverdue: boolean;
};

export type GanttResult = {
  items: GanttItem[];
  rangeStart: string;
  rangeEnd: string;
  totalDays: number;
  criticalCount: number;
  criticalDurationDays: number;
  /** Có vòng lặp phụ thuộc thì không tính được đường găng, phải báo để người sửa */
  cycleDetected: boolean;
  cycleTaskIds: string[];
};

export function buildGantt(
  tasks: GanttTaskInput[],
  edges: { taskId: string; dependsOnId: string }[],
  now = new Date()
): GanttResult {
  const ids = new Set(tasks.map((t) => t.id));
  // Chỉ giữ những quan hệ mà cả hai đầu đều nằm trong tập đang xem
  const links = edges.filter(
    (e) => ids.has(e.taskId) && ids.has(e.dependsOnId)
  );

  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const t of tasks) {
    preds.set(t.id, []);
    succs.set(t.id, []);
  }
  for (const e of links) {
    preds.get(e.taskId)!.push(e.dependsOnId);
    succs.get(e.dependsOnId)!.push(e.taskId);
  }

  const start = (t: GanttTaskInput) => t.startDate ?? t.createdAt;
  const duration = (t: GanttTaskInput) =>
    Math.max(
      1,
      Math.round((t.dueDate.getTime() - start(t).getTime()) / DAY)
    );

  /* ---------------- sắp xếp tô-pô, đồng thời bắt vòng lặp ---------------- */

  const indeg = new Map<string, number>();
  for (const t of tasks) indeg.set(t.id, preds.get(t.id)!.length);

  const queue = tasks.filter((t) => indeg.get(t.id) === 0).map((t) => t.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const s of succs.get(id)!) {
      indeg.set(s, indeg.get(s)! - 1);
      if (indeg.get(s) === 0) queue.push(s);
    }
  }

  const cycleDetected = order.length !== tasks.length;
  const cycleTaskIds = cycleDetected
    ? tasks.filter((t) => !order.includes(t.id)).map((t) => t.id)
    : [];

  /* ---------------- lượt đi tới: sớm nhất có thể bắt đầu / xong ---------- */

  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  const byId = new Map(tasks.map((t) => [t.id, t]));

  for (const id of order) {
    const t = byId.get(id)!;
    const d = duration(t);
    const p = preds.get(id)!;
    const earliest = p.length
      ? Math.max(...p.map((x) => ef.get(x) ?? 0))
      : 0;
    es.set(id, earliest);
    ef.set(id, earliest + d);
  }

  const projectEnd = order.length
    ? Math.max(...order.map((id) => ef.get(id) ?? 0))
    : 0;

  /* ---------------- lượt đi lui: muộn nhất được phép ------------------- */

  const lf = new Map<string, number>();
  const ls = new Map<string, number>();

  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const t = byId.get(id)!;
    const d = duration(t);
    const s = succs.get(id)!.filter((x) => ls.has(x));
    const latest = s.length ? Math.min(...s.map((x) => ls.get(x)!)) : projectEnd;
    lf.set(id, latest);
    ls.set(id, latest - d);
  }

  /* ---------------- ráp kết quả ---------------------------------------- */

  const items: GanttItem[] = tasks.map((t) => {
    const slack =
      es.has(t.id) && ls.has(t.id) ? Math.round(ls.get(t.id)! - es.get(t.id)!) : 0;
    const onGraph = preds.get(t.id)!.length > 0 || succs.get(t.id)!.length > 0;

    return {
      id: t.id,
      code: t.code,
      title: t.title,
      start: start(t).toISOString(),
      end: t.dueDate.toISOString(),
      durationDays: duration(t),
      progress: t.progress,
      status: t.status,
      priority: t.priority,
      riskScore: t.riskScore,
      assigneeName: t.assigneeName,
      departmentName: t.departmentName,
      dependencies: preds.get(t.id)!,
      // Việc đứng một mình không thuộc chuỗi nào thì không gọi là đường găng
      isCritical: !cycleDetected && onGraph && slack === 0,
      slackDays: slack,
      isOverdue:
        t.dueDate.getTime() < now.getTime() &&
        !["DONE", "CANCELLED"].includes(t.status),
    };
  });

  const times = tasks.flatMap((t) => [
    start(t).getTime(),
    t.dueDate.getTime(),
  ]);
  const min = times.length ? Math.min(...times) : now.getTime();
  const max = times.length ? Math.max(...times) : now.getTime() + 7 * DAY;

  // Nới hai đầu cho dễ nhìn, và luôn phủ được ngày hôm nay
  const rangeStart = vnStartOfDay(Math.min(min, now.getTime()) - 2 * DAY);
  const rangeEnd = new Date(
    vnDayRange(Math.max(max, now.getTime()) + 2 * DAY).lt.getTime() - 1
  );

  const critical = items.filter((i) => i.isCritical);

  return {
    items,
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    totalDays: Math.max(
      1,
      Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / DAY)
    ),
    criticalCount: critical.length,
    criticalDurationDays: critical.reduce((s, i) => s + i.durationDays, 0),
    cycleDetected,
    cycleTaskIds,
  };
}

/**
 * Kiểm tra thêm một quan hệ phụ thuộc có tạo ra vòng lặp không.
 * Chặn từ lúc thêm còn hơn để lọt rồi cả biểu đồ hỏng.
 */
export function wouldCreateCycle(
  edges: { taskId: string; dependsOnId: string }[],
  newTaskId: string,
  newDependsOnId: string
): boolean {
  if (newTaskId === newDependsOnId) return true;

  // Đi từ newDependsOnId ngược lên các việc mà nó phụ thuộc.
  // Nếu chạm lại newTaskId thì thêm cạnh này sẽ khép thành vòng.
  const predMap = new Map<string, string[]>();
  for (const e of edges) {
    const list = predMap.get(e.taskId) ?? [];
    list.push(e.dependsOnId);
    predMap.set(e.taskId, list);
  }

  const seen = new Set<string>();
  const stack = [newDependsOnId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === newTaskId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const p of predMap.get(cur) ?? []) stack.push(p);
  }
  return false;
}
