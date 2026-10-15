import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Chốt KPI của Ban Giám đốc: MỘT giao dịch, ghi theo tập (updateMany /
 * createMany) — không còn 4–5 lệnh rời cho mỗi dòng. Prisma được giả lập để
 * đếm đúng các lệnh đi vào giao dịch.
 */
const h = vi.hoisted(() => {
  const state = {
    rows: [] as Record<string, unknown>[],
    mismatches: [] as { periodId: string; employeeId: string; kpiDefinitionId: string }[],
    claimCount: null as number | null,
    claimedIds: [] as string[],
    remaining: 0,
  };
  const tx = {
    kpiResult: {
      updateMany: vi.fn(async (args: { where: { id: { in: string[] } } }) => ({
        count: state.claimCount ?? args.where.id.in.length,
      })),
      findMany: vi.fn(async () => state.claimedIds.map((id) => ({ id }))),
      update: vi.fn(async () => ({})),
      count: vi.fn(async () => state.remaining),
    },
    kpiReview: { createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })) },
    auditLog: {
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
      create: vi.fn(async (_args: { data: Record<string, unknown> }) => ({})),
    },
    kpiPeriod: { updateMany: vi.fn(async (_args: unknown) => ({ count: 1 })) },
  };
  const prisma = {
    kpiResult: { findMany: vi.fn(async () => state.rows) },
    reconciliation: { findMany: vi.fn(async () => state.mismatches) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { state, tx, prisma };
});

vi.mock("@/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/lib/telegram", () => ({
  notify: vi.fn(async () => {}),
  sendCeoAlert: vi.fn(async () => {}),
}));

import { ceoApprove, planCeoApproval } from "@/lib/services/kpi-service";

const actor = {
  id: "ceo",
  email: "ceo@gani.vn",
  fullName: "CEO",
  role: "CEO" as const,
  departmentId: null,
  departmentName: null,
};

const def = { code: "REVENUE", isHigherBetter: true, department: { code: "OPS" } };

/** Dòng đã qua trưởng phòng, số dẫn xuất khớp dữ liệu (90/100, trọng số 50). */
function row(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    periodId: "p1",
    employeeId: `emp-${id}`,
    kpiDefinitionId: "d1",
    status: "MANAGER_REVIEWED",
    targetValue: 100,
    weightPercent: 50,
    actualSystem: null,
    actualSelf: 90,
    actualFinal: 90,
    achievementPercent: 90,
    weightedScore: 45,
    isCapped: false,
    hasMismatch: false,
    mismatchPercent: null,
    kpiDefinition: def,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.rows = [];
  h.state.mismatches = [];
  h.state.claimCount = null;
  h.state.claimedIds = [];
  h.state.remaining = 0;
});

describe("planCeoApproval — phần thuần", () => {
  it("bỏ qua dòng chưa qua trưởng phòng và dòng còn lệch số, im lặng với dòng đã khoá", () => {
    const plan = planCeoApproval(
      [
        row("a"),
        row("b", { status: "SELF_REVIEWED" }),
        row("c", { employeeId: "emp-x" }),
        row("d", { status: "FINALIZED" }),
      ],
      new Set(["p1:emp-x:d1"])
    );
    expect(plan.eligible.map((e) => e.id)).toEqual(["a"]);
    expect(plan.skipped).toEqual([
      { id: "b", reason: "Chưa qua bước trưởng phòng duyệt" },
      { id: "c", reason: "Còn lệch số chưa chốt — chốt ở trang Đối soát trước" },
    ]);
  });

  it("số chốt trống thì lấy số tự khai; không có số nào thì để trống, không quy về 0", () => {
    const plan = planCeoApproval(
      [
        row("a", { actualFinal: null, actualSelf: 120 }),
        row("b", { actualFinal: null, actualSelf: null, achievementPercent: 0, weightedScore: 0 }),
      ],
      new Set()
    );
    expect(plan.eligible[0].fillActualFinal).toBe(120);
    expect(plan.eligible[0].derived.weightedScore).toBe(60);
    expect(plan.eligible[0].derivedChanged).toBe(true);
    expect(plan.eligible[1].actualFinal).toBeNull();
    expect(plan.eligible[1].fillActualFinal).toBeNull();
    expect(plan.eligible[1].derivedChanged).toBe(false);
  });

  it("gatekeeper trả hàng: không bao giờ chạm trần; vượt ngưỡng trừ thẳng 5 điểm", () => {
    const gate = { code: "SALES_RETURN", isHigherBetter: false, department: { code: "SALES" } };
    const base = { kpiDefinition: gate, weightPercent: 0, targetValue: 2 };
    const plan = planCeoApproval(
      [
        row("ok", { ...base, actualFinal: 0, actualSelf: 0 }),
        row("bad", { ...base, actualFinal: 3, actualSelf: 3 }),
      ],
      new Set()
    );
    expect(plan.eligible[0].derived).toMatchObject({ isCapped: false, weightedScore: 0 });
    expect(plan.eligible[1].derived).toMatchObject({ isCapped: false, weightedScore: -5 });
  });

  it("chỉ tiêu Sales chặn ở trần 120%, phòng khác 150%", () => {
    const sales = { ...def, department: { code: "SALES" } };
    const plan = planCeoApproval(
      [
        row("s", { kpiDefinition: sales, actualFinal: 200 }),
        row("o", { actualFinal: 200 }),
      ],
      new Set()
    );
    expect(plan.eligible[0].derived).toMatchObject({ achievementPercent: 120, isCapped: true });
    expect(plan.eligible[1].derived).toMatchObject({ achievementPercent: 150, isCapped: true });
  });

  it("dòng có số dẫn xuất khớp dữ liệu thì không phải ghi lại", () => {
    const plan = planCeoApproval([row("a")], new Set());
    expect(plan.eligible[0].derivedChanged).toBe(false);
    expect(plan.eligible[0].fillActualFinal).toBeNull();
  });
});

describe("ceoApprove — một giao dịch, ghi theo tập", () => {
  it("khoá cả lô bằng MỘT updateMany, nhật ký và lịch sử bằng createMany", async () => {
    h.state.rows = [row("a"), row("b"), row("c"), row("s", { status: "DRAFT" })];
    const res = await ceoApprove(actor, ["a", "b", "c", "s"], { ceoNote: "ok" });

    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(h.tx.kpiResult.updateMany).toHaveBeenCalledTimes(1);
    expect(h.tx.kpiResult.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: { in: ["a", "b", "c"] }, status: "MANAGER_REVIEWED" },
      data: { status: "FINALIZED", ceoNote: "ok" },
    });
    expect(h.tx.kpiResult.update).not.toHaveBeenCalled();
    expect(h.tx.kpiReview.createMany).toHaveBeenCalledTimes(1);
    expect(h.tx.kpiReview.createMany.mock.calls[0][0].data).toHaveLength(3);
    expect(h.tx.auditLog.createMany).toHaveBeenCalledTimes(1);
    const audits = h.tx.auditLog.createMany.mock.calls[0][0].data as { action: string; userId: string }[];
    expect(audits).toHaveLength(3);
    expect(audits.every((a) => a.action === "KPI_CEO_APPROVE_LOCK" && a.userId === "ceo")).toBe(true);
    expect(res).toMatchObject({ finalized: 3, periodFinalized: false });
    expect(res.skipped).toEqual([{ id: "s", reason: "Chưa qua bước trưởng phòng duyệt" }]);
  });

  it("số chốt còn trống: gom theo giá trị, mỗi giá trị một lệnh", async () => {
    h.state.rows = [
      row("a", { actualFinal: null, actualSelf: 70, achievementPercent: 70, weightedScore: 35 }),
      row("b", { actualFinal: null, actualSelf: 70, achievementPercent: 70, weightedScore: 35 }),
      row("c"),
    ];
    await ceoApprove(actor, ["a", "b", "c"]);
    // 1 lệnh khoá + 1 lệnh điền số 70 cho cả a và b
    expect(h.tx.kpiResult.updateMany).toHaveBeenCalledTimes(2);
    expect(h.tx.kpiResult.updateMany.mock.calls[1][0]).toEqual({
      where: { id: { in: ["a", "b"] } },
      data: { actualFinal: 70 },
    });
  });

  it("dòng vừa bị lượt khác chốt thì báo bỏ qua, không ghi lịch sử cho nó", async () => {
    h.state.rows = [row("a"), row("b")];
    h.state.claimCount = 1;
    h.state.claimedIds = ["b"];
    const res = await ceoApprove(actor, ["a", "b"]);
    expect(res.finalized).toBe(1);
    expect(res.skipped).toEqual([{ id: "a", reason: "Đã được chốt ở lượt khác" }]);
    expect(h.tx.kpiReview.createMany.mock.calls[0][0].data).toHaveLength(1);
  });

  it("khoá kỳ trong cùng giao dịch khi không còn dòng nào chưa chốt", async () => {
    h.state.rows = [row("a")];
    const res = await ceoApprove(actor, ["a"], { finalizePeriodId: "p1" });
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(h.tx.kpiPeriod.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", status: { not: "FINALIZED" } },
      data: expect.objectContaining({ status: "FINALIZED", isLocked: true }),
    });
    expect(h.tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: "KPI_PERIOD_FINALIZE",
      entityId: "p1",
    });
    expect(res.periodFinalized).toBe(true);
  });

  it("còn dòng chưa chốt thì không khoá kỳ", async () => {
    h.state.rows = [row("a")];
    h.state.remaining = 2;
    const res = await ceoApprove(actor, ["a"], { finalizePeriodId: "p1" });
    expect(h.tx.kpiPeriod.updateMany).not.toHaveBeenCalled();
    expect(res.periodFinalized).toBe(false);
  });
});
