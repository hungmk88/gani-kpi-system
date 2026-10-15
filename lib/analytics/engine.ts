import {
  ANOMALY_MIN_SAMPLES,
  ANOMALY_RATIO_THRESHOLD,
  ANOMALY_ROBUST_THRESHOLD,
  ANOMALY_Z_THRESHOLD,
  CAPACITY_HOURS_PER_MONTH,
  DEFAULT_HOURS_BY_PRIORITY,
  MAD_SCALE,
  PREDICTION_BANDS,
  PREDICTION_PENALTY,
  STATUS_PROGRESS_FALLBACK,
  VELOCITY_CLAMP,
  VELOCITY_MIN_SAMPLES,
  WORKLOAD_BANDS,
  HEALTH_WEIGHTS,
  type Confidence,
} from "./constants";

/**
 * LÕI TÍNH TOÁN CỦA PHẦN PHÂN TÍCH & DỰ BÁO.
 *
 * Toàn bộ file này là hàm thuần: không đọc, không ghi database. Nhờ vậy bộ kiểm
 * thử chạy thẳng vào công thức, và ai đọc cũng kiểm lại được bằng máy tính.
 *
 * Mọi hàm trả kết quả đều kèm `sampleSize` và `confidence` — không có ngoại lệ.
 */

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86400_000;

/* ==================================================================== */
/* 1. NHỊP LÀM VIỆC (VELOCITY)                                          */
/* ==================================================================== */

export type ClosedTask = {
  /** Hạn chót đã đặt */
  dueDate: Date;
  /** Lúc thực sự đóng */
  completedAt: Date;
  /** Lúc bắt đầu (hoặc lúc tạo) */
  startDate: Date;
};

export type VelocityResult = {
  velocity: number;
  sampleSize: number;
  confidence: Confidence;
  onTimeRate: number | null;
  medianDelayDays: number | null;
  note: string;
};

/**
 * Nhịp làm việc của một người, tính từ những việc họ đã đóng.
 *
 * Bản thiết kế gốc nhận `assigneeVelocityHistory` như một tham số truyền vào,
 * nhưng KHÔNG có chỗ nào tính ra nó — tức là lõi của cả bộ dự báo bị bỏ trống.
 * Đây là phần tính thật.
 *
 * Cách tính: với mỗi việc đã đóng, lấy tỷ lệ *thời gian dự kiến / thời gian thực
 * tế*. Xong sớm hơn dự kiến thì tỷ lệ > 1, xong muộn thì < 1. Lấy **trung vị**
 * chứ không lấy trung bình, vì một việc kéo dài 3 tháng đủ làm hỏng trung bình
 * của cả chục việc bình thường.
 */
export function computeVelocity(
  closed: ClosedTask[],
  now = new Date()
): VelocityResult {
  const n = closed.length;

  if (n < VELOCITY_MIN_SAMPLES.NONE) {
    return {
      velocity: 1,
      sampleSize: n,
      confidence: "NONE",
      onTimeRate: null,
      medianDelayDays: null,
      note:
        n === 0
          ? "Người này chưa đóng việc nào — chưa có nền để đoán nhịp làm việc."
          : `Mới có ${n} việc đã đóng, cần ít nhất ${VELOCITY_MIN_SAMPLES.NONE} mới tính được nhịp riêng. Tạm dùng nhịp trung tính.`,
    };
  }

  const ratios: number[] = [];
  const delays: number[] = [];
  let onTime = 0;

  for (const t of closed) {
    const planned = t.dueDate.getTime() - t.startDate.getTime();
    const actual = t.completedAt.getTime() - t.startDate.getTime();
    if (planned > 0 && actual > 0) {
      ratios.push(planned / actual);
    }
    const delay = (t.completedAt.getTime() - t.dueDate.getTime()) / DAY;
    delays.push(delay);
    if (delay <= 0) onTime++;
  }

  const raw = ratios.length ? median(ratios) : 1;
  const velocity = round2(
    Math.max(VELOCITY_CLAMP.MIN, Math.min(VELOCITY_CLAMP.MAX, raw))
  );

  const confidence: Confidence =
    n >= VELOCITY_MIN_SAMPLES.HIGH
      ? "HIGH"
      : n >= VELOCITY_MIN_SAMPLES.MEDIUM
        ? "MEDIUM"
        : "LOW";

  const onTimeRate = round1((onTime / n) * 100);
  const medDelay = round1(median(delays));

  return {
    velocity,
    sampleSize: n,
    confidence,
    onTimeRate,
    medianDelayDays: medDelay,
    note: `Dựa trên ${n} việc đã đóng · đúng hạn ${onTimeRate}% · lệch hạn trung vị ${medDelay > 0 ? "+" : ""}${medDelay} ngày`,
  };
}

/* ==================================================================== */
/* 2. DỰ BÁO NGUY CƠ VỠ KẾ HOẠCH                                        */
/* ==================================================================== */

export type PredictTaskInput = {
  id: string;
  title: string;
  status: string;
  priority: string;
  progress: number;
  riskScore: number;
  startDate: Date | null;
  createdAt: Date;
  dueDate: Date;
  assigneeId: string | null;
  /** Số việc đang làm dở của người phụ trách */
  assigneeActiveTasks: number;
  /** Số việc mà việc này đang chờ, và chúng đã trễ */
  lateBlockerCount: number;
};

export type PredictionResult = {
  taskId: string;
  taskTitle: string;
  completionProbabilityPercent: number;
  projectedDelayDays: number;
  riskCategory: "ON_TRACK" | "MODERATE_RISK" | "HIGH_FAILURE_RISK";
  predictiveFactors: string[];
  sampleSize: number;
  confidence: Confidence;
  /** Tiến độ đáng lẽ phải đạt được tại thời điểm này */
  expectedProgressPercent: number;
  actualProgressPercent: number;
};

export function predictTask(
  task: PredictTaskInput,
  velocity: VelocityResult,
  now = new Date()
): PredictionResult {
  const start = task.startDate ?? task.createdAt;
  const totalMs = Math.max(1, task.dueDate.getTime() - start.getTime());
  const elapsedMs = Math.max(0, now.getTime() - start.getTime());
  const timeElapsedRatio = Math.min(1, elapsedMs / totalMs);

  /* --- Tiến độ hiện tại ---
     Ưu tiên số người kéo tay. Bản thiết kế luôn suy từ trạng thái, nhưng đoán
     theo trạng thái khi đã có số thật là vứt đi dữ liệu tốt hơn. */
  const fromStatus = STATUS_PROGRESS_FALLBACK[task.status] ?? 0;
  const currentProgress =
    task.progress > 0 ? task.progress / 100 : fromStatus;

  const expected = Math.min(1, timeElapsedRatio * velocity.velocity);
  const gap = expected - currentProgress;

  const factors: string[] = [];
  let probability = 100;

  if (gap > 0.2) {
    probability -= PREDICTION_PENALTY.SLOW_PROGRESS;
    factors.push(
      `Chậm hơn đường thẳng thời gian ${Math.round(gap * 100)}% — đáng lẽ phải xong ${Math.round(expected * 100)}%, thực tế ${Math.round(currentProgress * 100)}%.`
    );
  }

  if (task.riskScore >= 60) {
    probability -= PREDICTION_PENALTY.HIGH_RISK_SCORE;
    factors.push(`Đã mang điểm rủi ro vận hành cao (${task.riskScore}/100).`);
  }

  if (task.status === "BLOCKED") {
    probability -= PREDICTION_PENALTY.BLOCKED;
    factors.push("Đang bị chặn, chưa ai gỡ.");
  }

  if (task.lateBlockerCount > 0) {
    probability -= PREDICTION_PENALTY.LATE_BLOCKER;
    factors.push(
      `Đang chờ ${task.lateBlockerCount} việc khác mà mấy việc đó đã trễ.`
    );
  }

  if (!task.assigneeId) {
    probability -= PREDICTION_PENALTY.UNASSIGNED;
    factors.push("Chưa giao cho ai.");
  } else if (task.assigneeActiveTasks > 5) {
    probability -= PREDICTION_PENALTY.OVERLOADED_ASSIGNEE;
    factors.push(
      `Người phụ trách đang ôm ${task.assigneeActiveTasks} việc cùng lúc.`
    );
  }

  const finalProbability = Math.max(5, Math.min(99, Math.round(probability)));

  /* --- Số ngày dự kiến trễ --- */
  let projectedDelayDays = 0;
  if (finalProbability < 50) {
    const remainingWork = (1 - currentProgress) * totalMs;
    const rate = Math.max(0.1, velocity.velocity);
    const neededMs = remainingWork / rate;
    const availableMs = task.dueDate.getTime() - now.getTime();
    projectedDelayDays = round1((neededMs - availableMs) / DAY);
    if (projectedDelayDays < 0) projectedDelayDays = 0.5;
  }

  const riskCategory =
    finalProbability < PREDICTION_BANDS.HIGH_FAILURE_BELOW
      ? "HIGH_FAILURE_RISK"
      : finalProbability < PREDICTION_BANDS.MODERATE_BELOW
        ? "MODERATE_RISK"
        : "ON_TRACK";

  if (velocity.confidence === "NONE") {
    factors.push(
      `⚠ ${velocity.note} Con số dự báo dưới đây chỉ dựa trên tình trạng hiện tại của việc, chưa tính được thói quen làm việc của người phụ trách.`
    );
  }

  return {
    taskId: task.id,
    taskTitle: task.title,
    completionProbabilityPercent: finalProbability,
    projectedDelayDays,
    riskCategory,
    predictiveFactors: factors,
    sampleSize: velocity.sampleSize,
    confidence: velocity.confidence,
    expectedProgressPercent: Math.round(expected * 100),
    actualProgressPercent: Math.round(currentProgress * 100),
  };
}

/* ==================================================================== */
/* 3. CÂN BẰNG TẢI NHÂN SỰ                                              */
/* ==================================================================== */

export type CapacityTask = {
  priority: string;
  estimatedHours: number | null;
  dueDate: Date;
};

export type CapacityReport = {
  userId: string;
  fullName: string;
  departmentName: string | null;
  assignedTasksCount: number;
  totalEstimatedHours: number;
  capacityLimitHours: number;
  utilizationPercent: number;
  workloadStatus: "UNDERUTILIZED" | "OPTIMAL" | "OVERLOADED";
  /** Bao nhiêu giờ trong số đó thuộc việc đã quá hạn */
  overdueHours: number;
  /** Bao nhiêu việc chưa khai giờ ước tính — càng nhiều thì số càng kém tin */
  estimatedFromDefault: number;
  confidence: Confidence;
  note: string;
};

export function computeCapacity(
  user: { id: string; fullName: string; departmentName: string | null },
  tasks: CapacityTask[],
  now = new Date(),
  capacityLimitHours = CAPACITY_HOURS_PER_MONTH
): CapacityReport {
  let total = 0;
  let overdue = 0;
  let defaulted = 0;

  for (const t of tasks) {
    const hours =
      t.estimatedHours ??
      DEFAULT_HOURS_BY_PRIORITY[t.priority] ??
      DEFAULT_HOURS_BY_PRIORITY.MEDIUM;
    if (t.estimatedHours === null || t.estimatedHours === undefined) defaulted++;
    total += hours;
    if (t.dueDate.getTime() < now.getTime()) overdue += hours;
  }

  const utilizationPercent =
    capacityLimitHours > 0 ? Math.round((total / capacityLimitHours) * 100) : 0;

  const workloadStatus =
    utilizationPercent > WORKLOAD_BANDS.OVERLOADED_ABOVE
      ? "OVERLOADED"
      : utilizationPercent < WORKLOAD_BANDS.UNDERUTILIZED_BELOW
        ? "UNDERUTILIZED"
        : "OPTIMAL";

  /* Độ tin cậy phụ thuộc bao nhiêu việc phải đoán giờ thay vì có số thật */
  const ratioDefault = tasks.length ? defaulted / tasks.length : 1;
  const confidence: Confidence =
    tasks.length === 0
      ? "NONE"
      : ratioDefault === 0
        ? "HIGH"
        : ratioDefault <= 0.5
          ? "MEDIUM"
          : "LOW";

  const note =
    tasks.length === 0
      ? "Không có việc nào đang mở."
      : defaulted === 0
        ? `Cả ${tasks.length} việc đều đã khai giờ ước tính.`
        : `${defaulted}/${tasks.length} việc chưa khai giờ ước tính — hệ thống tạm đoán theo mức ưu tiên, nên con số này chỉ để so tương đối giữa người với người.`;

  return {
    userId: user.id,
    fullName: user.fullName,
    departmentName: user.departmentName,
    assignedTasksCount: tasks.length,
    totalEstimatedHours: round1(total),
    capacityLimitHours,
    utilizationPercent,
    workloadStatus,
    overdueHours: round1(overdue),
    estimatedFromDefault: defaulted,
    confidence,
    note,
  };
}

/**
 * Gợi ý san việc: ai đang gánh nặng nhất, ai còn dư sức nhất, nên chuyển bao nhiêu.
 * Chỉ gợi ý trong cùng phòng ban — luật cấm giao việc vượt cấp vẫn có hiệu lực.
 *
 * Số giờ đề nghị chuyển = **vừa đủ kéo người quá tải về mức bình thường**, chứ
 * không phải chia đôi khoảng chênh. Chia đôi nghe có vẻ công bằng nhưng ra kết
 * quả vô lý: người 118% gặp người 0% thì thành đề nghị chuyển 94 giờ — gần hết
 * việc của họ. Người đang 0% có thể là trưởng phòng chuyên giao việc chứ không
 * trực tiếp làm, đẩy cả núi việc sang là hỏng.
 */
export function suggestRebalance(reports: CapacityReport[]) {
  const over = reports
    .filter((r) => r.workloadStatus === "OVERLOADED")
    .sort((a, b) => b.utilizationPercent - a.utilizationPercent);
  const under = reports
    .filter((r) => r.workloadStatus === "UNDERUTILIZED")
    .sort((a, b) => a.utilizationPercent - b.utilizationPercent);

  const pairs: {
    from: CapacityReport;
    to: CapacityReport;
    gapPercent: number;
    suggestedHours: number;
  }[] = [];

  const count = Math.min(over.length, under.length);
  for (let i = 0; i < count; i++) {
    const from = over[i];
    const to = under[i];

    // Phần vượt quá 100% của người đang gánh nặng
    const excessHours =
      ((from.utilizationPercent - 100) / 100) * from.capacityLimitHours;
    // Chỗ trống của người nhận, tính tới mức 100%
    const headroomHours =
      ((100 - to.utilizationPercent) / 100) * to.capacityLimitHours;

    const suggestedHours = round1(Math.max(0, Math.min(excessHours, headroomHours)));
    if (suggestedHours <= 0) continue;

    pairs.push({
      from,
      to,
      gapPercent: from.utilizationPercent - to.utilizationPercent,
      suggestedHours,
    });
  }

  return pairs;
}

/* ==================================================================== */
/* 4. PHÁT HIỆN BẤT THƯỜNG KPI                                          */
/* ==================================================================== */

export type AnomalyResult = {
  isAnomaly: boolean;
  severity: "WATCH" | "WARNING" | "CRITICAL" | null;
  reportedValue: number;
  historicalMean: number;
  historicalMedian: number;
  stdDev: number;
  madValue: number;
  zScore: number;
  robustScore: number;
  sampleSize: number;
  confidence: Confidence;
  reason: string;
};

/**
 * Phát hiện số khai báo đột biến so với lịch sử của chính người đó.
 *
 * Dùng SONG SONG hai thước:
 *   - z-score cổ điển (theo bản thiết kế) — nhạy nhưng dễ bị chính ngoại lệ
 *     trong lịch sử làm cho mù.
 *   - modified z-score dựa trên trung vị và MAD — bền hơn, một ngoại lệ trong
 *     lịch sử không kéo lệch được nó.
 *
 * Kết luận lấy theo thước bền, z-score giữ lại để đối chiếu và để người xem hiểu
 * vì sao. Số kỳ lịch sử luôn được báo kèm.
 */
export function detectAnomaly(
  reportedValue: number,
  historicalValues: number[]
): AnomalyResult {
  const n = historicalValues.length;

  const base = {
    reportedValue,
    sampleSize: n,
    historicalMean: 0,
    historicalMedian: 0,
    stdDev: 0,
    madValue: 0,
    zScore: 0,
    robustScore: 0,
  };

  if (n < ANOMALY_MIN_SAMPLES.ANY) {
    return {
      ...base,
      historicalMean: reportedValue,
      historicalMedian: reportedValue,
      isAnomaly: false,
      severity: null,
      confidence: "NONE",
      reason: `Mới có ${n} kỳ lịch sử, cần ít nhất ${ANOMALY_MIN_SAMPLES.ANY} kỳ mới dám kết luận gì. Chưa đánh giá.`,
    };
  }

  const mean = historicalValues.reduce((a, b) => a + b, 0) / n;
  const variance =
    historicalValues.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  const med = median(historicalValues);
  const mad = median(historicalValues.map((v) => Math.abs(v - med)));

  const zScore = stdDev > 0 ? Math.abs(reportedValue - mean) / stdDev : 0;
  const robustScore =
    mad > 0
      ? (MAD_SCALE * Math.abs(reportedValue - med)) / mad
      : // MAD = 0 nghĩa là lịch sử phẳng lì. Khi đó chỉ cần lệch khỏi trung vị
        // là đáng chú ý, nhưng không thổi thành vô cực.
        reportedValue === med
        ? 0
        : ANOMALY_ROBUST_THRESHOLD + 1;

  const ratioFlag =
    med > 0 && reportedValue > med * ANOMALY_RATIO_THRESHOLD;

  const confidence: Confidence =
    n >= ANOMALY_MIN_SAMPLES.CRITICAL
      ? "HIGH"
      : n >= ANOMALY_MIN_SAMPLES.WARNING
        ? "MEDIUM"
        : "LOW";

  const tripped =
    robustScore > ANOMALY_ROBUST_THRESHOLD ||
    zScore > ANOMALY_Z_THRESHOLD ||
    ratioFlag;

  if (!tripped) {
    return {
      ...base,
      historicalMean: round2(mean),
      historicalMedian: round2(med),
      stdDev: round2(stdDev),
      madValue: round2(mad),
      zScore: round2(zScore),
      robustScore: round2(robustScore),
      isAnomaly: false,
      severity: null,
      confidence,
      reason: `Nằm trong khoảng bình thường của ${n} kỳ trước (trung vị ${round2(med)}).`,
    };
  }

  /* --- Có bất thường: mức độ phụ thuộc cả độ lệch lẫn độ dày dữ liệu --- */
  const bothAgree =
    robustScore > ANOMALY_ROBUST_THRESHOLD && zScore > ANOMALY_Z_THRESHOLD;

  let severity: "WATCH" | "WARNING" | "CRITICAL";
  if (n < ANOMALY_MIN_SAMPLES.CRITICAL) {
    // Dữ liệu còn mỏng thì cao nhất chỉ tới mức cảnh báo, không kết luận nặng
    severity = bothAgree ? "WARNING" : "WATCH";
  } else {
    severity = bothAgree ? "CRITICAL" : "WARNING";
  }

  const direction = reportedValue > med ? "cao hơn" : "thấp hơn";
  const reason = [
    `Số khai ${fmt(reportedValue)} ${direction} hẳn lịch sử ${n} kỳ của người này (trung vị ${fmt(med)}, trung bình ${fmt(round2(mean))}).`,
    `Lệch ${round1(robustScore)} lần theo thước bền${bothAgree ? ` và ${round1(zScore)} lần theo độ lệch chuẩn` : ""}.`,
    n < ANOMALY_MIN_SAMPLES.CRITICAL
      ? `Mới có ${n} kỳ nên chỉ dừng ở mức nhắc, chưa đủ để kết luận nặng.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    reportedValue,
    sampleSize: n,
    historicalMean: round2(mean),
    historicalMedian: round2(med),
    stdDev: round2(stdDev),
    madValue: round2(mad),
    zScore: round2(zScore),
    robustScore: round2(robustScore),
    isAnomaly: true,
    severity,
    confidence,
    reason,
  };
}

/* ==================================================================== */
/* 5. ĐIỂM SỨC KHOẺ VẬN HÀNH                                            */
/* ==================================================================== */

export type HealthInput = {
  openTasks: number;
  overdueTasks: number;
  criticalRiskTasks: number;
  overloadedPeople: number;
  totalPeople: number;
  mismatchCells: number;
  totalKpiCells: number;
  openAnomalies: number;
};

export type HealthResult = {
  score: number;
  parts: { key: string; label: string; weight: number; score: number; note: string }[];
};

/**
 * Điểm sức khoẻ tính bằng CÔNG THỨC CỐ ĐỊNH từ dữ liệu thật.
 *
 * Bản thiết kế để AI tự sinh con số này. Đó là kiểu sai nguy hiểm nhất: một số
 * 0-100 trông như đo đạc nhưng thực chất là AI ước chừng, và mỗi lần hỏi lại ra
 * một số khác. Ở đây AI chỉ viết phần diễn giải; con số là của hệ thống.
 */
export function computeHealth(d: HealthInput): HealthResult {
  const parts: HealthResult["parts"] = [];

  const onTime =
    d.openTasks === 0
      ? 100
      : Math.max(0, 100 - (d.overdueTasks / d.openTasks) * 100);
  parts.push({
    key: "ON_TIME_TASKS",
    label: "Việc bám hạn",
    weight: HEALTH_WEIGHTS.ON_TIME_TASKS,
    score: round1(onTime),
    note: `${d.overdueTasks}/${d.openTasks} việc đang mở đã quá hạn`,
  });

  const lowRisk =
    d.openTasks === 0
      ? 100
      : Math.max(0, 100 - (d.criticalRiskTasks / d.openTasks) * 300);
  parts.push({
    key: "LOW_RISK",
    label: "Không có việc báo động đỏ",
    weight: HEALTH_WEIGHTS.LOW_RISK,
    score: round1(lowRisk),
    note: `${d.criticalRiskTasks} việc ở mức báo động đỏ`,
  });

  const balanced =
    d.totalPeople === 0
      ? 100
      : Math.max(0, 100 - (d.overloadedPeople / d.totalPeople) * 200);
  parts.push({
    key: "BALANCED_WORKLOAD",
    label: "Tải nhân sự cân",
    weight: HEALTH_WEIGHTS.BALANCED_WORKLOAD,
    score: round1(balanced),
    note: `${d.overloadedPeople}/${d.totalPeople} người đang quá tải`,
  });

  const integrity =
    d.totalKpiCells === 0
      ? 100
      : Math.max(0, 100 - (d.mismatchCells / d.totalKpiCells) * 500);
  parts.push({
    key: "DATA_INTEGRITY",
    label: "Số liệu các nguồn khớp nhau",
    weight: HEALTH_WEIGHTS.DATA_INTEGRITY,
    score: round1(integrity),
    note: `${d.mismatchCells} ô KPI đang treo vì lệch nguồn`,
  });

  const noAnomaly = d.openAnomalies === 0 ? 100 : Math.max(0, 100 - d.openAnomalies * 25);
  parts.push({
    key: "NO_ANOMALY",
    label: "Không có khai báo bất thường",
    weight: HEALTH_WEIGHTS.NO_ANOMALY,
    score: round1(noAnomaly),
    note: `${d.openAnomalies} bất thường KPI đang chờ xử lý`,
  });

  // Trọng số lấy từ HEALTH_WEIGHTS (constants.ts) — chỉnh cấu hình ở đó là
  // có hiệu lực. Chia cho tổng trọng số để cấu hình không cộng đúng 100 vẫn
  // ra thang 0-100.
  const totalWeight = parts.reduce((s, p) => s + p.weight, 0) || 1;
  const score = round1(
    parts.reduce((s, p) => s + p.score * p.weight, 0) / totalWeight
  );

  return { score, parts };
}

/* ==================================================================== */
/* tiện ích                                                             */
/* ==================================================================== */

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function fmt(n: number) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n);
}
