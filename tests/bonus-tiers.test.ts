import { describe, expect, it } from "vitest";
import { bonusMultiplierFor } from "@/lib/production/kpi-engine";
import {
  BONUS_TIERS,
  PRODUCTION_SCORE_CAP,
  PROBATION_TIER_WEIGHTS,
  TIER1_WEIGHT,
  TIER2_COMPONENTS,
  TIER2_WEIGHT,
} from "@/lib/production/constants";

// Điểm tối đa của từng tầng, suy ra từ chính cấu hình đang dùng:
// Tầng 1 trần 100; Tầng 2: Sản lượng & NVL được vượt tới trần chung,
// Chất lượng & An toàn trần 100 (lib/production/kpi-engine.ts).
const TIER1_MAX = 100;
const TIER2_MAX =
  ((TIER2_COMPONENTS.OUTPUT + TIER2_COMPONENTS.MATERIAL) * PRODUCTION_SCORE_CAP +
    (TIER2_COMPONENTS.QUALITY + TIER2_COMPONENTS.SAFETY) * 100) /
  100;

const maxOfficial = TIER1_MAX * TIER1_WEIGHT + TIER2_MAX * TIER2_WEIGHT;
const maxProbation =
  TIER1_MAX * PROBATION_TIER_WEIGHTS.TIER1 + TIER2_MAX * PROBATION_TIER_WEIGHTS.TIER2;

describe("bậc thưởng ca sản xuất (phương án A)", () => {
  it("điểm tối đa thực tế đúng như tài liệu", () => {
    expect(maxOfficial).toBeCloseTo(112, 5);
    expect(maxProbation).toBeCloseTo(106, 5);
  });

  it("bậc cao nhất (1,5×) người chính thức chạm được", () => {
    const top = BONUS_TIERS[0];
    expect(top.multiplier).toBe(1.5);
    expect(maxOfficial).toBeGreaterThanOrEqual(top.minScore);
    expect(bonusMultiplierFor(maxOfficial)).toBe(1.5);
  });

  it("thử việc / thời vụ tối đa 1,2×", () => {
    expect(bonusMultiplierFor(maxProbation)).toBe(1.2);
  });

  it("ngưỡng từng bậc", () => {
    const cases: [number, number][] = [
      [112, 1.5],
      [110, 1.5],
      [109.99, 1.2],
      [105, 1.2],
      [104.99, 1.0],
      [100, 1.0],
      [99.99, 0.7],
      [90, 0.7],
      [89.99, 0],
      [0, 0],
    ];
    for (const [score, mult] of cases) expect(bonusMultiplierFor(score), `điểm ${score}`).toBe(mult);
  });

  it("điểm không hợp lệ thì không thưởng", () => {
    expect(bonusMultiplierFor(NaN)).toBe(0);
    expect(bonusMultiplierFor(-5)).toBe(0);
  });

  it("bậc xếp giảm dần, bậc cuối từ 0 — mọi điểm hợp lệ đều có bậc", () => {
    for (let i = 1; i < BONUS_TIERS.length; i++) {
      expect(BONUS_TIERS[i].minScore).toBeLessThan(BONUS_TIERS[i - 1].minScore);
    }
    expect(BONUS_TIERS[BONUS_TIERS.length - 1].minScore).toBe(0);
  });
});
