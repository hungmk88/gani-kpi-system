import { describe, expect, it } from "vitest";
import {
  pickClosingPeriod,
  pickCurrentMonthPeriod,
  pickDeadlinePeriod,
} from "@/lib/services/period-service";
import { vnDate } from "@/lib/vn-time";

type P = { id: string; month: number; year: number; status: string };
const p = (year: number, month: number, status = "OPEN"): P => ({
  id: `${year}-${month}`,
  year,
  month,
  status,
});

// Mốc giờ VN; 00:30 ngày 1 VN vẫn là 17:30 ngày cuối tháng trước theo UTC —
// chọn đúng kỳ phải theo lịch VN, không theo giờ server.
const at = (y: number, m: number, d: number, h = 9) => vnDate(y, m, d, h);

describe("chọn kỳ KPI", () => {
  const sep = p(2026, 9, "MANAGER_LOCKED");
  const oct = p(2026, 10, "OPEN");

  it("ngày 3/10: kỳ đang chốt là tháng 9, không phải kỳ tháng 10 mới mở", () => {
    expect(pickClosingPeriod([oct, sep], at(2026, 10, 3))?.id).toBe("2026-9");
    expect(pickDeadlinePeriod([oct, sep], at(2026, 10, 3))?.id).toBe("2026-9");
  });

  it("00:30 ngày 1 giờ VN đã là tháng mới", () => {
    expect(pickCurrentMonthPeriod([oct, sep], at(2026, 10, 1, 0))?.id).toBe("2026-10");
    expect(pickClosingPeriod([oct, sep], at(2026, 10, 1, 0))?.id).toBe("2026-9");
  });

  it("kỳ trước đã chốt xong -> về kỳ tháng hiện tại", () => {
    const sepDone = p(2026, 9, "FINALIZED");
    expect(pickClosingPeriod([oct, sepDone], at(2026, 10, 4))?.id).toBe("2026-10");
  });

  it("nhiều kỳ cũ chưa chốt -> lấy kỳ cũ nhất", () => {
    const aug = p(2026, 8, "MANAGER_LOCKED");
    expect(pickClosingPeriod([oct, sep, aug], at(2026, 10, 3))?.id).toBe("2026-8");
  });

  it("sau ngày 5: hiển thị hạn theo kỳ tháng hiện tại dù kỳ trước còn treo", () => {
    expect(pickDeadlinePeriod([oct, sep], at(2026, 10, 6))?.id).toBe("2026-10");
    // còn hàng chờ duyệt thì vẫn là kỳ tháng 9
    expect(pickClosingPeriod([oct, sep], at(2026, 10, 6))?.id).toBe("2026-9");
  });

  it("qua năm: tháng 12 đang chốt vào đầu tháng 1", () => {
    const dec = p(2025, 12, "SELF_LOCKED");
    const jan = p(2026, 1, "OPEN");
    expect(pickClosingPeriod([jan, dec], at(2026, 1, 2))?.id).toBe("2025-12");
    expect(pickDeadlinePeriod([jan, dec], at(2026, 1, 2))?.id).toBe("2025-12");
  });

  it("chưa có kỳ tháng này -> kỳ gần nhất không ở tương lai", () => {
    const aug = p(2026, 8, "FINALIZED");
    const sepDone = p(2026, 9, "FINALIZED");
    const dec = p(2026, 12, "OPEN");
    expect(pickDeadlinePeriod([aug, sepDone, dec], at(2026, 10, 20))?.id).toBe("2026-9");
    expect(pickClosingPeriod([aug, sepDone, dec], at(2026, 10, 3))?.id).toBe("2026-9");
  });

  it("chỉ có kỳ tương lai -> kỳ sớm nhất; không có kỳ nào -> null", () => {
    const nov = p(2026, 11);
    const dec = p(2026, 12);
    expect(pickClosingPeriod([dec, nov], at(2026, 10, 3))?.id).toBe("2026-11");
    expect(pickClosingPeriod([], at(2026, 10, 3))).toBeNull();
    expect(pickCurrentMonthPeriod([dec, nov], at(2026, 10, 3))).toBeNull();
  });

  it("kỳ tương lai chưa chốt không bị coi là kỳ đang chốt", () => {
    const nov = p(2026, 11, "OPEN");
    expect(pickClosingPeriod([nov, oct], at(2026, 10, 3))?.id).toBe("2026-10");
  });
});
