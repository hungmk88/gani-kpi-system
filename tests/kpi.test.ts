import { describe, expect, it } from "vitest";
import {
  calculateKpiScore,
  computeDeadlines,
  detectMismatch,
  spreadPercent,
} from "@/lib/kpi";
import { KPI_SCORE_CAP } from "@/lib/constants";

describe("computeDeadlines — lịch 2-4-5", () => {
  it("KPI tháng 10 chốt 23:59:59 giờ VN ngày 2/4/5 tháng 11", () => {
    const d = computeDeadlines(10, 2026);
    expect(d.selfReviewDeadline.toISOString()).toBe("2026-11-02T16:59:59.000Z");
    expect(d.managerReviewDeadline.toISOString()).toBe("2026-11-04T16:59:59.000Z");
    expect(d.ceoApprovalDeadline.toISOString()).toBe("2026-11-05T16:59:59.000Z");
  });

  it("KPI tháng 12 chốt sang tháng 1 năm sau", () => {
    const d = computeDeadlines(12, 2026);
    expect(d.selfReviewDeadline.toISOString()).toBe("2027-01-02T16:59:59.000Z");
  });
});

describe("calculateKpiScore", () => {
  const base = { weight: 20, cap: KPI_SCORE_CAP };

  it("càng cao càng tốt: 120% mục tiêu", () => {
    const r = calculateKpiScore({ ...base, target: 100, actual: 120, isHigherBetter: true });
    expect(r.achievementPercent).toBe(120);
    expect(r.weightedScore).toBe(24);
  });

  it("chặn trần 150%", () => {
    const r = calculateKpiScore({ ...base, target: 100, actual: 300, isHigherBetter: true });
    expect(r.achievementPercent).toBe(KPI_SCORE_CAP);
    expect(r.isCapped).toBe(true);
  });

  it("thiếu số liệu (null) thì 0 điểm — không bao giờ được điểm trần", () => {
    for (const isHigherBetter of [true, false]) {
      const r = calculateKpiScore({ ...base, target: 1.5, actual: null, isHigherBetter });
      expect(r.weightedScore).toBe(0);
    }
  });

  it("càng thấp càng tốt: thực tế 0 với mục tiêu 0 là đạt 100%", () => {
    const r = calculateKpiScore({ ...base, target: 0, actual: 0, isHigherBetter: false });
    expect(r.achievementPercent).toBe(100);
  });

  it("càng thấp càng tốt: lỗi gấp đôi mục tiêu thì 50%", () => {
    const r = calculateKpiScore({ ...base, target: 1, actual: 2, isHigherBetter: false });
    expect(r.achievementPercent).toBe(50);
  });
});

describe("ngưỡng lệch ±5% — một công thức cho cả hệ thống", () => {
  it("spreadPercent", () => {
    expect(spreadPercent([100, 105])).toBeCloseTo(4.76, 2);
    expect(spreadPercent([100])).toBe(0);
  });

  it("detectMismatch dùng đúng spreadPercent", () => {
    // 105.2 vs 100: spread 4.94% -> KHÔNG lệch (trước đây dashboard báo đỏ
    // trong khi đối soát coi là khớp)
    expect(detectMismatch(100, 105.2).hasMismatch).toBe(false);
    expect(detectMismatch(100, 106).hasMismatch).toBe(true);
    expect(detectMismatch(100, 106).mismatchPercent).toBe(6);
    expect(detectMismatch(null, 5).hasMismatch).toBe(false);
  });
});
