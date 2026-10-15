import { describe, expect, it } from "vitest";
import {
  classifyScoreFor,
  combineScoreStates,
  scoreStateOf,
  calculateKpiScore,
  computeDeadlines,
  detectMismatch,
  gatekeeperOutcome,
  gatekeeperRuleFor,
  kpiCapFor,
  spreadPercent,
} from "@/lib/kpi";
import { KPI_SCORE_CAP, SALES_KPI_CAP } from "@/lib/constants";

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

describe("scoreStateOf / classifyScoreFor — không xếp loại khi kỳ chưa chấm", () => {
  it("chưa ai khai → UNSCORED, nhãn 'Chưa chấm', không phải 'Không đạt'", () => {
    const rows = [{ status: "DRAFT" }, { status: "DRAFT" }];
    expect(scoreStateOf("OPEN", rows)).toBe("UNSCORED");
    expect(classifyScoreFor(0, "UNSCORED").label).toBe("Chưa chấm");
    expect(classifyScoreFor(0, "UNSCORED").tone).toBe("slate");
  });

  it("đã có dòng qua bước khai nhưng kỳ chưa chốt → PROVISIONAL, chưa xếp loại", () => {
    const rows = [{ status: "SELF_REVIEWED" }, { status: "DRAFT" }];
    expect(scoreStateOf("OPEN", rows)).toBe("PROVISIONAL");
    expect(classifyScoreFor(42, "PROVISIONAL").label).toBe("Tạm tính");
  });

  it("kỳ đã chốt → FINAL, xếp loại như cũ", () => {
    const rows = [{ status: "FINALIZED" }];
    expect(scoreStateOf("FINALIZED", rows)).toBe("FINAL");
    expect(classifyScoreFor(50, "FINAL").label).toBe("Không đạt");
    expect(classifyScoreFor(105, "FINAL").label).toBe("Tốt");
  });

  it("mọi dòng đã khoá dù kỳ chưa đóng hẳn → FINAL", () => {
    expect(scoreStateOf("MANAGER_LOCKED", [{ status: "FINALIZED" }])).toBe("FINAL");
  });

  it("không có dòng nào → UNSCORED", () => {
    expect(scoreStateOf("FINALIZED", [])).toBe("UNSCORED");
  });

  it("gộp nhiều nhóm: chỉ FINAL khi tất cả FINAL", () => {
    expect(combineScoreStates(["FINAL", "FINAL"])).toBe("FINAL");
    expect(combineScoreStates(["FINAL", "UNSCORED"])).toBe("PROVISIONAL");
    expect(combineScoreStates(["UNSCORED", "UNSCORED"])).toBe("UNSCORED");
  });
});

describe("trần theo chỉ tiêu & gatekeeper", () => {
  it("trần theo phòng SỞ HỮU chỉ tiêu: Sales 120%, còn lại 150%", () => {
    expect(kpiCapFor("SALES")).toBe(SALES_KPI_CAP);
    expect(kpiCapFor("PRODUCTION")).toBe(KPI_SCORE_CAP);
    expect(kpiCapFor(null)).toBe(KPI_SCORE_CAP);
  });

  it("chỉ SALES_RETURN là gatekeeper: ngưỡng 2%, trừ 5 điểm", () => {
    expect(gatekeeperRuleFor("SALES_RETURN")).toEqual({ thresholdPercent: 2, penaltyPoints: 5 });
    expect(gatekeeperRuleFor("SALES_REVENUE")).toBeNull();
    expect(gatekeeperRuleFor(undefined)).toBeNull();
  });

  it("đúng bằng ngưỡng vẫn đạt; vượt mới bị trừ; chưa có số thì chưa kết luận", () => {
    const rule = gatekeeperRuleFor("SALES_RETURN")!;
    expect(gatekeeperOutcome(rule, 0)).toBe("PASS");
    expect(gatekeeperOutcome(rule, 2)).toBe("PASS");
    expect(gatekeeperOutcome(rule, 2.01)).toBe("FAIL");
    expect(gatekeeperOutcome(rule, null)).toBe("NO_DATA");
  });
});
