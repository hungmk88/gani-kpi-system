/**
 * ★ NGƯỠNG CỦA PHẦN PHÂN TÍCH & DỰ BÁO ★
 *
 * Nguyên tắc xuyên suốt Phase 4: **mọi kết quả phải khai nó dựa trên bao nhiêu
 * dữ liệu.** Chưa đủ nền thì nói thẳng là chưa đủ căn cứ, không đưa ra con số.
 *
 * Lý do đặt luật này: phần mềm sai không nguy hiểm bằng phần mềm sai *một cách
 * trông rất thuyết phục*. Một biểu đồ dự báo đẹp dựng trên 2 mẫu dữ liệu vẫn ra
 * số, vẫn vẽ được đường xu hướng — và Ban Giám đốc nhìn nó rồi ra quyết định
 * thật. Thà hiện "chưa đủ dữ liệu, cần thêm 4 kỳ nữa" còn hơn.
 */

/* ==================================================== MỨC ĐỘ TIN CẬY */

export const CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW", "NONE"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export const CONFIDENCE_LABEL: Record<string, string> = {
  HIGH: "Đủ căn cứ",
  MEDIUM: "Tạm đủ",
  LOW: "Mỏng, tham khảo thôi",
  NONE: "Chưa đủ dữ liệu",
};

/* ============================================ DỰ BÁO NGUY CƠ VỠ KẾ HOẠCH */

/**
 * Nhịp làm việc của một người (velocity) tính từ những việc họ đã đóng.
 * Dưới ngưỡng này thì hệ thống dùng nhịp trung tính 1.0 và ghi rõ là chưa có nền.
 */
export const VELOCITY_MIN_SAMPLES = {
  /** Dưới mức này: không tính velocity riêng, dùng 1.0 */
  NONE: 5,
  /** Từ đây trở lên: tin ở mức mỏng */
  LOW: 5,
  /** Từ đây: tạm đủ */
  MEDIUM: 12,
  /** Từ đây: đủ căn cứ */
  HIGH: 25,
} as const;

/** Nhịp làm việc bị kẹp trong khoảng này, tránh một vài ca cá biệt kéo lệch. */
export const VELOCITY_CLAMP = { MIN: 0.5, MAX: 1.5 } as const;

/**
 * Tiến độ suy ra từ trạng thái, dùng khi người phụ trách chưa kéo thanh tiến độ.
 * Bản thiết kế gốc LUÔN dùng bảng này; ở đây chỉ dùng khi không có số thật —
 * `progress` do người kéo tay là dữ liệu tốt hơn nhiều so với đoán theo trạng thái.
 */
export const STATUS_PROGRESS_FALLBACK: Record<string, number> = {
  BACKLOG: 0,
  TO_DO: 0,
  IN_PROGRESS: 0.35,
  BLOCKED: 0.35,
  REVIEW: 0.75,
  DONE: 1,
  CANCELLED: 0,
};

export const PREDICTION_PENALTY = {
  /** Chậm hơn đường thẳng thời gian quá 20% */
  SLOW_PROGRESS: 35,
  /** Điểm rủi ro vận hành đã cao sẵn */
  HIGH_RISK_SCORE: 25,
  /** Đang bị chặn */
  BLOCKED: 30,
  /** Đang chờ một việc khác đã trễ */
  LATE_BLOCKER: 20,
  /** Người phụ trách đang ôm quá nhiều việc */
  OVERLOADED_ASSIGNEE: 15,
  /** Chưa giao cho ai */
  UNASSIGNED: 25,
} as const;

export const PREDICTION_BANDS = {
  HIGH_FAILURE_BELOW: 40,
  MODERATE_BELOW: 70,
} as const;

export const RISK_CATEGORY_LABEL: Record<string, string> = {
  ON_TRACK: "Đang bám kế hoạch",
  MODERATE_RISK: "Có nguy cơ",
  HIGH_FAILURE_RISK: "Nhiều khả năng vỡ",
};

/** Chỉ dự báo cho việc còn hạn trong khoảng này — xa quá thì đoán vô nghĩa. */
export const PREDICTION_HORIZON_DAYS = 30;

/* ================================================ CÂN BẰNG TẢI NHÂN SỰ */

/** Giờ công chuẩn một tháng, theo bản thiết kế. */
export const CAPACITY_HOURS_PER_MONTH = 160;

/**
 * Giờ ước tính mặc định khi công việc chưa khai `estimatedHours`.
 * Bản thiết kế áp cứng 12 giờ cho mọi việc — không phân biệt việc khẩn cấp với
 * việc lặt vặt. Chia theo mức ưu tiên thì sát thực tế hơn mà vẫn đơn giản.
 */
export const DEFAULT_HOURS_BY_PRIORITY: Record<string, number> = {
  LOW: 4,
  MEDIUM: 12,
  HIGH: 20,
  CRITICAL: 28,
};

export const WORKLOAD_BANDS = {
  OVERLOADED_ABOVE: 115,
  UNDERUTILIZED_BELOW: 60,
} as const;

export const WORKLOAD_LABEL: Record<string, string> = {
  OVERLOADED: "Quá tải",
  OPTIMAL: "Vừa sức",
  UNDERUTILIZED: "Còn dư sức",
};

/* ============================================ PHÁT HIỆN BẤT THƯỜNG KPI */

/**
 * Số kỳ lịch sử tối thiểu cho từng mức kết luận.
 *
 * Bản thiết kế chỉ chặn ở `< 3`. Ba điểm là quá ít cho z-score: một ngoại lệ
 * duy nhất trong lịch sử đủ làm phồng độ lệch chuẩn và che mất bất thường thật,
 * hoặc ngược lại, một chùm số sát nhau làm mọi thứ trông như bất thường.
 */
export const ANOMALY_MIN_SAMPLES = {
  /** Dưới mức này: không kết luận gì cả */
  ANY: 4,
  /** Từ đây mới dám gắn mức "cảnh báo" */
  WARNING: 4,
  /** Từ đây mới dám gắn mức "nghiêm trọng" */
  CRITICAL: 6,
} as const;

/** Ngưỡng z-score theo bản thiết kế. */
export const ANOMALY_Z_THRESHOLD = 2.5;

/**
 * Ngưỡng cho thước đo bền (robust) dùng trung vị và MAD.
 * 3.5 là ngưỡng quen thuộc của phương pháp modified z-score.
 * Thước này không bị một ngoại lệ trong lịch sử kéo lệch như z-score thường.
 */
export const ANOMALY_ROBUST_THRESHOLD = 3.5;

/** Hằng số quy đổi MAD sang thang tương đương độ lệch chuẩn. */
export const MAD_SCALE = 0.6745;

/** Cao gấp ngần này lần trung vị cũng coi là bất thường, dù độ lệch chưa vượt ngưỡng. */
export const ANOMALY_RATIO_THRESHOLD = 2.5;

export const ANOMALY_SEVERITY_LABEL: Record<string, string> = {
  WATCH: "Đáng để mắt",
  WARNING: "Cảnh báo",
  CRITICAL: "Nghiêm trọng",
};

export const ANOMALY_STATUS_LABEL: Record<string, string> = {
  OPEN: "Chờ giải trình",
  EXPLAINED: "Đã giải trình — chờ Ban Giám đốc",
  ACCEPTED: "BGĐ chấp nhận giải thích",
  DISMISSED: "BGĐ bỏ qua cảnh báo",
};

/* ================================================ SỨC KHOẺ VẬN HÀNH */

/**
 * Điểm sức khoẻ vận hành do HỆ THỐNG tính, không phải AI đoán.
 *
 * Bản thiết kế để AI tự sinh `healthScore`. Đó đúng là kiểu "sai một cách thuyết
 * phục": một con số 0-100 trông như đo đạc nhưng thực ra là AI ước chừng. Ở đây
 * điểm được tính bằng công thức cố định từ dữ liệu thật; AI chỉ viết phần diễn
 * giải bằng lời.
 */
export const HEALTH_WEIGHTS = {
  /** Tỷ lệ việc đang mở mà chưa trễ */
  ON_TIME_TASKS: 30,
  /** Không có việc ở mức báo động đỏ */
  LOW_RISK: 20,
  /** Nhân sự không ai quá tải */
  BALANCED_WORKLOAD: 20,
  /** Số liệu KPI không lệch giữa các nguồn */
  DATA_INTEGRITY: 15,
  /** Không có bất thường KPI đang treo */
  NO_ANOMALY: 15,
} as const;

export const HEALTH_BANDS = [
  { min: 85, label: "Tốt", tone: "green" },
  { min: 70, label: "Ổn, có chỗ cần siết", tone: "sky" },
  { min: 55, label: "Đang có vấn đề", tone: "amber" },
  { min: 0, label: "Cần can thiệp ngay", tone: "red" },
] as const;
