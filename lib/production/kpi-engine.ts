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
 *
 * THIẾU SỐ LIỆU KHÔNG BAO GIỜ ĐƯỢC ĐIỂM TUYỆT ĐỐI. Trước đây mẫu số bằng 0 bị
 * coi như "không lỗi" nên cho 100 (công nhân 0 giờ công, ca sản lượng thô 0,
 * lỗi mà không quy được khối lượng... đều được trọn điểm). Quy tắc hiện tại:
 *   - Có lỗi/vi phạm mà mẫu số bằng 0 → 0 điểm (lỗi trên "không gì cả" là tệ nhất).
 *   - Không có cả tử lẫn mẫu → thành phần "không có dữ liệu" (measured = false,
 *     weight = 0): KHÔNG tính vào tổng, trọng số các thành phần còn lại được
 *     chia lại cho đủ 100 (renormalize). Trọng số gốc giữ ở nominalWeight.
 *   - Người không có giờ công (hoursWorked ≤ 0) → Tầng 1 = 0: không làm thì
 *     không có gì để chấm, càng không thể trọn điểm.
 *   - Sản lượng/định mức NVL không có chỉ tiêu → 0 như cũ.
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
    // Tiền lưu số nguyên VND (cột Int) — làm tròn đến đồng
    qualityLossVnd: Math.round(totalLossKg * unitPriceVnd),
  };
}

/* ============================================================ TẦNG 2 */

export type ScorePart = {
  key: string;
  label: string;
  /** Trọng số thực dùng khi cộng tổng — 0 nếu thành phần không có dữ liệu. */
  weight: number;
  /** Trọng số gốc trong constants.ts. */
  nominalWeight: number;
  /** false = không có dữ liệu, không tính vào tổng (xem chú thích đầu file). */
  measured: boolean;
  rawValue: number | null;
  componentScore: number;
  note: string;
};

export type Tier2Breakdown = {
  score: number;
  parts: ScorePart[];
};

/** Thành phần có dữ liệu. */
function part(
  key: string,
  label: string,
  weight: number,
  rawValue: number | null,
  componentScore: number,
  note: string
): ScorePart {
  return {
    key,
    label,
    weight,
    nominalWeight: weight,
    measured: true,
    rawValue,
    componentScore: round2(componentScore),
    note,
  };
}

/** Thành phần không có dữ liệu — bị loại khỏi tổng. */
function unmeasured(key: string, label: string, weight: number, note: string): ScorePart {
  return {
    key,
    label,
    weight: 0,
    nominalWeight: weight,
    measured: false,
    rawValue: null,
    componentScore: 0,
    note: `${note} — không tính, trọng số chia lại cho các phần còn lại`,
  };
}

/**
 * Tổng có trọng số, chia lại theo các thành phần CÓ dữ liệu. Không thành phần
 * nào có dữ liệu → 0 (không bao giờ mặc định 100).
 */
function weightedTotal(parts: ScorePart[]): number {
  const measured = parts.filter((p) => p.measured && p.weight > 0);
  const wSum = measured.reduce((s, p) => s + p.weight, 0);
  if (wSum <= 0) return 0;
  const total = measured.reduce((s, p) => s + p.componentScore * p.weight, 0) / wSum;
  return round2(clamp(total));
}

/**
 * TẦNG 2 — kết quả chung của cả ca (trọng số 40%).
 * Mọi người trong ca nhận cùng một điểm này.
 */
export function computeTier2(m: ShiftMetrics, f: ShiftFacts): Tier2Breakdown {
  const parts: ScorePart[] = [];

  /* --- Sản lượng — không có chỉ tiêu thì 0 (không chấm được, không cho không) --- */
  const outputScore =
    m.outputAchievementPercent === null
      ? 0
      : clamp(m.outputAchievementPercent);
  parts.push(
    part(
      "OUTPUT",
      "Đạt chỉ tiêu sản lượng",
      TIER2_COMPONENTS.OUTPUT,
      m.outputAchievementPercent,
      outputScore,
      m.outputAchievementPercent === null
        ? "Chưa có chỉ tiêu sản lượng nên không chấm được — 0 điểm"
        : `Đạt ${m.outputAchievementPercent}% chỉ tiêu (${f.qcPassedKg} / ${f.targetOutputKg} kg)`
    )
  );

  /* --- Định mức nguyên liệu — không có số NVL cấp vào thì 0 --- */
  const materialScore =
    m.materialEfficiencyPercent === null ? 0 : clamp(m.materialEfficiencyPercent);
  parts.push(
    part(
      "MATERIAL",
      "Giữ định mức nguyên liệu",
      TIER2_COMPONENTS.MATERIAL,
      m.materialEfficiencyPercent,
      materialScore,
      m.materialEfficiencyPercent === null
        ? "Chưa có số nguyên liệu cấp vào — 0 điểm"
        : m.materialOverrunKg > 0
          ? `Dùng vượt định mức ${m.materialOverrunKg} kg`
          : `Tiết kiệm được ${Math.abs(m.materialOverrunKg)} kg so với định mức`
    )
  );

  /* --- Chất lượng ca ---
     Sản lượng thô = 0: có phế/làm lại → 0 điểm; không có gì → không có dữ liệu.
     (Trước đây rơi về defect = 0 → 100 điểm.) */
  const weightedDefectKg = f.scrapKg + f.reworkKg * REWORK_LOSS_FACTOR;
  if (m.defectRatePercent === null) {
    parts.push(
      weightedDefectKg > 0
        ? part(
            "QUALITY",
            "Phế phẩm và hàng làm lại",
            TIER2_COMPONENTS.QUALITY,
            null,
            0,
            `Phế ${f.scrapKg} kg, làm lại ${f.reworkKg} kg nhưng sản lượng thô khai 0 kg — 0 điểm`
          )
        : unmeasured(
            "QUALITY",
            "Phế phẩm và hàng làm lại",
            TIER2_COMPONENTS.QUALITY,
            "Sản lượng thô 0 kg, không tính được tỷ lệ lỗi"
          )
    );
  } else {
    const defect = m.defectRatePercent;
    parts.push(
      part(
        "QUALITY",
        "Phế phẩm và hàng làm lại",
        TIER2_COMPONENTS.QUALITY,
        defect,
        clamp(100 - (defect / SHIFT_QUALITY_ZERO_AT_PERCENT) * 100, 0, 100),
        `Phế ${f.scrapKg} kg, làm lại ${f.reworkKg} kg — quy ra ${defect}% sản lượng thô (mất hết điểm ở mức ${SHIFT_QUALITY_ZERO_AT_PERCENT}%)`
      )
    );
  }

  /* --- An toàn thực phẩm --- */
  const safetyScore = clamp(
    100 - f.haccpViolationCount * SAFETY_PENALTY_PER_VIOLATION,
    0,
    100
  );
  parts.push(
    part(
      "SAFETY",
      "An toàn thực phẩm (HACCP)",
      TIER2_COMPONENTS.SAFETY,
      f.haccpViolationCount,
      safetyScore,
      f.haccpViolationCount === 0
        ? "Không có vi phạm"
        : `${f.haccpViolationCount} vi phạm, mỗi vi phạm trừ ${SAFETY_PENALTY_PER_VIOLATION} điểm`
    )
  );

  return { score: weightedTotal(parts), parts };
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
  const parts: ScorePart[] = [];

  // Không có giờ công → không tham gia ca thực sự → Tầng 1 = 0.
  // (Trước đây: không quy được kg → chất lượng 100, thiếu giờ đăng ký →
  // chuyên cần 100, nên người 0 giờ công vẫn có thể được Tầng 1 = 100.)
  if (!(p.hoursWorked > 0)) {
    parts.push(
      part("STAGE_QUALITY", "Chất lượng công đoạn", components.STAGE_QUALITY, null, 0,
        "Không có giờ công trong ca — 0 điểm"),
      part("ATTENDANCE", "Chuyên cần", components.ATTENDANCE,
        safePercent(0, p.scheduledHours), 0,
        p.scheduledHours > 0
          ? `Làm 0 / ${p.scheduledHours} giờ đăng ký`
          : "Không có giờ công — 0 điểm"),
      part("DISCIPLINE", "Kỷ luật & an toàn cá nhân", components.DISCIPLINE,
        p.violationCount, 0, "Không có giờ công trong ca — 0 điểm")
    );
    return { score: 0, parts };
  }

  const shareRatio = safeDiv(p.hoursWorked, totalHours) ?? 0;
  const attributedKg = round2(f.qcPassedKg * shareRatio);

  /* --- Chất lượng công đoạn ---
     Không quy được khối lượng (ca không có thành phẩm đạt): có lỗi → 0,
     không lỗi → không có dữ liệu. */
  const defectPercent = safePercent(p.personalDefectKg, attributedKg);
  if (defectPercent === null) {
    parts.push(
      p.personalDefectKg > 0
        ? part("STAGE_QUALITY", "Chất lượng công đoạn", components.STAGE_QUALITY, null, 0,
            `Lỗi ${p.personalDefectKg} kg nhưng không có thành phẩm đạt nào quy cho công đoạn — 0 điểm`)
        : unmeasured("STAGE_QUALITY", "Chất lượng công đoạn", components.STAGE_QUALITY,
            "Không quy được khối lượng thành phẩm cho người này")
    );
  } else {
    parts.push(
      part("STAGE_QUALITY", "Chất lượng công đoạn", components.STAGE_QUALITY, defectPercent,
        clamp(100 - (defectPercent / STAGE_DEFECT_ZERO_AT_PERCENT) * 100, 0, 100),
        `Lỗi ${p.personalDefectKg} kg trên ${attributedKg} kg quy cho công đoạn = ${defectPercent}%`)
    );
  }

  /* --- Chuyên cần — chưa khai giờ đăng ký thì không có dữ liệu (không cho 100) --- */
  const attendancePercent = safePercent(p.hoursWorked, p.scheduledHours);
  parts.push(
    attendancePercent === null
      ? unmeasured("ATTENDANCE", "Chuyên cần", components.ATTENDANCE, "Chưa khai giờ công đăng ký")
      : part("ATTENDANCE", "Chuyên cần", components.ATTENDANCE, attendancePercent,
          clamp(attendancePercent, 0, 100),
          `Làm ${p.hoursWorked} / ${p.scheduledHours} giờ đăng ký`)
  );

  /* --- Kỷ luật và an toàn cá nhân --- */
  const disciplineScore = clamp(
    100 - p.violationCount * DISCIPLINE_PENALTY_PER_VIOLATION,
    0,
    100
  );
  parts.push(
    part("DISCIPLINE", "Kỷ luật & an toàn cá nhân", components.DISCIPLINE, p.violationCount,
      disciplineScore,
      p.violationCount === 0
        ? "Không vi phạm"
        : `${p.violationCount} vi phạm, mỗi vi phạm trừ ${DISCIPLINE_PENALTY_PER_VIOLATION} điểm`)
  );

  return { score: weightedTotal(parts), parts };
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
    finalBonusVnd: Math.round(BASE_BONUS_PER_SHIFT_VND * multiplier),
    breakdown: {
      tier1,
      tier2,
      attributedKg: round2(f.qcPassedKg * (safeDiv(p.hoursWorked, totalHours) ?? 0)),
      formula: `(${tier1.score} × ${tierWeights.tier1}) + (${tier2.score} × ${tierWeights.tier2}) = ${final}`,
    },
  };
}

/**
 * Hệ số thưởng theo bậc. BONUS_TIERS xếp giảm dần và bậc cuối minScore = 0
 * nên mọi điểm hợp lệ (≥ 0) đều rơi vào đúng một bậc; NaN/âm → 0.
 *
 * Điểm cuối tối đa thực tế = 0.6 × 100 (Tầng 1 trần 100) + 0.4 × 130
 * (Tầng 2: Sản lượng & NVL trần 150, Chất lượng & An toàn trần 100) = 112;
 * thử việc/thời vụ 0.8 × 100 + 0.2 × 130 = 106. Ngưỡng BONUS_TIERS đặt theo
 * đúng dải này (≥ 110 → 1,5×), xem lib/production/constants.ts.
 */
export function bonusMultiplierFor(score: number) {
  if (!Number.isFinite(score) || score < 0) return 0;
  for (const tier of BONUS_TIERS) {
    if (score >= tier.minScore) return tier.multiplier;
  }
  return 0;
}
