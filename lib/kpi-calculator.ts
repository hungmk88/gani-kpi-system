// File: lib/kpi-calculator.ts

import { prisma } from "@/lib/db";

/**
 * KPI Weight Configuration (6 KPI Phòng SX)
 */
const KPI_WEIGHTS = {
  PROD_OUTPUT: 25,      // Sản Lượng (cao tốt)
  PROD_WASTE: 25,       // Hao Hụt (thấp tốt)
  PROD_QUALITY: 20,     // Chất Lượng (cao tốt)
  PROD_SPEC: 15,        // Đúng Spec (cao tốt)
  PROD_SAFETY: 10,      // An Toàn (cao tốt)
  PROD_DEADLINE: 5,     // Deadline (cao tốt)
};

/**
 * Tính Achievement % cho 1 KPI
 *
 * @param actual - Giá trị thực tế
 * @param target - Giá trị target
 * @param isHigherBetter - true = cao tốt, false = thấp tốt
 * @returns Achievement % (0-150%, capped at 150)
 */
export function calculateAchievementPercent(
  actual: number | null | undefined,
  target: number | null | undefined,
  isHigherBetter: boolean
): number {
  if (!actual || !target || target === 0) return 0;

  let achievement: number;

  if (isHigherBetter) {
    // Cao tốt: achievement = (actual / target) × 100
    achievement = (actual / target) * 100;
  } else {
    // Thấp tốt: achievement = (target / actual) × 100
    // VD: target hao hụt 4%, actual 3% → 4/3 × 100 = 133%
    achievement = (target / actual) * 100;
  }

  // Cap at 150% để không quá cao
  return Math.min(achievement, 150);
}

/**
 * Tính Weighted Score cho 1 KPI
 * Weighted Score = Achievement% × Weight / 100
 *
 * @param achievement - Achievement % (0-150)
 * @param weight - Trọng số KPI (0-100)
 * @returns Weighted Score (0-1.5)
 */
export function calculateWeightedScore(
  achievement: number,
  weight: number
): number {
  return (achievement * weight) / 100;
}

/**
 * Tính Total Score (Tổng 6 KPI)
 * Total = Tổng của 6 weighted scores
 *
 * @param scores - Array của 6 weighted scores
 * @returns Total Score (0-100)
 */
export function calculateTotalScore(scores: number[]): number {
  const total = scores.reduce((sum, score) => sum + score, 0);
  // Cap at 100 (achievement 100% ở tất cả KPI = 100 điểm)
  return Math.min(total, 100);
}

/**
 * Lấy Bonus Multiplier từ BonusConfig
 * Dựa vào achievement % so với bậc thang
 *
 * @param totalScore - Total Score (0-100)
 * @returns Bonus Multiplier (1.5 / 1.0 / 0.75 / 0)
 */
export async function getBonusMultiplier(
  totalScore: number
): Promise<number> {
  // Convert score (0-100) to achievement % (0-150)
  // Score 100 = 100% achievement
  // Score 150 = 150% achievement
  const achievementPercent = totalScore;

  const bonusConfig = await prisma.bonusConfig.findFirst({
    where: {
      department: "PRODUCTION",
      isActive: true,
      achievementMin: { lte: achievementPercent },
      achievementMax: { gte: achievementPercent },
    },
  });

  return bonusConfig?.bonusMultiplier || 0;
}

/**
 * Tính Bonus Amount
 * Bonus = baseSalary × bonusMultiplier
 */
export function calculateBonusAmount(
  baseSalary: number,
  bonusMultiplier: number
): number {
  return baseSalary * bonusMultiplier;
}

/**
 * Main Function: Tính toàn bộ điểm cho 1 ca
 *
 * Input: shiftLogId + dailyKpiResults (6 KPI values)
 * Output: ShiftKpiScore record
 */
export async function calculateShiftKpiScore(
  shiftLogId: string,
  periodTargetId: string,
  kpiResults: {
    output_actual?: number;
    waste_actual?: number;
    quality_actual?: number;
    spec_actual?: number;
    safety_actual?: number;
    deadline_actual?: number;
  }
) {
  try {
    // 1. Lấy Period Target (để có targets)
    const periodTarget = await prisma.kpiPeriodTarget.findUnique({
      where: { id: periodTargetId },
    });

    if (!periodTarget) {
      throw new Error("Period target not found");
    }

    // 2. Tính 6 KPI Achievements & Weighted Scores
    const output_achievement = calculateAchievementPercent(
      kpiResults.output_actual,
      periodTarget.output_target,
      true // Cao tốt
    );
    const output_weighted = calculateWeightedScore(
      output_achievement,
      KPI_WEIGHTS.PROD_OUTPUT
    );

    const waste_achievement = calculateAchievementPercent(
      kpiResults.waste_actual,
      periodTarget.waste_target,
      false // Thấp tốt
    );
    const waste_weighted = calculateWeightedScore(
      waste_achievement,
      KPI_WEIGHTS.PROD_WASTE
    );

    const quality_achievement = calculateAchievementPercent(
      kpiResults.quality_actual,
      periodTarget.quality_target,
      true
    );
    const quality_weighted = calculateWeightedScore(
      quality_achievement,
      KPI_WEIGHTS.PROD_QUALITY
    );

    const spec_achievement = calculateAchievementPercent(
      kpiResults.spec_actual,
      periodTarget.spec_target,
      true
    );
    const spec_weighted = calculateWeightedScore(
      spec_achievement,
      KPI_WEIGHTS.PROD_SPEC
    );

    const safety_achievement = calculateAchievementPercent(
      kpiResults.safety_actual,
      periodTarget.safety_target,
      true
    );
    const safety_weighted = calculateWeightedScore(
      safety_achievement,
      KPI_WEIGHTS.PROD_SAFETY
    );

    const deadline_achievement = calculateAchievementPercent(
      kpiResults.deadline_actual,
      periodTarget.deadline_target,
      true
    );
    const deadline_weighted = calculateWeightedScore(
      deadline_achievement,
      KPI_WEIGHTS.PROD_DEADLINE
    );

    // 3. Tính Total Score
    const totalScore = calculateTotalScore([
      output_weighted,
      waste_weighted,
      quality_weighted,
      spec_weighted,
      safety_weighted,
      deadline_weighted,
    ]);

    // 4. Lấy Bonus Multiplier
    const bonusMultiplier = await getBonusMultiplier(totalScore);

    // 5. Tính Bonus Amount
    const bonusAmount = calculateBonusAmount(233000, bonusMultiplier);

    // 6. Tạo Breakdown JSON
    const breakdownJson = JSON.stringify({
      kpis: [
        {
          code: "PROD_OUTPUT",
          name: "Sản Lượng Thực Tế",
          actual: kpiResults.output_actual,
          target: periodTarget.output_target,
          unit: "kg/ca",
          achievement: output_achievement.toFixed(2),
          weight: KPI_WEIGHTS.PROD_OUTPUT,
          score: output_weighted.toFixed(2),
        },
        {
          code: "PROD_WASTE",
          name: "Tỷ Lệ Hao Hụt",
          actual: kpiResults.waste_actual,
          target: periodTarget.waste_target,
          unit: "%",
          achievement: waste_achievement.toFixed(2),
          weight: KPI_WEIGHTS.PROD_WASTE,
          score: waste_weighted.toFixed(2),
        },
        {
          code: "PROD_QUALITY",
          name: "Tỷ Lệ Chất Lượng (OK)",
          actual: kpiResults.quality_actual,
          target: periodTarget.quality_target,
          unit: "%",
          achievement: quality_achievement.toFixed(2),
          weight: KPI_WEIGHTS.PROD_QUALITY,
          score: quality_weighted.toFixed(2),
        },
        {
          code: "PROD_SPEC",
          name: "Tỷ Lệ Đúng Spec",
          actual: kpiResults.spec_actual,
          target: periodTarget.spec_target,
          unit: "%",
          achievement: spec_achievement.toFixed(2),
          weight: KPI_WEIGHTS.PROD_SPEC,
          score: spec_weighted.toFixed(2),
        },
        {
          code: "PROD_SAFETY",
          name: "An Toàn Lao Động",
          actual: kpiResults.safety_actual,
          target: periodTarget.safety_target,
          unit: "điểm",
          achievement: safety_achievement.toFixed(2),
          weight: KPI_WEIGHTS.PROD_SAFETY,
          score: safety_weighted.toFixed(2),
        },
        {
          code: "PROD_DEADLINE",
          name: "Đúng Deadline Batch",
          actual: kpiResults.deadline_actual,
          target: periodTarget.deadline_target,
          unit: "%",
          achievement: deadline_achievement.toFixed(2),
          weight: KPI_WEIGHTS.PROD_DEADLINE,
          score: deadline_weighted.toFixed(2),
        },
      ],
      totalScore: totalScore.toFixed(2),
      bonusMultiplier: bonusMultiplier.toFixed(2),
      bonusAmount: bonusAmount.toFixed(0),
    });

    // 7. Lưu vào database
    const shiftKpiScore = await prisma.shiftKpiScore.upsert({
      where: { shiftLogId },
      create: {
        shiftLogId,
        periodTargetId,
        output_actual: kpiResults.output_actual,
        output_target: periodTarget.output_target,
        output_achievement,
        output_weighted_score: output_weighted,
        waste_actual: kpiResults.waste_actual,
        waste_target: periodTarget.waste_target,
        waste_achievement,
        waste_weighted_score: waste_weighted,
        quality_actual: kpiResults.quality_actual,
        quality_target: periodTarget.quality_target,
        quality_achievement,
        quality_weighted_score: quality_weighted,
        spec_actual: kpiResults.spec_actual,
        spec_target: periodTarget.spec_target,
        spec_achievement,
        spec_weighted_score: spec_weighted,
        safety_actual: kpiResults.safety_actual,
        safety_target: periodTarget.safety_target,
        safety_achievement,
        safety_weighted_score: safety_weighted,
        deadline_actual: kpiResults.deadline_actual,
        deadline_target: periodTarget.deadline_target,
        deadline_achievement,
        deadline_weighted_score: deadline_weighted,
        totalScore,
        bonusMultiplier,
        bonusAmount,
        breakdownJson,
        status: "CALCULATED",
        calculatedAt: new Date(),
      },
      update: {
        output_actual: kpiResults.output_actual,
        output_achievement,
        output_weighted_score: output_weighted,
        waste_actual: kpiResults.waste_actual,
        waste_achievement,
        waste_weighted_score: waste_weighted,
        quality_actual: kpiResults.quality_actual,
        quality_achievement,
        quality_weighted_score: quality_weighted,
        spec_actual: kpiResults.spec_actual,
        spec_achievement,
        spec_weighted_score: spec_weighted,
        safety_actual: kpiResults.safety_actual,
        safety_achievement,
        safety_weighted_score: safety_weighted,
        deadline_actual: kpiResults.deadline_actual,
        deadline_achievement,
        deadline_weighted_score: deadline_weighted,
        totalScore,
        bonusMultiplier,
        bonusAmount,
        breakdownJson,
        status: "CALCULATED",
        calculatedAt: new Date(),
      },
    });

    return shiftKpiScore;
  } catch (error) {
    console.error("Error calculating shift KPI score:", error);
    throw error;
  }
}

/**
 * Ví dụ sử dụng:
 *
 * const score = await calculateShiftKpiScore(
 *   "shift-log-id",
 *   "period-target-id",
 *   {
 *     output_actual: 480,      // kg/ca
 *     waste_actual: 3.5,       // %
 *     quality_actual: 98,      // %
 *     spec_actual: 97,         // %
 *     safety_actual: 95,       // điểm
 *     deadline_actual: 100,    // %
 *   }
 * );
 *
 * console.log(`Score: ${score.totalScore}`);
 * console.log(`Bonus: ${score.bonusAmount} VND`);
 */
