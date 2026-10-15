import { describe, expect, it } from "vitest";
import { buildGantt, wouldCreateCycle, type GanttTaskInput } from "@/lib/gantt";

const DAY = 86_400_000;
const T0 = new Date("2026-10-01T02:00:00.000Z");

function task(id: string, startDay: number, durationDays: number): GanttTaskInput {
  return {
    id,
    code: id,
    title: `Việc ${id}`,
    status: "IN_PROGRESS",
    priority: "MEDIUM",
    progress: 0,
    riskScore: 0,
    startDate: new Date(T0.getTime() + startDay * DAY),
    dueDate: new Date(T0.getTime() + (startDay + durationDays) * DAY),
    createdAt: T0,
    assigneeName: null,
    departmentName: "SX",
  };
}

const dep = (taskId: string, dependsOnId: string) => ({ taskId, dependsOnId });
const byId = (r: ReturnType<typeof buildGantt>) =>
  Object.fromEntries(r.items.map((i) => [i.id, i]));

describe("Gantt — đường găng", () => {
  //   A(2) ─┬─ B(3) ─┬─ D(1)
  //         └─ C(1) ─┘
  //   E(6) đứng một mình
  const tasks = [task("A", 0, 2), task("B", 2, 3), task("C", 2, 1), task("D", 5, 1), task("E", 0, 6)];
  const edges = [dep("B", "A"), dep("C", "A"), dep("D", "B"), dep("D", "C")];
  const r = buildGantt(tasks, edges, T0);
  const it_ = byId(r);

  it("chuỗi dài nhất A→B→D nằm trên đường găng, dư địa 0", () => {
    expect(r.cycleDetected).toBe(false);
    for (const id of ["A", "B", "D"]) {
      expect(it_[id].isCritical).toBe(true);
      expect(it_[id].slackDays).toBe(0);
    }
    expect(r.criticalCount).toBe(3);
    expect(r.criticalDurationDays).toBe(6);
  });

  it("nhánh ngắn C có dư địa 2 ngày, không phải đường găng", () => {
    expect(it_.C.isCritical).toBe(false);
    expect(it_.C.slackDays).toBe(2);
  });

  it("việc đứng một mình không bao giờ là đường găng dù dư địa 0", () => {
    expect(it_.E.slackDays).toBe(0);
    expect(it_.E.isCritical).toBe(false);
  });

  it("ghi lại phụ thuộc và thời lượng", () => {
    expect(it_.D.dependencies.sort()).toEqual(["B", "C"]);
    expect(it_.B.durationDays).toBe(3);
  });

  it("bỏ qua quan hệ trỏ ra ngoài tập đang xem", () => {
    const r2 = buildGantt([task("A", 0, 2)], [dep("A", "ZZZ")], T0);
    expect(r2.items[0].dependencies).toEqual([]);
    expect(r2.cycleDetected).toBe(false);
  });

  it("việc quá hạn chưa xong được đánh dấu", () => {
    const r3 = buildGantt([task("A", 0, 2)], [], new Date(T0.getTime() + 10 * DAY));
    expect(r3.items[0].isOverdue).toBe(true);
  });
});

describe("Gantt — vòng lặp phụ thuộc", () => {
  it("phát hiện vòng lặp, báo đúng việc trong vòng, tắt đường găng", () => {
    const tasks = [task("X", 0, 1), task("Y", 1, 1), task("Z", 0, 3)];
    const r = buildGantt(tasks, [dep("X", "Y"), dep("Y", "X")], T0);
    expect(r.cycleDetected).toBe(true);
    expect(r.cycleTaskIds.sort()).toEqual(["X", "Y"]);
    expect(r.items.every((i) => !i.isCritical)).toBe(true);
    expect(r.criticalCount).toBe(0);
  });

  it("vòng lặp dài hơn cũng bị bắt, việc phía sau vòng cũng không tính được", () => {
    const tasks = [task("A", 0, 1), task("B", 0, 1), task("C", 0, 1), task("D", 0, 1)];
    const r = buildGantt(tasks, [dep("B", "A"), dep("C", "B"), dep("A", "C"), dep("D", "C")], T0);
    expect(r.cycleDetected).toBe(true);
    expect(r.cycleTaskIds.sort()).toEqual(["A", "B", "C", "D"]);
  });
});

describe("wouldCreateCycle", () => {
  const edges = [dep("B", "A"), dep("C", "B")]; // A → B → C

  it("tự phụ thuộc chính mình là vòng lặp", () => {
    expect(wouldCreateCycle([], "A", "A")).toBe(true);
  });

  it("đảo chiều trực tiếp tạo vòng", () => {
    expect(wouldCreateCycle(edges, "A", "B")).toBe(true);
  });

  it("đảo chiều bắc cầu tạo vòng", () => {
    expect(wouldCreateCycle(edges, "A", "C")).toBe(true);
  });

  it("thêm cạnh xuôi chiều hoặc việc mới không tạo vòng", () => {
    expect(wouldCreateCycle(edges, "C", "A")).toBe(false);
    expect(wouldCreateCycle(edges, "D", "C")).toBe(false);
  });
});
