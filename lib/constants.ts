/**
 * Hằng số nghiệp vụ toàn hệ thống.
 * Mọi quy tắc CEO đã chốt ở Phase 0 đều nằm ở đây - sửa 1 chỗ, áp dụng toàn hệ thống.
 */

// ----------------------- QUYẾT ĐỊNH CỦA CEO (PHASE 0) -----------------------

/** Câu 1: thang điểm 100, cho phép vượt chỉ tiêu nhưng CAP ở 150%. */
export const KPI_SCORE_CAP = 150;

/** Câu 3: lịch chốt KPI 2-4-5 hàng tháng. */
export const KPI_DEADLINE_DAYS = {
  SELF_REVIEW: 2, // 23:59:59 ngày 2 - khoá quyền sửa của nhân viên
  MANAGER_REVIEW: 4, // 23:59:59 ngày 4 - khoá quyền sửa của trưởng phòng
  CEO_APPROVAL: 5, // ngày 5 - CEO duyệt & khoá vĩnh viễn
} as const;

/** Câu 4: KHÔNG cho phép giao task vượt cấp sang phòng ban khác. */
export const ALLOW_CROSS_DEPT_ASSIGN = false;

/** Ngưỡng lệch giữa số hệ thống và số nhân viên tự khai -> cảnh báo Data Mismatch. */
export const DATA_MISMATCH_THRESHOLD_PERCENT = 5;

/** Task bị BLOCKED quá số giờ này thì bị đẩy vào Exception Panel của CEO. */
export const BLOCKED_ALERT_HOURS = 24;

// ----------------------- ENUM (SQLite lưu dạng String) -----------------------

export const ROLES = ["EMPLOYEE", "MANAGER", "CEO", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

export const TASK_STATUSES = [
  "BACKLOG",
  "TO_DO",
  "IN_PROGRESS",
  "BLOCKED",
  "REVIEW",
  "DONE",
  "CANCELLED",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const KPI_STATUSES = [
  "DRAFT",
  "SELF_REVIEWED",
  "MANAGER_REVIEWED",
  "FINALIZED",
] as const;
export type KpiStatus = (typeof KPI_STATUSES)[number];

export const PERIOD_STATUSES = [
  "OPEN",
  "SELF_LOCKED",
  "MANAGER_LOCKED",
  "FINALIZED",
] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

export const DATA_SOURCES = ["MANUAL", "EXCEL", "IPOS_API"] as const;

/** Nguồn số liệu của KpiConfig (6 chỉ tiêu KPI sản xuất) — enum riêng, khác DATA_SOURCES ở trên. */
export const KPI_CONFIG_DATA_SOURCES = [
  "MANUAL",
  "IPOS",
  "QA_CHECK",
  "SYSTEM_CALC",
] as const;

export const KPI_CONFIG_DATA_SOURCE_LABEL: Record<string, string> = {
  MANUAL: "Nhập tay",
  IPOS: "iPOS",
  QA_CHECK: "KCS kiểm tra",
  SYSTEM_CALC: "Hệ thống tự tính",
};

// ----------------------- NHÃN TIẾNG VIỆT -----------------------

export const ROLE_LABEL: Record<string, string> = {
  EMPLOYEE: "Nhân viên",
  MANAGER: "Trưởng phòng",
  CEO: "Ban Giám đốc",
  ADMIN: "Quản trị hệ thống",
};

export const TASK_STATUS_LABEL: Record<string, string> = {
  BACKLOG: "Chờ xếp",
  TO_DO: "Cần làm",
  IN_PROGRESS: "Đang làm",
  BLOCKED: "Bị chặn",
  REVIEW: "Chờ duyệt",
  DONE: "Hoàn thành",
  CANCELLED: "Đã huỷ",
};

/** Các cột hiển thị trên bảng Kanban, theo đúng thứ tự. */
export const KANBAN_COLUMNS: TaskStatus[] = [
  "TO_DO",
  "IN_PROGRESS",
  "BLOCKED",
  "REVIEW",
  "DONE",
];

export const TASK_PRIORITY_LABEL: Record<string, string> = {
  LOW: "Thấp",
  MEDIUM: "Trung bình",
  HIGH: "Cao",
  CRITICAL: "Khẩn cấp",
};

export const KPI_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Chờ nhân viên khai",
  SELF_REVIEWED: "NV đã khai - chờ TP",
  MANAGER_REVIEWED: "TP đã duyệt - chờ BGĐ",
  FINALIZED: "Đã chốt (khoá)",
};

export const PERIOD_STATUS_LABEL: Record<string, string> = {
  OPEN: "Đang mở - nhân viên tự khai",
  SELF_LOCKED: "Đã khoá NV - trưởng phòng duyệt",
  MANAGER_LOCKED: "Đã khoá TP - chờ BGĐ duyệt",
  FINALIZED: "Đã chốt toàn kỳ",
};

/**
 * Bộ KPI Sales mới (chốt 10/09/2026, xem tài liệu
 * "GANI_FOODY_Tai_lieu_truyen_thong_KPI_Doi_Sales"): chỉ tiêu
 * SALES_RETURN có defaultWeight = 0 (không cộng dương vào tổng điểm), nhưng
 * vượt ngưỡng thì TRỪ THẲNG vào %KPI tổng — đi ngoài công thức trọng số ×
 * mức đạt bình thường. Xử lý ở NƠI DUY NHẤT ghi điểm: recalcResult() trong
 * lib/services/kpi-service.ts.
 *
 * Hai cơ chế còn lại trong tài liệu (khoá thưởng KH mới theo tái mua 30 ngày,
 * khoá/giảm Commission theo GM%) CHƯA code — anh tự tính tay/Excel như hiện
 * tại, vì hệ thống chưa có bộ tính hoa hồng VNĐ cho khối văn phòng.
 */
export const SALES_DEPARTMENT_CODE = "SALES";

/**
 * Mã phòng ban Sản xuất thật trong database (seed ở `prisma/seed.mjs`) là
 * "PROD", KHÔNG PHẢI "PRODUCTION" — hai route `/api/kpi/targets` và
 * `/api/kpi/calculate` từng hardcode nhầm "PRODUCTION" nên Giám đốc Sản xuất
 * (role=MANAGER) không bao giờ khớp được điều kiện quyền, chỉ CEO/Admin gọi
 * được (phát hiện + vá 14/09/2026). Dùng hằng số này thay vì gõ tay lại.
 */
export const PRODUCTION_DEPARTMENT_CODE = "PROD";

/**
 * Hạn mức nghỉ phép năm — 12 ngày/người/năm, chốt 15/09/2026. Cố định
 * trong code, áp dụng chung cho mọi người, chưa phân biệt thâm niên/loại
 * hợp đồng. Xem `getAnnualLeaveQuota()` ở lib/services/leave-service.ts.
 */
export const ANNUAL_LEAVE_QUOTA_DAYS = 12;

/**
 * Trần nửa năm — tối đa 6 ngày mỗi nửa (Th01–Th06 / Th07–Th12), chốt
 * 15/09/2026, chống dồn hết 12 ngày phép vào nửa đầu năm.
 */
export const HALF_YEAR_LEAVE_CAP_DAYS = 6;

/** Trần mỗi chỉ tiêu Sales — 120%, khác trần 150% chung toàn công ty. */
export const SALES_KPI_CAP = 120;

export const SALES_RETURN_RATE_GATEKEEPER = {
  KPI_CODE: "SALES_RETURN",
  THRESHOLD_PERCENT: 2,
  PENALTY_POINTS: 5,
} as const;

/** Thứ tự tiến trình của 1 dòng KPI - dùng để chặn nhảy cóc trạng thái. */
export const KPI_STATUS_ORDER: Record<string, number> = {
  DRAFT: 0,
  SELF_REVIEWED: 1,
  MANAGER_REVIEWED: 2,
  FINALIZED: 3,
};

// ----------------------- MÃ LỖI NGHIỆP VỤ -----------------------

export const ERR = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  CROSS_DEPT_ASSIGNMENT_FORBIDDEN: "CROSS_DEPT_ASSIGNMENT_FORBIDDEN",
  SLA_LOCKED: "SLA_LOCKED",
  KPI_FINALIZED: "KPI_FINALIZED",
  REASON_REQUIRED: "REASON_REQUIRED",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  WEIGHT_SUM_INVALID: "WEIGHT_SUM_INVALID",
} as const;
