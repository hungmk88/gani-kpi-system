import { describe, expect, it } from "vitest";
import { assertCanAssignTask, BusinessError, can } from "@/lib/rbac";
import type { SessionUser } from "@/lib/auth";
import { ERR } from "@/lib/constants";

function user(role: SessionUser["role"], departmentId: string | null = "SALES"): SessionUser {
  return {
    id: `${role}-1`,
    email: `${role.toLowerCase()}@ganifoody.vn`,
    fullName: role,
    role,
    departmentId,
    departmentName: departmentId,
  };
}

function errorOf(fn: () => void): BusinessError | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof BusinessError) return e;
    throw e;
  }
}

describe("can() — ma trận phân quyền", () => {
  it("chưa đăng nhập thì không có quyền gì", () => {
    expect(can(null, "task.view.own")).toBe(false);
  });

  it("CEO duyệt & khoá KPI, các vai trò khác thì không", () => {
    expect(can(user("CEO"), "kpi.ceo_approve")).toBe(true);
    expect(can(user("MANAGER"), "kpi.ceo_approve")).toBe(false);
    expect(can(user("ADMIN"), "kpi.ceo_approve")).toBe(false);
    expect(can(user("EMPLOYEE"), "kpi.ceo_approve")).toBe(false);
  });

  it("chỉ ADMIN quản lý tài khoản (CEO cũng không có admin.users)", () => {
    expect(can(user("ADMIN"), "admin.users")).toBe(true);
    expect(can(user("CEO"), "admin.users")).toBe(false);
    expect(can(user("MANAGER"), "admin.users")).toBe(false);
  });

  it("ADMIN không có quyền giao việc / duyệt KPI (tách quyền)", () => {
    expect(can(user("ADMIN"), "task.assign.department")).toBe(false);
    expect(can(user("ADMIN"), "kpi.manager_review")).toBe(false);
  });

  it("ADMIN không chạm vào điểm KPI: không đặt mục tiêu, không nạp số", () => {
    expect(can(user("ADMIN"), "kpi.target.assign")).toBe(false);
    expect(can(user("ADMIN"), "kpi.import")).toBe(false);
    expect(can(user("MANAGER"), "kpi.target.assign")).toBe(true);
    expect(can(user("MANAGER"), "kpi.import")).toBe(true);
    expect(can(user("CEO"), "kpi.target.assign")).toBe(true);
    expect(can(user("CEO"), "kpi.import")).toBe(true);
  });

  it("nhân viên chỉ xem việc của mình, tự đánh giá KPI", () => {
    const e = user("EMPLOYEE");
    expect(can(e, "task.view.own")).toBe(true);
    expect(can(e, "task.view.department")).toBe(false);
    expect(can(e, "kpi.self_review")).toBe(true);
    expect(can(e, "kpi.export")).toBe(false);
  });

  it("vai trò lạ không có quyền", () => {
    expect(can({ role: "HACKER" }, "task.view.own")).toBe(false);
  });
});

describe("assertCanAssignTask — cấm giao việc vượt cấp", () => {
  it("CEO giao được toàn công ty", () => {
    expect(errorOf(() => assertCanAssignTask(user("CEO", null), "SALES", "OPS"))).toBeNull();
  });

  it("ADMIN không được giao việc", () => {
    const e = errorOf(() => assertCanAssignTask(user("ADMIN"), "SALES", "SALES"));
    expect(e?.statusCode).toBe(403);
    expect(e?.code).toBe(ERR.FORBIDDEN);
  });

  it("nhân viên không được giao việc", () => {
    const e = errorOf(() => assertCanAssignTask(user("EMPLOYEE"), "SALES", "SALES"));
    expect(e?.statusCode).toBe(403);
    expect(e?.code).toBe(ERR.FORBIDDEN);
  });

  it("trưởng phòng giao trong phòng mình -> được", () => {
    expect(errorOf(() => assertCanAssignTask(user("MANAGER"), "SALES", "SALES"))).toBeNull();
  });

  it("trưởng phòng giao việc chưa có người nhận trong phòng mình -> được", () => {
    expect(errorOf(() => assertCanAssignTask(user("MANAGER"), "SALES", null))).toBeNull();
  });

  it("trưởng phòng giao sang phòng khác -> CROSS_DEPT_ASSIGNMENT_FORBIDDEN", () => {
    const e = errorOf(() => assertCanAssignTask(user("MANAGER"), "OPS", null));
    expect(e?.code).toBe(ERR.CROSS_DEPT_ASSIGNMENT_FORBIDDEN);
    expect(e?.statusCode).toBe(403);
  });

  it("việc thuộc phòng mình nhưng người nhận ở phòng khác -> chặn", () => {
    const e = errorOf(() => assertCanAssignTask(user("MANAGER"), "SALES", "OPS"));
    expect(e?.code).toBe(ERR.CROSS_DEPT_ASSIGNMENT_FORBIDDEN);
  });

  it("trưởng phòng chưa thuộc phòng ban nào không giao được cho ai", () => {
    const e = errorOf(() => assertCanAssignTask(user("MANAGER", null), "SALES", "SALES"));
    expect(e?.code).toBe(ERR.CROSS_DEPT_ASSIGNMENT_FORBIDDEN);
  });
});
