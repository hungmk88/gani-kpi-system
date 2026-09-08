import {
  BONUS_TIERS,
  BASE_BONUS_PER_SHIFT_VND,
  DISCIPLINE_PENALTY_PER_VIOLATION,
  PRODUCTION_SCORE_CAP,
  PROBATION_TIER1_COMPONENTS,
  PROBATION_TIER_WEIGHTS,
  REWORK_LOSS_FACTOR,
  SAFETY_PENALTY_PER_VIOLATION,
  SHIFT_QUALITY_ZERO_AT_PERCENT,
  STAGE_DEFECT_ZERO_AT_PERCENT,
  TIER1_COMPONENTS,
  TIER1_WEIGHT,
  TIER2_COMPONENTS,
  TIER2_WEIGHT,
} from "./constants";

/**
 * ENGINE CHẤM ĐIỂM KPI XƯỞNG — 2 TẦNG.
 *
 * Chỉ chạy khi ca đã ở trạng thái LOCKED. Trước đó số liệu còn sửa được nên
 * chấm điểm là vô nghĩa.
 *
 * Hàm trong file này THUẦN TÍNH TOÁN — không đọc, không ghi database. Nhờ vậy
 * bộ kiểm thử chạy thẳng vào công thức được, và ai đọc cũng kiểm tra lại được
 * bằng máy tính bỏ túi.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo = 0, hi = PRODUCTION_SCORE_CAP) =>
  Math.max(lo, Math.min(hi, n));

/** Chia an toàn: mẫu số 0 thì trả về null thay vì Infinity/NaN. */
export function safeDiv(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  const r = a / b;
  return Number.isFinite(r) ? r : null;
}

export function safePercent(a: number, b: number): number | null {
  const r = safeDiv(a, b);
  return r === null ? null : round2(r * 100);
}

/* ======================================================= SỐ LIỆU DẪN XUẤT */

export type ShiftFacts = {
  rawOutputKg: number;
  qcPassedKg: number;
  reworkKg: number;
  scrapKg: number;
  haccpViolationCount: number;
  totalLaborHours: number;
  downtimeHours: number;
  targetOutputKg: number;
  rawMaterialInputKg: number;
  stdMaterialNormKg: number;
};

export type ShiftMetrics = {
  /** Đạt bao nhiêu % chỉ tiêu sản lượng */
  outputAchievementPercent: number | null;
  /** Tỷ lệ thu hồi: thành phẩm đạt / NVL cấp vào */
  yieldPercent: number | null;
  /** Định mức NVL: định mức chuẩn / NVL thực cấp. Trên 100 là dùng tiết kiệm hơn chuẩn */
  materialEfficiencyPercent: number | null;
  /** Phế phẩm trên sản lượng thô */
  scrapRatePercent: number | null;
  /** Hàng làm lại trên sản lượng thô */
  reworkRatePercent: number | null;
  /** Phế + làm lại (làm lại tính hệ số nhẹ hơn) */
  defectRatePercent: number | null;
  /** Năng suất của cả ca */
  kgPerLaborHour: number | null;
  /** Tỷ lệ dừng máy trong ca */
  downtimePercent: number | null;
  /** Chênh lệch cân đối khối lượng (kg) */
  massBalanceDiffKg: number;
  /** NVL dùng vượt định mức (kg), âm thì đã tiết kiệm */
  materialOverrunKg: number;
};

export function computeShiftMetrics(f: ShiftFacts): ShiftMetrics {
  const accounted = f.qcPassedKg + f.reworkKg + f.scrapKg;
  const weightedDefect = f.scrapKg + f.reworkKg * REWORK_LOSS_FACTOR;

  return {
    outputAchievementPercent: safePercent(f.qcPassedKg, f.targetOutputKg),
    yieldPercent: safePercent(f.qcPassedKg, f.rawMaterialInputKg),
    materialEfficiencyPercent: safePercent(
      f.stdMaterialNormKg,
      f.rawMaterialInputKg
    ),
    scrapRatePercent: safePercent(f.scrapKg, f.rawOutputKg),
    reworkRatePercent: safePercent(f.reworkKg, f.rawOutputKg),
    defectRatePercent: safePercent(weightedDefect, f.rawOutputKg),
    kgPerLaborHour: (() => {
      const r = safeDiv(f.qcPassedKg, f.totalLaborHours);
      return r === null ? null : round2(r);
    })(),
    downtimePercent: safePercent(f.downtimeHours, f.totalLaborHours),
    massBalanceDiffKg: round2(Math.abs(f.rawOutputKg - accounted)),
    materialOverrunKg: round2(f.rawMaterialInputKg - f.stdMaterialNormKg),
  };
}

/** Định mức NVL chuẩn cho ca = chỉ tiêu sản lượng × (1 + % hao hụt định mức). */
export function computeStdMaterialNorm(
  targetOutputKg: number,
  stdMaterialLossRate: number
) {
  return round2(targetOutputKg * (1 + stdMaterialLossRate / 100));
}

/** Tổn thất quy ra tiền — chỉ Ban Giám đốc và Giám đốc Sản xuất được xem. */
export function computeQualityLoss(
  f: Pick<ShiftFacts, "scrapKg" | "reworkKg" | "rawMaterialInputKg" | "stdMaterialNormKg">,
  unitPriceVnd: number
) {
  const extraLossKg = Math.max(0, f.rawMaterialInputKg - f.stdMaterialNormKg);
  const totalLossKg = f.scrapKg + f.reworkKg * REWORK_LOSS_FACTOR + extraLossKg;
  return {
    extraLossKg: round2(extraLossKg),
    totalLossKg: round2(totalLossKg),
    qualityLossVnd: round2(totalLossKg * unitPriceVnd),
  };
}

/* ============================================================ TẦNG 2 */

export type Tier2Breakdown = {
  score: number;
  parts: {
    key: string;
    label: string;
    weight: number;
    rawValue: number | null;
    componentScore: number;
    note: string;
  }[];
};

/**
 * TẦNG 2 — kết quả chung của cả ca (trọng số 40%).
 * Mọi người trong ca nhận cùng một điểm này.
 */
export function computeTier2(m: ShiftMetrics, f: ShiftFacts): Tier2Breakdown {
  const parts: Tier2Breakdown["parts"] = [];

  /* --- Sản lượng --- */
  const outputScore =
    m.outputAchievementPercent === null
      ? 0
      : clamp(m.outputAchievementPercent);
  parts.push({
    key: "OUTPUT",
    label: "Đạt chỉ tiêu sản lượng",
    weight: TIER2_COMPONENTS.OUTPUT,
    rawValue: m.outputAchievementPercent,
    componentScore: round2(outputScore),
    note:
      m.outputAchievementPercent === null
        ? "Chưa có chỉ tiêu sản lượng nên không chấm được"
        : `Đạt ${m.outputAchievementPercent}% chỉ tiêu (${f.qcPassedKg} / ${f.targetOutputKg} kg)`,
  });

  /* --- Định mức nguyên liệu --- */
  const materialScore =
    m.materialEfficiencyPercent === null ? 0 : clamp(m.materialEfficiencyPercent);
  parts.push({
    key: "MATERIAL",
    label: "Giữ định mức nguyên liệu",
    weight: TIER2_COMPONENTS.MATERIAL,
    rawValue: m.materialEfficiencyPercent,
    componentScore: round2(materialScore),
    note:
      m.materialEfficiencyPercent === null
        ? "Chưa có số nguyên liệu cấp vào"
        : m.materialOverrunKg > 0
          ? `Dùng vượt định mức ${m.materialOverrunKg} kg`
          : `Tiết kiệm được ${Math.abs(m.materialOverrunKg)} kg so với định mức`,
  });

  /* --- Chất lượng ca --- */
  const defect = m.defectRatePercent ?? 0;
  const qualityScore = clamp(
    100 - (defect / SHIFT_QUALITY_ZERO_AT_PERCENT) * 100,
    0,
    100
  );
  parts.push({
    key: "QUALITY",
    label: "Phế phẩm và hàng làm lại",
    weight: TIER2_COMPONENTS.QUALITY,
    rawValue: m.defectRatePercent,
    componentScore: round2(qualityScore),
    note: `Phế ${f.scrapKg} kg, làm lại ${f.reworkKg} kg — quy ra ${defect}% sản lượng thô (mất hết điểm ở mức ${SHIFT_QUALITY_ZERO_AT_PERCENT}%)`,
  });

  /* --- An toàn thực phẩm --- */
  const safetyScore = clamp(
    100 - f.haccpViolationCount * SAFETY_PENALTY_PER_VIOLATION,
    0,
    100
  );
  parts.push({
    key: "SAFETY",
    label: "An toàn thực phẩm (HACCP)",
    weight: TIER2_COMPONENTS.SAFETY,
    rawValue: f.haccpViolationCount,
    componentScore: round2(safetyScore),
    note:
      f.haccpViolationCount === 0
        ? "Không có vi phạm"
        : `${f.haccpViolationCount} vi phạm, mỗi vi phạm trừ ${SAFETY_PENALTY_PER_VIOLATION} điểm`,
  });

  const total = parts.reduce(
    (s, p) => s + (p.componentScore * p.weight) / 100,
    0
  );

  return { score: round2(clamp(total)), parts };
}

/* ============================================================ TẦNG 1 */

export type ParticipantFacts = {
  userId: string;
  stage: string;
  hoursWorked: number;
  scheduledHours: number;
  personalDefectKg: number;
  violationCount: number;
};

export type Tier1Breakdown = Tier2Breakdown;

/**
 * TẦNG 1 — phần của riêng từng người (trọng số 60%).
 *
 * Khối lượng quy cho một người = thành phẩm đạt của ca × tỷ trọng giờ công của
 * người đó. Không phải để chấm năng suất (chia kiểu này ai cũng như ai), mà để
 * lấy mẫu số công bằng khi tính tỷ lệ lỗi: làm 10 giờ mà lỗi 2 kg khác hẳn làm
 * 2 giờ mà lỗi 2 kg.
 */
export type Tier1ComponentWeights = {
  STAGE_QUALITY: number;
  ATTENDANCE: number;
  DISCIPLINE: number;
};

export function computeTier1(
  p: ParticipantFacts,
  f: ShiftFacts,
  totalHours: number,
  components: Tier1ComponentWeights = TIER1_COMPONENTS
): Tier1Breakdown {
  const parts: Tier1Breakdown["parts"] = [];

  const shareRatio = safeDiv(p.hoursWorked, totalHours) ?? 0;
  const attributedKg = round2(f.qcPassedKg * shareRatio);

  /* --- Chất lượng công đoạn --- */
  const defectPercent = safePercent(p.personalDefectKg, attributedKg);
  const stageScore =
    defectPercent === null
      ? 100 // chưa quy được khối lượng thì không phạt oan
      : clamp(
          100 - (defectPercent / STAGE_DEFECT_ZERO_AT_PERCENT) * 100,
          0,
          100
        );
  parts.push({
    key: "STAGE_QUALITY",
    label: "Chất lượng công đoạn",
    weight: components.STAGE_QUALITY,
    rawValue: defectPercent,
    componentScore: round2(stageScore),
    note:
      defectPercent === null
        ? "Chưa quy được khối lượng cho người này nên tạm cho đủ điểm"
        : `Lỗi ${p.personalDefectKg} kg trên ${attributedKg} kg quy cho công đoạn = ${defectPercent}%`,
  });

  /* --- Chuyên cần --- */
  const attendancePercent = safePercent(p.hoursWorked, p.scheduledHours);
  const attendanceScore =
    attendancePercent === null ? 100 : clamp(attendancePercent, 0, 100);
  parts.push({
    key: "ATTENDANCE",
    label: "Chuyên cần",
    weight: components.ATTENDANCE,
    rawValue: attendancePercent,
    componentScore: round2(attendanceScore),
    note:
      attendancePercent === null
        ? "Chưa khai giờ công đăng ký"
        : `Làm ${p.hoursWorked} / ${p.scheduledHours} giờ đăng ký`,
  });

  /* --- Kỷ luật và an toàn cá nhân --- */
  const disciplineScore = clamp(
    100 - p.violationCount * DISCIPLINE_PENALTY_PER_VIOLATION,
    0,
    100
  );
  parts.push({
    key: "DISCIPLINE",
    label: "Kỷ luật & an toàn cá nhân",
    weight: components.DISCIPLINE,
    rawValue: p.violationCount,
    componentScore: round2(disciplineScore),
    note:
      p.violationCount === 0
        ? "Không vi phạm"
        : `${p.violationCount} vi phạm, mỗi vi phạm trừ ${DISCIPLINE_PENALTY_PER_VIOLATION} điểm`,
  });

  const total = parts.reduce(
    (s, x) => s + (x.componentScore * x.weight) / 100,
    0
  );

  return { score: round2(clamp(total)), parts };
}

/* ==================================================== ĐIỂM CUỐI & THƯỞNG */

export type FinalScore = {
  tier1Score: number;
  tier2Score: number;
  finalWeightedScore: number;
  bonusMultiplier: number;
  finalBonusVnd: number;
  breakdown: {
    tier1: Tier1Breakdown;
    tier2: Tier2Breakdown;
    attributedKg: number;
    formula: string;
  };
};

export type TierWeights = { tier1: number; tier2: number };

const STANDARD_WEIGHTS: TierWeights = { tier1: TIER1_WEIGHT, tier2: TIER2_WEIGHT };

/**
 * Bộ trọng số áp dụng theo loại nhân sự — xem lib/production/constants.ts.
 * Thử việc/thời vụ dùng 80/20 + Tầng 1 nghiêng về an toàn, chính thức dùng
 * 60/40 gốc.
 */
export function tierWeightsFor(employmentType: string | null | undefined): {
  weights: TierWeights;
  tier1Components: Tier1ComponentWeights;
} {
  if (employmentType === "PROBATION" || employmentType === "SEASONAL") {
    return {
      weights: { tier1: PROBATION_TIER_WEIGHTS.TIER1, tier2: PROBATION_TIER_WEIGHTS.TIER2 },
      tier1Components: PROBATION_TIER1_COMPONENTS,
    };
  }
  return { weights: STANDARD_WEIGHTS, tier1Components: TIER1_COMPONENTS };
}

export function computeFinalScore(
  p: ParticipantFacts,
  f: ShiftFacts,
  totalHours: number,
  tier2: Tier2Breakdown,
  tierWeights: TierWeights = STANDARD_WEIGHTS,
  tier1Components: Tier1ComponentWeights = TIER1_COMPONENTS
): FinalScore {
  const tier1 = computeTier1(p, f, totalHours, tier1Components);
  const final = round2(
    tier1.score * tierWeights.tier1 + tier2.score * tierWeights.tier2
  );
  const multiplier = bonusMultiplierFor(final);

  return {
    tier1Score: tier1.score,
    tier2Score: tier2.score,
    finalWeightedScore: final,
    bonusMultiplier: multiplier,
    finalBonusVnd: round2(BASE_BONUS_PER_SHIFT_VND * multiplier),
    breakdown: {
      tier1,
      tier2,
      attributedKg: round2(f.qcPassedKg * (safeDiv(p.hoursWorked, totalHours) ?? 0)),
      formula: `(${tier1.score} × ${tierWeights.tier1}) + (${tier2.score} × ${tierWeights.tier2}) = ${final}`,
    },
  };
}

export function bonusMultiplierFor(score: number) {
  for (const tier of BONUS_TIERS) {
    if (score >= tier.minScore) return tier.multiplier;
  }
  return 0;
}
