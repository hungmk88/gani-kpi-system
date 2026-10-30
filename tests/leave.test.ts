import { describe, expect, it } from "vitest";
import {
  allocateLeaveDays,
  canReviewLeave,
  leaveDaysBetween,
  leaveReviewerKind,
  leaveVisibleWhere,
  matchTasksToLeaves,
  pendingLeaveForReviewerWhere,
} from "@/lib/services/leave-service";
import { parseVnDate } from "@/lib/vn-time";

const d = (s: string) => parseVnDate(s);

describe("ngày phép", () => {
  it("nghỉ 1 ngày tính là 1 (trước đây ra 0)", () => {
    expect(leaveDaysBetween(d("2026-10-16"), d("2026-10-16"))).toBe(1);
    expect(leaveDaysBetween(d("2026-10-16"), d("2026-10-18"))).toBe(3);
  });

  it("đơn vắt qua hai nửa năm được tách đúng", () => {
    const a = allocateLeaveDays(d("2026-06-29"), d("2026-07-03"));
    expect(a.total).toBe(5);
    expect(a.byHalf.get("2026-H1")).toBe(2);
    expect(a.byHalf.get("2026-H2")).toBe(3);
  });

  it("đơn vắt qua năm mới được tách theo năm", () => {
    const a = allocateLeaveDays(d("2026-12-30"), d("2027-01-02"));
    expect(a.byYear.get(2026)).toBe(2);
    expect(a.byYear.get(2027)).toBe(2);
  });
});

describe("việc có hạn trong thời gian nghỉ", () => {
  const leave = (id: string, employeeId: string, a: string, b: string) => ({
    id,
    employeeId,
    startDate: d(a),
    endDate: d(b),
  });
  const task = (id: string, assigneeId: string | null, due: Date) => ({
    id,
    assigneeId,
    dueDate: due,
  });

  it("chỉ lấy việc của chính người nghỉ, hạn rơi trong khoảng nghỉ (gồm ngày cuối)", () => {
    const m = matchTasksToLeaves(
      [leave("L1", "u1", "2026-10-16", "2026-10-18")],
      [
        task("t-truoc", "u1", d("2026-10-15")),
        task("t-dau", "u1", d("2026-10-16")),
        // 17:00 ngày cuối vẫn là trong ngày nghỉ
        task("t-cuoi", "u1", new Date(d("2026-10-18").getTime() + 17 * 3600_000)),
        task("t-sau", "u1", d("2026-10-19")),
        task("t-nguoi-khac", "u2", d("2026-10-17")),
        task("t-chua-giao", null, d("2026-10-17")),
      ]
    );
    expect(m.get("L1")?.map((t) => t.id)).toEqual(["t-dau", "t-cuoi"]);
  });

  it("đơn không trùng việc nào thì không có trong kết quả", () => {
    const m = matchTasksToLeaves(
      [leave("L1", "u1", "2026-10-16", "2026-10-16"), leave("L2", "u2", "2026-10-16", "2026-10-16")],
      [task("t1", "u2", d("2026-10-16"))]
    );
    expect(m.has("L1")).toBe(false);
    expect(m.get("L2")?.length).toBe(1);
  });
});

describe("đơn nghỉ đi tới ai duyệt", () => {
  it("phòng chưa có trưởng phòng thì Ban Giám đốc duyệt — và nằm trong hộp chờ của BGĐ", () => {
    expect(leaveReviewerKind({ requesterRole: "EMPLOYEE", deptHasActiveManager: true })).toBe("MANAGER");
    expect(leaveReviewerKind({ requesterRole: "EMPLOYEE", deptHasActiveManager: false })).toBe("CEO");
    expect(leaveReviewerKind({ requesterRole: "MANAGER", deptHasActiveManager: true })).toBe("CEO");
    expect(leaveReviewerKind({ requesterRole: "ADMIN", deptHasActiveManager: true })).toBe("CEO");

    const ceoInbox = pendingLeaveForReviewerWhere({ id: "ceo", role: "CEO", departmentId: null });
    expect(ceoInbox).toMatchObject({
      status: "PENDING",
      OR: expect.arrayContaining([
        { departmentId: null },
        { department: { users: { none: { role: "MANAGER", isActive: true } } } },
      ]),
    });
    // BGĐ vẫn có QUYỀN duyệt đơn đó (canReviewLeave là luật quyền)
    expect(
      canReviewLeave(
        { id: "ceo", role: "CEO", departmentId: null },
        { employeeId: "nv", departmentId: "KHO", employee: { role: "EMPLOYEE" } }
      )
    ).toBe(true);
  });

  it("hộp chờ trưởng phòng: chỉ nhân viên thường phòng mình", () => {
    expect(pendingLeaveForReviewerWhere({ id: "tp", role: "MANAGER", departmentId: "SALES" })).toEqual({
      status: "PENDING",
      employeeId: { not: "tp" },
      departmentId: "SALES",
      employee: { role: { notIn: ["MANAGER", "ADMIN"] } },
    });
    expect(pendingLeaveForReviewerWhere({ id: "nv", role: "EMPLOYEE", departmentId: "SALES" })).toBeNull();
    expect(pendingLeaveForReviewerWhere({ id: "ad", role: "ADMIN", departmentId: null })).toBeNull();
  });

  it("Quản trị hệ thống chỉ xem đơn của chính mình (lý do nghỉ là riêng tư)", () => {
    expect(leaveVisibleWhere({ id: "ad", role: "ADMIN", departmentId: null })).toEqual({ employeeId: "ad" });
    expect(leaveVisibleWhere({ id: "ceo", role: "CEO", departmentId: null })).toEqual({});
    expect(leaveVisibleWhere({ id: "tp", role: "MANAGER", departmentId: "SALES" })).toEqual({
      OR: [
        { employeeId: "tp" },
        { departmentId: "SALES", employee: { role: { notIn: ["MANAGER", "ADMIN"] } } },
      ],
    });
  });
});
