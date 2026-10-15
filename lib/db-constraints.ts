import {
  CROSS_DEPT_REQUEST_STATUSES,
  KPI_STATUSES,
  LEAVE_STATUSES,
  PERIOD_STATUSES,
  ROLES,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "./constants";
import { PRODUCTION_ROLES, SHIFT_STATUSES, SHIFT_TYPES } from "./production/constants";

/**
 * Các cột "liệt kê" được database tự chặn bằng CHECK constraint (migration
 * 20261016090000_money_int_and_checks). Danh sách giá trị lấy THẲNG từ hằng số
 * trong code — tests/db-constraints.test.ts so khớp với file migration, nên
 * thêm giá trị mới vào hằng số mà quên migration thì CI đỏ ngay.
 *
 * Thêm giá trị mới: sửa hằng số + tạo migration DROP/ADD lại constraint tương ứng.
 */
export const DB_CHECK_CONSTRAINTS = [
  { table: "users", column: "role", values: ROLES, nullable: false },
  { table: "users", column: "productionRole", values: PRODUCTION_ROLES, nullable: true },
  { table: "tasks", column: "status", values: TASK_STATUSES, nullable: false },
  { table: "tasks", column: "priority", values: TASK_PRIORITIES, nullable: false },
  { table: "kpi_periods", column: "status", values: PERIOD_STATUSES, nullable: false },
  { table: "kpi_results", column: "status", values: KPI_STATUSES, nullable: false },
  { table: "leave_requests", column: "status", values: LEAVE_STATUSES, nullable: false },
  {
    table: "cross_dept_requests",
    column: "status",
    values: CROSS_DEPT_REQUEST_STATUSES,
    nullable: false,
  },
  {
    table: "production_shift_logs",
    column: "status",
    values: SHIFT_STATUSES,
    nullable: false,
  },
  {
    table: "production_shift_logs",
    column: "shiftType",
    values: SHIFT_TYPES,
    nullable: false,
  },
] as const;

export function checkConstraintName(table: string, column: string) {
  return `${table}_${column}_check`;
}
