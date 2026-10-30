/**
 * QUẢN TRỊ NGOẠI LỆ cho bảng KPI ~50 người: ai cần nhìn trước nổi lên đầu,
 * bộ lọc nhanh đếm sẵn từng loại. Thuần (không React, không DB) để test được.
 *
 * Thứ tự ưu tiên: lệch số → chờ tôi xử lý → chạm trần → dưới 70 → còn lại.
 * Lệch số (ô đối soát MISMATCH chưa chốt) đứng đầu vì nó chặn chốt kỳ; "chờ tôi" là việc của chính người
 * đang xem; chạm trần / dưới 70 là tín hiệu cần để mắt, không chặn gì.
 */

export type ExceptionRow = {
  status: string;
  /**
   * Cờ "lệch" giữa số tự khai và số hệ thống trên chính dòng KPI — CHỈ để
   * hiển thị ghi chú, không chặn gì.
   */
  hasMismatch: boolean;
  /**
   * Ô đang có bản đối soát MISMATCH chưa ai chốt — đây mới là thứ máy chủ
   * dùng để chặn chốt (ceoApprove bỏ qua dòng này). Mọi cờ "lệch số / bị bỏ
   * qua / chờ tôi" phải theo cờ này để màn hình nói đúng như máy chủ làm.
   */
  reconMismatch: boolean;
  isCapped: boolean;
  /** Gatekeeper không có mức đạt → không bao giờ tính là "chạm trần" */
  isGatekeeper: boolean;
};

export type ExceptionGroup = {
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  /** Mã NV (null = chưa có) */
  employeeCode?: string | null;
  employeeRole: string;
  jobTitle: string;
  departmentName: string;
  rows: ExceptionRow[];
  summary: { totalScore: number };
};

export type Viewer = {
  userId: string;
  role: string;
  selfOpen: boolean;
  managerOpen: boolean;
};

/**
 * Dòng này có đang chờ CHÍNH người xem bấm gì không — khớp điều kiện hiện ô
 * nhập ở RowEditor (canSelf / canManager), chỉ tính phần "đang đợi":
 * - của mình, còn hạn tự khai, chưa khai;
 * - trưởng phòng: dòng nhân viên đã khai, còn hạn duyệt;
 * - Ban Giám đốc: dòng đã qua trưởng phòng (sẵn sàng khoá), và dòng trưởng
 *   phòng tự khai (KPI của trưởng phòng do BGĐ duyệt).
 */
export function rowNeedsViewer(
  row: ExceptionRow,
  group: Pick<ExceptionGroup, "employeeId" | "employeeRole">,
  viewer: Viewer
) {
  if (row.status === "FINALIZED") return false;
  const isMine = group.employeeId === viewer.userId;
  if (isMine) return viewer.selfOpen && row.status === "DRAFT";
  if (viewer.role === "CEO") {
    // Dòng còn lệch số (đối soát chưa chốt) thì BGĐ chưa khoá được — nó nằm
    // ở nhóm "lệch số"
    if (row.status === "MANAGER_REVIEWED") return !row.reconMismatch;
    return row.status === "SELF_REVIEWED" && group.employeeRole === "MANAGER";
  }
  if (viewer.role === "MANAGER") {
    // KPI của trưởng phòng khác (kể cả cùng phòng) do Ban Giám đốc duyệt
    if (group.employeeRole === "MANAGER" || group.employeeRole === "ADMIN") return false;
    return viewer.managerOpen && row.status === "SELF_REVIEWED";
  }
  return false;
}

export type GroupFlags = {
  mismatch: number;
  needsMe: number;
  capped: number;
  below70: boolean;
  draft: number;
};

export function groupFlags(
  group: ExceptionGroup,
  viewer: Viewer,
  scoreState: "UNSCORED" | "PROVISIONAL" | "FINAL"
): GroupFlags {
  const draft = group.rows.filter((r) => r.status === "DRAFT").length;
  return {
    mismatch: group.rows.filter((r) => r.reconMismatch && r.status !== "FINALIZED").length,
    needsMe: group.rows.filter((r) => rowNeedsViewer(r, group, viewer)).length,
    capped: group.rows.filter((r) => r.isCapped && !r.isGatekeeper).length,
    // Chỉ xét "dưới 70" khi đã có đủ số (không còn dòng chưa khai) — đang
    // khai dở thì điểm tạm tính thấp là đương nhiên, báo ra là báo động giả.
    below70: scoreState !== "UNSCORED" && draft === 0 && group.summary.totalScore < 70,
    draft,
  };
}

export function exceptionRank(f: GroupFlags) {
  if (f.mismatch > 0) return 0;
  if (f.needsMe > 0) return 1;
  if (f.capped > 0) return 2;
  if (f.below70) return 3;
  return 4;
}

/** Sắp theo mức ngoại lệ; cùng mức giữ nguyên thứ tự vào (tên A→Z). */
export function sortByException<T>(items: T[], rankOf: (t: T) => number): T[] {
  return items
    .map((item, i) => ({ item, i, rank: rankOf(item) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.item);
}

export const FILTERS = [
  { key: "all", label: "Tất cả" },
  { key: "mine", label: "Cần tôi xử lý" },
  { key: "mismatch", label: "Lệch số" },
  { key: "capped", label: "Chạm trần" },
  { key: "below70", label: "Dưới 70" },
  { key: "draft", label: "Chưa khai" },
] as const;

export type FilterKey = (typeof FILTERS)[number]["key"];

export function matchesFilter(f: GroupFlags, key: FilterKey) {
  switch (key) {
    case "all":
      return true;
    case "mine":
      return f.needsMe > 0;
    case "mismatch":
      return f.mismatch > 0;
    case "capped":
      return f.capped > 0;
    case "below70":
      return f.below70;
    case "draft":
      return f.draft > 0;
  }
}

/** Bỏ dấu tiếng Việt + chữ thường: gõ "nguyen van a" vẫn ra "Nguyễn Văn A". */
export function foldVn(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

/** Tìm theo tên, mã NV, email, chức danh, phòng ban (không phân biệt dấu). */
export function matchesSearch(
  g: Pick<
    ExceptionGroup,
    "employeeName" | "employeeEmail" | "employeeCode" | "jobTitle" | "departmentName"
  >,
  query: string
) {
  const q = foldVn(query);
  if (!q) return true;
  return foldVn(
    `${g.employeeName} ${g.employeeCode ?? ""} ${g.employeeEmail} ${g.jobTitle} ${g.departmentName}`
  ).includes(q);
}

/**
 * Nhóm mở sẵn khi vào trang: những người đang chờ chính mình xử lý (tối đa
 * `limit` người — mở cả 40 bảng một lúc thì lại thành khó đọc). Không ai chờ
 * thì mở người lệch số đầu tiên, rồi tới bảng của chính mình, rồi người đầu.
 */
export function initialOpen(
  sorted: { employeeId: string; flags: GroupFlags }[],
  viewerId: string,
  limit = 5
): string[] {
  const needs = sorted.filter((g) => g.flags.needsMe > 0).slice(0, limit);
  if (needs.length > 0) return needs.map((g) => g.employeeId);
  const fallback =
    sorted.find((g) => g.flags.mismatch > 0) ??
    sorted.find((g) => g.employeeId === viewerId) ??
    sorted[0];
  return fallback ? [fallback.employeeId] : [];
}
