import { describe, expect, it } from "vitest";
import { computeHealth, detectAnomaly, median } from "@/lib/analytics/engine";
import { ANOMALY_MIN_SAMPLES, HEALTH_WEIGHTS } from "@/lib/analytics/constants";

describe("phát hiện bất thường KPI", () => {
  it("chưa đủ lịch sử → không kết luận, độ tin NONE", () => {
    const r = detectAnomaly(1000, [100, 100, 100]);
    expect(ANOMALY_MIN_SAMPLES.ANY).toBe(4);
    expect(r.isAnomaly).toBe(false);
    expect(r.severity).toBeNull();
    expect(r.confidence).toBe("NONE");
    expect(r.sampleSize).toBe(3);
    expect(r.reason).toContain("Mới có 3 kỳ");
  });

  it("không có lịch sử cũng không kết luận", () => {
    const r = detectAnomaly(50, []);
    expect(r.isAnomaly).toBe(false);
    expect(r.confidence).toBe("NONE");
    expect(r.sampleSize).toBe(0);
  });

  it("số nằm trong khoảng bình thường → không bất thường", () => {
    const r = detectAnomaly(100, [100, 102, 98, 101, 99]);
    expect(r.isAnomaly).toBe(false);
    expect(r.severity).toBeNull();
    expect(r.confidence).toBe("MEDIUM");
    expect(r.historicalMedian).toBe(100);
  });

  it("đột biến khi dữ liệu còn mỏng → tối đa mức WARNING", () => {
    const r = detectAnomaly(300, [100, 102, 98, 101]);
    expect(r.isAnomaly).toBe(true);
    expect(r.severity).toBe("WARNING");
    expect(r.confidence).toBe("MEDIUM");
    expect(r.reason).toContain("chưa đủ để kết luận nặng");
  });

  it("đột biến với đủ lịch sử và hai thước cùng đồng ý → CRITICAL", () => {
    const r = detectAnomaly(300, [100, 102, 98, 101, 99, 100]);
    expect(r.isAnomaly).toBe(true);
    expect(r.severity).toBe("CRITICAL");
    expect(r.confidence).toBe("HIGH");
    expect(r.robustScore).toBeGreaterThan(3.5);
    expect(r.zScore).toBeGreaterThan(2.5);
  });

  it("đột biến thấp hơn hẳn cũng bị bắt", () => {
    const r = detectAnomaly(10, [100, 102, 98, 101, 99, 100]);
    expect(r.isAnomaly).toBe(true);
    expect(r.reason).toContain("thấp hơn");
  });

  it("lịch sử phẳng (MAD = 0): lệch khỏi trung vị đáng chú ý nhưng không thổi thành vô cực", () => {
    const r = detectAnomaly(60, [50, 50, 50, 50, 50, 50]);
    expect(r.isAnomaly).toBe(true);
    expect(Number.isFinite(r.robustScore)).toBe(true);
    expect(r.zScore).toBe(0);
    // chỉ thước bền vượt ngưỡng → chưa đồng thuận → WARNING
    expect(r.severity).toBe("WARNING");

    const same = detectAnomaly(50, [50, 50, 50, 50, 50, 50]);
    expect(same.isAnomaly).toBe(false);
  });

  it("vượt gấp 2.5 lần trung vị → gắn cờ theo tỷ lệ", () => {
    // lịch sử rải rộng nên z và thước bền đều không vượt, chỉ còn luật tỷ lệ
    const r = detectAnomaly(240, [10, 200, 100, 30, 150, 60]);
    expect(r.historicalMedian).toBe(80);
    expect(r.zScore).toBeLessThan(2.5);
    expect(r.robustScore).toBeLessThan(3.5);
    expect(r.isAnomaly).toBe(true);
  });
});

describe("median", () => {
  it("chẵn / lẻ / rỗng", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe("điểm sức khoẻ vận hành", () => {
  const perfect = {
    openTasks: 0,
    overdueTasks: 0,
    criticalRiskTasks: 0,
    overloadedPeople: 0,
    totalPeople: 0,
    mismatchCells: 0,
    totalKpiCells: 0,
    openAnomalies: 0,
  };

  it("trọng số lấy đúng từ HEALTH_WEIGHTS", () => {
    const h = computeHealth(perfect);
    expect(h.score).toBe(100);
    for (const p of h.parts) {
      expect(p.weight).toBe(HEALTH_WEIGHTS[p.key as keyof typeof HEALTH_WEIGHTS]);
    }
    expect(h.parts.map((p) => p.key).sort()).toEqual(Object.keys(HEALTH_WEIGHTS).sort());
  });

  it("một nửa việc quá hạn → mất nửa trọng số phần bám hạn", () => {
    const h = computeHealth({ ...perfect, openTasks: 10, overdueTasks: 5 });
    expect(h.score).toBeCloseTo(100 - HEALTH_WEIGHTS.ON_TIME_TASKS / 2, 1);
  });
});
