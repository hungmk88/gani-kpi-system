import { describe, expect, it } from "vitest";
import { runAntiGamingRules } from "@/lib/production/anti-gaming";
import { computeShiftMetrics, type ShiftFacts } from "@/lib/production/kpi-engine";

// Ca "sạch": đạt chỉ tiêu, NVL trong định mức, có phế, cân đối khớp
const clean: ShiftFacts = {
  rawOutputKg: 500,
  qcPassedKg: 480,
  reworkKg: 10,
  scrapKg: 10,
  haccpViolationCount: 0,
  totalLaborHours: 50,
  downtimeHours: 0,
  targetOutputKg: 450,
  rawMaterialInputKg: 500,
  stdMaterialNormKg: 495, // trần 495 × 1.08 = 534.6
};

const run = (patch: Partial<ShiftFacts>) => {
  const f = { ...clean, ...patch };
  return runAntiGamingRules(f, computeShiftMetrics(f));
};
const types = (patch: Partial<ShiftFacts>) => run(patch).map((x) => x.behaviorType);

describe("chống chạy chỉ tiêu", () => {
  it("ca sạch không bị gắn cờ nào", () => {
    expect(run({})).toEqual([]);
  });

  describe("Luật 1 — đạt sản lượng nhưng phá nguyên liệu", () => {
    it("NVL vượt định mức quá 8% khi đã đạt chỉ tiêu → CRITICAL", () => {
      const f = run({ rawMaterialInputKg: 540 });
      expect(f).toHaveLength(1);
      expect(f[0].behaviorType).toBe("PRODUCTIVITY_VS_MATERIAL_LOSS");
      expect(f[0].severity).toBe("CRITICAL");
    });

    it("vượt trong ngưỡng 8% thì không gắn cờ", () => {
      expect(types({ rawMaterialInputKg: 534 })).toEqual([]);
    });

    it("chưa đạt chỉ tiêu sản lượng thì không phải luật này", () => {
      expect(types({ rawMaterialInputKg: 540, targetOutputKg: 500 })).toEqual([]);
    });

    it("không có định mức NVL thì không xét", () => {
      expect(types({ rawMaterialInputKg: 540, stdMaterialNormKg: 0 })).toEqual([]);
    });
  });

  describe("Luật 2 — phế bằng 0 nhưng làm lại vọt cao", () => {
    it("phế 0, làm lại > 4% thành phẩm → WARNING", () => {
      // 30 kg làm lại / 480 kg đạt = 6.25%; cân đối giữ khớp (480 + 30 + 0)
      const f = run({ scrapKg: 0, reworkKg: 30, rawOutputKg: 510 });
      expect(f.map((x) => x.behaviorType)).toEqual(["REWORK_HIDING_SCRAP"]);
      expect(f[0].severity).toBe("WARNING");
    });

    it("làm lại trong ngưỡng 4% thì không gắn cờ", () => {
      expect(types({ scrapKg: 0, reworkKg: 15, rawOutputKg: 495 })).toEqual([]);
    });

    it("có báo phế thì không phải giấu phế", () => {
      expect(types({ scrapKg: 5, reworkKg: 30, rawOutputKg: 515 })).toEqual([]);
    });
  });

  describe("Luật 3 — lệch cân đối khối lượng", () => {
    it("lệch tuyệt đối > 5 kg → CRITICAL", () => {
      const f = run({ rawOutputKg: 506 }); // tổng KCS 500
      expect(f.map((x) => x.behaviorType)).toEqual(["MASS_BALANCE_MISMATCH"]);
      expect(f[0].severity).toBe("CRITICAL");
    });

    it("mẻ nhỏ lệch tương đối > 2% dù chưa tới 5 kg → vẫn gắn cờ", () => {
      // thô 100, KCS 97 → lệch 3 kg = 3%
      const f = types({
        rawOutputKg: 100,
        qcPassedKg: 90,
        reworkKg: 3,
        scrapKg: 4,
        targetOutputKg: 90,
        rawMaterialInputKg: 100,
        stdMaterialNormKg: 100,
      });
      expect(f).toEqual(["MASS_BALANCE_MISMATCH"]);
    });

    it("lệch nhỏ cả tuyệt đối lẫn tương đối thì bỏ qua", () => {
      expect(types({ rawOutputKg: 504 })).toEqual([]); // 4 kg / 504 = 0.8%
    });
  });

  it("nhiều luật cùng lúc thì trả đủ cả", () => {
    expect(types({ rawMaterialInputKg: 600, rawOutputKg: 520 }).sort()).toEqual([
      "MASS_BALANCE_MISMATCH",
      "PRODUCTIVITY_VS_MATERIAL_LOSS",
    ]);
  });
});
