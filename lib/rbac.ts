import { ALLOW_CROSS_DEPT_ASSIGN, ERR, type Role } from "./constants";
import type { SessionUser } from "./auth";

/**
 * Ma trận phân quyền - dịch nguyên bảng RBAC ở mục 5 của tài liệu thiết kế.
 * R = xem, W = xem + sửa, X = không có quyền.
 */
export const PERMISSIONS = {
  "task.view.own": ["EMPLOYEE", "MANAGER", "CEO", "ADMIN"],
  "task.view.department": ["MANAGER", "CEO"],
  "task.view.all": ["CEO"],
  "task.assign.department": ["MANAGER", "CEO"],
  "task.assign.company": ["CEO"],
  "dashboard.department": ["MANAGER", "CEO"],
  "dashboard.executive": ["CEO"],
  "kpi.self_review": ["EMPLOYEE", "MANAGER", "CEO"],
  "kpi.manager_review": ["MANAGER", "CEO"],
  "kpi.ceo_approve": ["CEO"],
  "kpi.edit_after_lock": ["CEO"],
  "kpi.period.manage": ["CEO", "ADMIN"],
  "kpi.definition.manage": ["CEO", "ADMIN"],
  "kpi.target.assign": ["MANAGER", "CEO", "ADMIN"],
  "kpi.import": ["MANAGER", "CEO", "ADMIN"],
  "kpi.export": ["MANAGER", "CEO", "ADMIN"],
  "admin.users": ["ADMIN"],
  "admin.departments": ["ADMIN"],
  "audit.view": ["CEO", "ADMIN"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(user: { role: string } | null, perm: Permission): boolean {
  if (!user) return false;
  return (PERMISSIONS[perm] as readonly string[]).includes(user.role);
}

/** Lỗi nghiệp vụ có mã - route handler bắt lại và trả JSON đúng chuẩn. */
export class BusinessError extends Error {
  code: string;
  statusCode: number;
  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function assertPermission(
  user: SessionUser | null,
  perm: Permission,
  message?: string
) {
  if (!user) {
    throw new BusinessError(ERR.UNAUTHENTICATED, "Bạn chưa đăng nhập.", 401);
  }
  if (!can(user, perm)) {
    throw new BusinessError(
      ERR.FORBIDDEN,
      message ?? "Bạn không có quyền thực hiện thao tác này.",
      403
    );
  }
}

/**
 * QUY TẮC CEO ĐÃ CHỐT (câu 4): cấm giao việc vượt cấp.
 *
 * - CEO: giao được toàn công ty.
 * - ADMIN: không được giao việc (chỉ quản trị hệ thống).
 * - MANAGER: chỉ giao cho người CÙNG department_id.
 * - EMPLOYEE: không được giao việc cho người khác.
 *
 * Muốn giao liên phòng ban thì phải đi đường Cross-Dept Request để trưởng phòng
 * bên kia tiếp nhận và tự phân công.
 */
export function assertCanAssignTask(
  actor: SessionUser,
  targetDepartmentId: string,
  assigneeDepartmentId: string | null
) {
  if (actor.role === "CEO") return;

  if (actor.role === "ADMIN") {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Quản trị hệ thống không có quyền giao việc. Vui lòng dùng tài khoản nghiệp vụ.",
      403
    );
  }

  if (actor.role === "EMPLOYEE") {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Nhân viên không có quyền giao việc cho người khác.",
      403
    );
  }

  // MANAGER
  if (!ALLOW_CROSS_DEPT_ASSIGN) {
    if (targetDepartmentId !== actor.departmentId) {
      throw new BusinessError(
        ERR.CROSS_DEPT_ASSIGNMENT_FORBIDDEN,
        "Trưởng phòng không được phép giao việc trực tiếp cho phòng ban khác. Hãy gửi Yêu cầu liên phòng ban để trưởng phòng bên đó tiếp nhận và phân công.",
        403
      );
    }
    if (assigneeDepartmentId && assigneeDepartmentId !== actor.departmentId) {
      throw new BusinessError(
        ERR.CROSS_DEPT_ASSIGNMENT_FORBIDDEN,
        "Người được giao việc không thuộc phòng ban của bạn. Hãy gửi Yêu cầu liên phòng ban.",
        403
      );
    }
  }
}

/**
 * Điều kiện lọc dữ liệu theo tầm nhìn của từng vai trò.
 * Trả về mảnh `where` để nhét thẳng vào Prisma query.
 */
export function taskScopeWhere(user: SessionUser) {
  switch (user.role) {
    case "CEO":
    case "ADMIN":
      return {};
    case "MANAGER":
      return { departmentId: user.departmentId ?? "__none__" };
    default:
      // Nhân viên chỉ thấy việc mình được giao hoặc mình tạo
      return {
        OR: [{ assigneeId: user.id }, { creatorId: user.id }],
      };
  }
}

export function kpiScopeWhere(user: SessionUser) {
  switch (user.role) {
    case "CEO":
    case "ADMIN":
      return {};
    case "MANAGER":
      return {
        employee: { departmentId: user.departmentId ?? "__none__" },
      };
    default:
      return { employeeId: user.id };
  }
}
