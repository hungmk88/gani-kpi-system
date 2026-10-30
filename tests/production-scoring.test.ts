import { describe, expect, it } from "vitest";
import {
  hasMissingResults,
  mapWithConcurrency,
  planShiftScoring,
  type ScoringShiftInput,
} from "@/lib/production/scoring";
import { staleProductionCells } from "@/lib/production/bridge";
import type { ShiftFacts } from "@/lib/production/kpi-engine";

// Chấm điểm ca đã khoá: TÍNH hết bằng hàm thuần trước, rồi máy chủ ghi một
// lần trong một transaction (xem executeCalculationAndAudit).

const clean: ShiftFacts = {
  rawOutputKg: 430,
  qcPassedKg: 400,
  reworkKg: 20,
  scrapKg: 10,
  haccpViolationCount: 0,
  totalLaborHours: 20,
  downtimeHours: 1,
  targetOutputKg: 400,
  rawMaterialInputKg: 432,
  stdMaterialNormKg: 432,
};

const people: ScoringShiftInput["participants"] = [
  {
    userId: "a",
    stage: "TAO_HINH",
    hoursWorked: 10,
    scheduledHours: 10,
    personalDefectKg: 2,
    violationCount: 0,
    employmentType: "OFFICIAL",
  },
  {
    userId: "b",
    stage: "DONG_GOI",
    hoursWorked: 10,
    scheduledHours: 10,
    personalDefectKg: 8,
    violationCount: 1,
    employmentType: "OFFICIAL",
  },
];

describe("kế hoạch chấm điểm một ca", () => {
  it("ca sạch: chấm đủ người, không khoá thưởng, cùng điểm Tầng 2", () => {
    const plan = planShiftScoring({
      facts: clean,
      totalLaborHours: 20,
      participants: people,
      handledAudits: [],
    });
    expect(plan.findings).toEqual([]);
    expect(plan.bonusLocked).toBe(false);
    expect(plan.scores.map((s) => s.userId)).toEqual(["a", "b"]);
    expect(plan.scores[0].score.tier2Score).toBe(plan.scores[1].score.tier2Score);
    expect(plan.scores[1].score.tier1Score).toBeLessThan(plan.scores[0].score.tier1Score);
    expect(plan.scores[0].finalBonusVnd).toBe(plan.scores[0].score.finalBonusVnd);
  });

  it("có cảnh báo mới: khoá thưởng, thưởng ghi 0", () => {
    // NVL vượt định mức xa → Luật 1
    const facts = { ...clean, rawMaterialInputKg: 600 };
    const plan = planShiftScoring({
      facts,
      totalLaborHours: 20,
      participants: people,
      handledAudits: [],
    });
    expect(plan.newFindings.length).toBeGreaterThan(0);
    expect(plan.bonusLocked).toBe(true);
    expect(plan.scores.every((s) => s.finalBonusVnd === 0)).toBe(true);
  });

  it("khoá lại sau mở lại: luật đã được BGĐ chấp nhận không mọc lại, không khoá thưởng", () => {
    const facts = { ...clean, rawMaterialInputKg: 600 };
    const first = planShiftScoring({
      facts,
      totalLaborHours: 20,
      participants: people,
      handledAudits: [],
    });
    const plan = planShiftScoring({
      facts,
      totalLaborHours: 20,
      participants: people,
      handledAudits: first.findings.map((f) => ({
        behaviorType: f.behaviorType,
        status: "CEO_APPROVED",
      })),
    });
    expect(plan.newFindings).toEqual([]);
    expect(plan.bonusLocked).toBe(false);
  });

  it("cảnh báo cũ bị BGĐ từ chối vẫn khoá thưởng khi chấm lại", () => {
    const plan = planShiftScoring({
      facts: clean,
      totalLaborHours: 20,
      participants: people,
      handledAudits: [{ behaviorType: "PRODUCTIVITY_VS_MATERIAL_LOSS", status: "REJECTED" }],
    });
    expect(plan.bonusLocked).toBe(true);
  });
});

describe("tự chữa: ca khoá còn người chưa có điểm", () => {
  it("thiếu một người → cần chấm lại; đủ người → không", () => {
    expect(hasMissingResults(["a", "b"], ["a"])).toBe(true);
    expect(hasMissingResults(["a", "b"], [])).toBe(true);
    expect(hasMissingResults(["a", "b"], ["b", "a"])).toBe(false);
    // Dòng điểm của người đã bị gỡ khỏi ca không bù cho người còn thiếu
    expect(hasMissingResults(["a", "b"], ["a", "x"])).toBe(true);
  });
});

describe("gửi thông báo có giới hạn song song", () => {
  it("không quá `limit` việc cùng lúc, giữ thứ tự kết quả, lỗi không làm hỏng cả lượt", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      if (n === 4) throw new Error("Telegram lỗi");
      return n * 10;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(out.map((r) => r.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "fulfilled",
      "rejected",
      "fulfilled",
      "fulfilled",
      "fulfilled",
    ]);
    expect((out[0] as PromiseFulfilledResult<number>).value).toBe(10);
    expect((out[6] as PromiseFulfilledResult<number>).value).toBe(70);
  });

  it("danh sách rỗng: trả rỗng", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});

describe("cầu nối KPI tháng — ô production không còn căn cứ", () => {
  it("người không còn ca khoá: ô có số khác 0 được đưa về 0; ô đã 0 thì thôi", () => {
    const last = new Map([
      ["a@x.vn|d1", 120],
      ["a@x.vn|d2", 0],
      ["b@x.vn|d1", 50],
    ]);
    const stale = staleProductionCells(last, new Set(["b@x.vn|d1"]));
    expect(stale).toEqual([{ email: "a@x.vn", defId: "d1" }]);
  });

  it("còn ca khoá thì không đụng", () => {
    const last = new Map([["a@x.vn|d1", 120]]);
    expect(staleProductionCells(last, new Set(["a@x.vn|d1"]))).toEqual([]);
  });
});
