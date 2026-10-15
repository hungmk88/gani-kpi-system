/**
 * ★ MỌI CON SỐ CỦA KPI XƯỞNG SẢN XUẤT NẰM Ở ĐÂY ★
 *
 * Bản thiết kế anh gửi có trọng số 2 tầng (60/40) và 3 luật chống chạy chỉ tiêu,
 * nhưng KHÔNG định nghĩa Tier 1 và Tier 2 gồm những gì. Phần đó em dựng theo dữ
 * liệu mà xưởng thực sự ghi được, và để hết ở file này — sai chỗ nào anh sửa số
 * ở đây là cả hệ thống đổi theo, không phải đụng vào mã.
 *
 * Số nền lấy từ xưởng HCM01 trong Vault: nút thắt máy hút chân không 50 kg/giờ,
 * một ca 10 giờ, 6 ngày/tuần → trần 500 kg/ca.
 */

/* ------------------------------------------------------- VAI TRÒ TRONG XƯỞNG */

export const PRODUCTION_ROLES = [
  "WORKER",
  "TEAM_LEADER",
  "SUPERVISOR",
  "QC_OFFICER",
  "PRODUCTION_DIRECTOR",
] as const;
export type ProductionRole = (typeof PRODUCTION_ROLES)[number];

export const PRODUCTION_ROLE_LABEL: Record<string, string> = {
  WORKER: "Công nhân",
  TEAM_LEADER: "Tổ trưởng",
  SUPERVISOR: "Quản đốc ca",
  QC_OFFICER: "Nhân viên KCS",
  PRODUCTION_DIRECTOR: "Giám đốc Sản xuất",
};

/* ------------------------------------------------------------ CÔNG ĐOẠN */

export const PRODUCTION_STAGES = [
  "SO_CHE",
  "PHOI_TRON",
  "TAO_HINH",
  "LAM_CHIN",
  "DONG_GOI",
  "CAP_DONG",
] as const;

export const STAGE_LABEL: Record<string, string> = {
  SO_CHE: "Sơ chế",
  PHOI_TRON: "Phối trộn",
  TAO_HINH: "Tạo hình",
  LAM_CHIN: "Làm chín",
  DONG_GOI: "Đóng gói",
  CAP_DONG: "Cấp đông",
};

export const SHIFT_TYPES = ["CA_1", "CA_2", "CA_3"] as const;
export const SHIFT_TYPE_LABEL: Record<string, string> = {
  CA_1: "Ca 1",
  CA_2: "Ca 2",
  CA_3: "Ca 3",
};

/* --------------------------------------------------- TRẠNG THÁI DUYỆT CA */

export const SHIFT_STATUSES = ["DRAFT", "QC_APPROVED", "LOCKED"] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];

export const SHIFT_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Sản xuất đã khai — chờ KCS",
  QC_APPROVED: "KCS đã xác nhận — chờ Ban Giám đốc khoá",
  LOCKED: "Đã khoá số",
};

/* ============================================================================
 * TRỌNG SỐ 2 TẦNG — theo đúng bản thiết kế
 * ========================================================================== */

export const TIER1_WEIGHT = 0.6; // cá nhân / công đoạn
export const TIER2_WEIGHT = 0.4; // toàn xưởng

/**
 * TẦNG 2 — kết quả chung của cả ca. Mọi người trong ca cùng hưởng, cùng chịu.
 * Bốn thành phần cộng lại đúng 100.
 */
export const TIER2_COMPONENTS = {
  /** Thành phẩm đạt QC so với chỉ tiêu sản lượng của ca */
  OUTPUT: 35,
  /** Định mức NVL: dùng ít hơn định mức thì được điểm cao */
  MATERIAL: 25,
  /** Phế phẩm và hàng phải làm lại */
  QUALITY: 25,
  /** An toàn thực phẩm — vi phạm HACCP */
  SAFETY: 15,
} as const;

/**
 * TẦNG 1 — phần của riêng từng người.
 *
 * Lưu ý quan trọng: KHÔNG dùng "năng suất cá nhân" ở tầng này. Xưởng chỉ cân
 * được sản lượng của cả ca, chia sản lượng đó cho giờ công thì ai cũng ra một
 * con số như nhau — không phân biệt được ai làm tốt. Ba thành phần dưới đây là
 * những thứ xưởng thực sự ghi riêng được cho từng người.
 */
export const TIER1_COMPONENTS = {
  /** Lỗi phát sinh ở công đoạn của người đó, do KCS ghi nhận */
  STAGE_QUALITY: 50,
  /** Giờ công thực tế so với giờ công đăng ký */
  ATTENDANCE: 25,
  /** Vi phạm nội quy và HACCP cá nhân */
  DISCIPLINE: 25,
} as const;

/** Trần điểm, dùng chung với KPI tháng cho nhất quán. */
export const PRODUCTION_SCORE_CAP = 150;

/** Mỗi vi phạm cá nhân trừ bao nhiêu điểm ở phần kỷ luật. */
export const DISCIPLINE_PENALTY_PER_VIOLATION = 34;

/** Mỗi vi phạm HACCP của cả ca trừ bao nhiêu điểm ở phần an toàn. */
export const SAFETY_PENALTY_PER_VIOLATION = 50;

/**
 * Tỷ lệ lỗi công đoạn tương ứng 0 điểm.
 * Lỗi 5% khối lượng quy cho người đó là mất sạch điểm chất lượng công đoạn.
 */
export const STAGE_DEFECT_ZERO_AT_PERCENT = 5;

/**
 * Tỷ lệ phế + làm lại tương ứng 0 điểm ở tầng 2.
 * Hỏng 10% sản lượng thô là mất sạch điểm chất lượng của ca.
 */
export const SHIFT_QUALITY_ZERO_AT_PERCENT = 10;

/* ============================================================================
 * KPI ĐA TẦNG CHO THỬ VIỆC / THỜI VỤ
 * ========================================================================== */

export const EMPLOYMENT_TYPES = ["OFFICIAL", "PROBATION", "SEASONAL"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  OFFICIAL: "Chính thức",
  PROBATION: "Thử việc",
  SEASONAL: "Thời vụ",
};

/**
 * Trọng số 2 tầng riêng cho thử việc/thời vụ (chốt 10/09/2026, anh duyệt số
 * 80/20 làm ví dụ khi chọn hướng xử lý).
 *
 * Tầng 2 (kết quả chung cả ca — có cả Sản lượng, tức nhịp độ dây chuyền) không
 * tách được theo từng người, nên không "miễn trừ" đúng nghĩa đen được. Thay
 * vào đó giảm hẳn tỷ trọng của nó xuống 20% (thay vì 40%), tăng Tầng 1 (đo
 * đúng phần việc cá nhân) lên 80% — người mới bị ảnh hưởng bởi tốc độ chung
 * của cả ca ít hơn hẳn.
 */
export const PROBATION_TIER_WEIGHTS = {
  TIER1: 0.8,
  TIER2: 0.2,
} as const;

/**
 * Trong Tầng 1 của thử việc/thời vụ, tăng trọng số "Kỷ luật & an toàn cá
 * nhân" (đúng yêu cầu gốc: an toàn thực phẩm/HACCP quan trọng hơn tốc độ với
 * người chưa quen việc), giảm Chất lượng công đoạn tương ứng — tổng vẫn 100.
 * Chuyên cần giữ nguyên vì không liên quan tới tay nghề.
 */
export const PROBATION_TIER1_COMPONENTS = {
  STAGE_QUALITY: 35,
  ATTENDANCE: 25,
  DISCIPLINE: 40,
} as const;

/* ============================================================================
 * LUẬT CHỐNG CHẠY CHỈ TIÊU — theo đúng 3 luật trong bản thiết kế
 * ========================================================================== */

export const ANTI_GAMING = {
  /**
   * Luật 1: đạt sản lượng nhưng NVL vượt định mức quá ngưỡng này.
   * Dấu hiệu ép máy chạy cho đủ số, đổi lại phá nguyên liệu.
   */
  MATERIAL_OVERRUN_PERCENT: 8,

  /**
   * Luật 2: báo phế phẩm bằng 0 nhưng khối lượng làm lại vượt ngưỡng này.
   * Dấu hiệu đẩy hàng hỏng sang mục "làm lại" cho đỡ xấu số.
   */
  REWORK_SUSPICIOUS_PERCENT: 4,

  /**
   * Luật 3: sản lượng thô lệch so với tổng (đạt + làm lại + phế) quá ngưỡng.
   *
   * Bản thiết kế để 5 kg tuyệt đối. Giữ nguyên vì hợp với quy mô xưởng HCM01
   * (trần 500 kg/ca → 5 kg là 1%), nhưng thêm ngưỡng tương đối để khi xưởng
   * chạy mẻ nhỏ 50 kg thì lệch 4 kg vẫn bị bắt.
   */
  MASS_BALANCE_ABS_KG: 5,
  MASS_BALANCE_REL_PERCENT: 2,
} as const;

export const BEHAVIOR_LABEL: Record<string, string> = {
  PRODUCTIVITY_VS_MATERIAL_LOSS: "Chạy sản lượng, phá nguyên liệu",
  REWORK_HIDING_SCRAP: "Nghi giấu phế phẩm sang mục làm lại",
  MASS_BALANCE_MISMATCH: "Lệch cân đối khối lượng",
};

export const AUDIT_STATUS_LABEL: Record<string, string> = {
  PENDING_EXPLANATION: "Chờ quản đốc giải trình",
  EXPLAINED: "Đã giải trình — chờ Ban Giám đốc",
  CEO_APPROVED: "BGĐ chấp nhận — đã mở khoá thưởng",
  REJECTED: "BGĐ từ chối — giữ khoá thưởng",
};

/* ============================================================================
 * THƯỞNG
 * ========================================================================== */

/**
 * Bậc thang hệ số thưởng theo điểm cuối cùng — chốt 15/10/2026 (phương án A).
 *
 * Ngưỡng đặt theo dải điểm THỰC TẾ của công thức 2 tầng: điểm cuối tối đa của
 * người chính thức là 0,6 × 100 + 0,4 × 130 = 112, của thử việc/thời vụ là
 * 0,8 × 100 + 0,2 × 130 = 106. Bản cũ để bậc 1,5× ở ≥ 120 nên không ai chạm
 * được. Giờ người chính thức làm xuất sắc đạt được 1,5×; thử việc/thời vụ tối
 * đa 1,2×. tests/bonus-tiers.test.ts giữ cho điều này luôn đúng khi đổi trọng số.
 */
export const BONUS_TIERS = [
  { minScore: 110, multiplier: 1.5 },
  { minScore: 105, multiplier: 1.2 },
  { minScore: 100, multiplier: 1.0 },
  { minScore: 90, multiplier: 0.7 },
  { minScore: 0, multiplier: 0 },
] as const;

/** Tiền thưởng nền cho một ca đạt 100 điểm (VNĐ). Đặt 0 là tắt phần thưởng. */
export const BASE_BONUS_PER_SHIFT_VND = 0;

/* ============================================================================
 * QUY ĐỔI TỔN THẤT
 * ========================================================================== */

/**
 * Hàng làm lại tính bao nhiêu phần trăm tổn thất so với phế phẩm.
 * Bản thiết kế để 0.3 — làm lại vẫn cứu được hàng, chỉ mất công và điện.
 */
export const REWORK_LOSS_FACTOR = 0.3;

/* ============================================================================
 * CẦU NỐI SANG KPI THÁNG
 * ========================================================================== */

/**
 * Tên nguồn tự động (sourceCode) khi số liệu ca sản xuất được đẩy sang KPI tháng.
 * Cuối mỗi lượt chạy nền, hệ thống gộp các ca đã khoá trong tháng rồi đẩy vào
 * cột "Số hệ thống" của các chỉ tiêu PROD_* — đi qua đúng bộ đối soát Phase 3.
 * Cách tính từng chỉ tiêu nằm ở lib/production/bridge.ts.
 */
export const PRODUCTION_FEED_SOURCE = "production";
