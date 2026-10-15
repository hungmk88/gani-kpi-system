import { describe, expect, it } from "vitest";
import {
  bonusMultiplierFor,
  computeFinalScore,
  computeShiftMetrics,
  computeTier1,
  computeTier2,
  tierWeightsFor,
  type ParticipantFacts,
  type ShiftFacts,
} from "@/lib/production/kpi-engine";
import {
  PROBATION_TIER1_COMPONENTS,
  PROBATION_TIER_WEIGHTS,
  TIER1_COMPONENTS,
  TIER1_WEIGHT,
  TIER2_WEIGHT,
} from "@/lib/production/constants";

// Ca mẫu: đạt 120% chỉ tiêu, NVL 90% định mức, lỗi 3% sản lượng thô, 1 vi phạm HACCP
const shift: ShiftFacts = {
  rawOutputKg: 600,
  qcPassedKg: 540,
  reworkKg: 20, // × 0.3 = 6
  scrapKg: 12, // tổng lỗi quy đổi 18 kg = 3%
  haccpViolationCount: 1,
  totalLaborHours: 50,
  downtimeHours: 0,
  targetOutputKg: 450,
  rawMaterialInputKg: 550,
  stdMaterialNormKg: 495,
};

const worker = (patch: Partial<ParticipantFacts> = {}): ParticipantFacts => ({
  userId: "u1",
  stage: "DONG_GOI",
  hoursWorked: 10, // 10 / 50 giờ → quy 108 kg
  scheduledHours: 10,
  personalDefectKg: 0,
  violationCount: 0,
  ...patch,
});

const tier2Of = (f: ShiftFacts) => computeTier2(computeShiftMetrics(f), f);
const partOf = (parts: { key: string }[], key: string) =>
  parts.find((p) => p.key === key) as {
    key: string;
    weight: number;
    nominalWeight: number;
    measured: boolean;
    componentScore: number;
  };

describe("Tầng 2 — kết quả chung cả ca", () => {
  it("cộng có trọng số 35/25/25/15", () => {
    const t2 = tier2Of(shift);
    expect(partOf(t2.parts, "OUTPUT").componentScore).toBe(120);
    expect(partOf(t2.parts, "MATERIAL").componentScore).toBe(90);
    expect(partOf(t2.parts, "QUALITY").componentScore).toBe(70);
    expect(partOf(t2.parts, "SAFETY").componentScore).toBe(50);
    // (120×35 + 90×25 + 70×25 + 50×15) / 100
    expect(t2.score).toBeCloseTo(89.5, 2);
  });

  it("không có chỉ tiêu sản lượng → phần sản lượng 0 điểm (vẫn tính trọng số)", () => {
    const t2 = tier2Of({ ...shift, targetOutputKg: 0 });
    const out = partOf(t2.parts, "OUTPUT");
    expect(out.measured).toBe(true);
    expect(out.componentScore).toBe(0);
  });

  it("sản lượng thô 0 và không lỗi → chất lượng 'không có dữ liệu', chia lại trọng số", () => {
    const t2 = tier2Of({
      ...shift,
      rawOutputKg: 0,
      reworkKg: 0,
      scrapKg: 0,
      qcPassedKg: 450,
      rawMaterialInputKg: 495,
    });
    const q = partOf(t2.parts, "QUALITY");
    expect(q.measured).toBe(false);
    expect(q.weight).toBe(0);
    expect(q.nominalWeight).toBe(25);
    // (100×35 + 100×25 + 50×15) / 75 = 90
    expect(t2.score).toBeCloseTo(90, 2);
  });

  it("sản lượng thô 0 nhưng có phế → chất lượng 0 điểm, không được miễn", () => {
    const t2 = tier2Of({ ...shift, rawOutputKg: 0 });
    const q = partOf(t2.parts, "QUALITY");
    expect(q.measured).toBe(true);
    expect(q.componentScore).toBe(0);
  });
});

describe("Tầng 1 — phần của từng người", () => {
  it("làm đủ giờ, không lỗi, không vi phạm → 100", () => {
    expect(computeTier1(worker(), shift, 50).score).toBe(100);
  });

  it("lỗi công đoạn, thiếu giờ, có vi phạm — chấm theo 50/25/25", () => {
    // lỗi 2.7 / 108 kg = 2.5% → 50 điểm; chuyên cần 8/10 = 80; 1 vi phạm → 66
    const t1 = computeTier1(
      worker({ personalDefectKg: 2.7, hoursWorked: 8, scheduledHours: 10 }),
      shift,
      40 // 8/40 giờ → vẫn quy 108 kg
    );
    expect(partOf(t1.parts, "STAGE_QUALITY").componentScore).toBe(50);
    expect(partOf(t1.parts, "ATTENDANCE").componentScore).toBe(80);
    // (50×50 + 80×25 + 100×25) / 100
    expect(t1.score).toBeCloseTo(70, 2);
    const withViolation = computeTier1(
      worker({ personalDefectKg: 2.7, hoursWorked: 8, scheduledHours: 10, violationCount: 1 }),
      shift,
      40
    );
    expect(withViolation.score).toBeCloseTo((50 * 50 + 80 * 25 + 66 * 25) / 100, 2);
  });

  it("không có giờ công → Tầng 1 = 0, không bao giờ trọn điểm", () => {
    const t1 = computeTier1(worker({ hoursWorked: 0 }), shift, 50);
    expect(t1.score).toBe(0);
  });

  it("chưa khai giờ đăng ký → chuyên cần không có dữ liệu, chia lại trọng số", () => {
    const t1 = computeTier1(worker({ scheduledHours: 0, violationCount: 1 }), shift, 50);
    const att = partOf(t1.parts, "ATTENDANCE");
    expect(att.measured).toBe(false);
    expect(att.weight).toBe(0);
    // (100×50 + 66×25) / 75
    expect(t1.score).toBeCloseTo(88.67, 2);
  });

  it("ca không có thành phẩm đạt: không lỗi → không có dữ liệu; có lỗi → 0 điểm", () => {
    const empty = { ...shift, qcPassedKg: 0 };
    const noDefect = computeTier1(worker({ violationCount: 1 }), empty, 50);
    expect(partOf(noDefect.parts, "STAGE_QUALITY").measured).toBe(false);
    // chỉ còn chuyên cần 100 (25) + kỷ luật 66 (25)
    expect(noDefect.score).toBeCloseTo(83, 2);

    const withDefect = computeTier1(worker({ personalDefectKg: 1 }), empty, 50);
    const sq = partOf(withDefect.parts, "STAGE_QUALITY");
    expect(sq.measured).toBe(true);
    expect(sq.componentScore).toBe(0);
  });

  it("không thành phần nào có dữ liệu → 0, không mặc định 100", () => {
    // Không quy được kg (không lỗi) + chưa khai giờ đăng ký, kỷ luật trọng số 0
    const t1 = computeTier1(worker({ scheduledHours: 0 }), { ...shift, qcPassedKg: 0 }, 50, {
      STAGE_QUALITY: 50,
      ATTENDANCE: 50,
      DISCIPLINE: 0,
    });
    expect(t1.score).toBe(0);
  });
});

describe("Điểm cuối — trọng số theo loại nhân sự", () => {
  const p = worker({ personalDefectKg: 2.7, hoursWorked: 8, scheduledHours: 10, violationCount: 1 });
  const t2 = tier2Of(shift);

  it("chính thức dùng 60/40 và Tầng 1 50/25/25", () => {
    const w = tierWeightsFor("OFFICIAL");
    expect(w.weights).toEqual({ tier1: TIER1_WEIGHT, tier2: TIER2_WEIGHT });
    expect(w.tier1Components).toEqual(TIER1_COMPONENTS);
    const s = computeFinalScore(p, shift, 40, t2, w.weights, w.tier1Components);
    expect(s.tier1Score).toBeCloseTo(61.5, 2);
    // 0.6 × 61.5 + 0.4 × 89.5
    expect(s.finalWeightedScore).toBeCloseTo(72.7, 2);
    expect(s.bonusMultiplier).toBe(0);
  });

  it("thử việc / thời vụ dùng 80/20 và Tầng 1 nghiêng về kỷ luật 35/25/40", () => {
    for (const type of ["PROBATION", "SEASONAL"]) {
      const w = tierWeightsFor(type);
      expect(w.weights).toEqual({
        tier1: PROBATION_TIER_WEIGHTS.TIER1,
        tier2: PROBATION_TIER_WEIGHTS.TIER2,
      });
      expect(w.tier1Components).toEqual(PROBATION_TIER1_COMPONENTS);
      const s = computeFinalScore(p, shift, 40, t2, w.weights, w.tier1Components);
      // (50×35 + 80×25 + 66×40) / 100 = 63.9
      expect(s.tier1Score).toBeCloseTo(63.9, 2);
      // 0.8 × 63.9 + 0.2 × 89.5 = 69.02
      expect(s.finalWeightedScore).toBeCloseTo(69.02, 2);
    }
  });

  it("loại nhân sự lạ / thiếu → trọng số chính thức", () => {
    expect(tierWeightsFor(null).weights).toEqual({ tier1: TIER1_WEIGHT, tier2: TIER2_WEIGHT });
    expect(tierWeightsFor("XYZ").tier1Components).toEqual(TIER1_COMPONENTS);
  });

  it("mặc định (không truyền trọng số) = chính thức, kèm công thức giải thích", () => {
    const s = computeFinalScore(worker(), shift, 50, t2);
    // 0.6 × 100 + 0.4 × 89.5 = 95.8 → bậc 0.7×
    expect(s.finalWeightedScore).toBeCloseTo(95.8, 2);
    expect(s.bonusMultiplier).toBe(0.7);
    expect(s.breakdown.attributedKg).toBe(108);
    expect(s.breakdown.formula).toContain("= 95.8");
  });

  it("bậc thưởng: NaN / âm → 0", () => {
    expect(bonusMultiplierFor(Number.NaN)).toBe(0);
    expect(bonusMultiplierFor(-1)).toBe(0);
    expect(bonusMultiplierFor(110)).toBe(1.5);
  });
});
