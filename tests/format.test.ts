import { describe, expect, it } from "vitest";
import { fmtDeadline, fmtKg, fmtNum, fmtPct, fmtScore, fmtVnd } from "@/lib/format";
import { vnDate } from "@/lib/vn-time";

describe("format", () => {
  it("số theo kiểu Việt, rỗng thành —", () => {
    expect(fmtNum(1234.5)).toBe("1.234,5");
    expect(fmtNum(null)).toBe("—");
    expect(fmtNum(Number.NaN)).toBe("—");
    expect(fmtScore(98.5)).toBe("98,50");
  });

  it("phần trăm có dấu khi cần", () => {
    expect(fmtPct(98.46)).toBe("98,5%");
    expect(fmtPct(7, { signed: true })).toBe("+7%");
    expect(fmtPct(-3.25, { signed: true })).toBe("−3,3%");
  });

  it("tiền đầy đủ và rút gọn", () => {
    expect(fmtVnd(1250000)).toBe("1.250.000 ₫");
    expect(fmtVnd(1250000, { compact: true })).toBe("1,25 tr ₫");
    expect(fmtVnd(3_400_000_000, { compact: true })).toBe("3,4 tỷ ₫");
    expect(fmtVnd(850000, { compact: true })).toBe("850.000 ₫");
  });

  it("khối lượng kg / tấn", () => {
    expect(fmtKg(850.54)).toBe("850,5 kg");
    expect(fmtKg(1250)).toBe("1,25 tấn");
    expect(fmtKg(1250, { unit: "kg" })).toBe("1.250 kg");
  });

  it("hạn chót theo ngày lịch VN", () => {
    const now = vnDate(2026, 10, 15, 9, 0, 0);
    expect(fmtDeadline(vnDate(2026, 10, 20, 17, 0, 0), { now }).relative).toBe("còn 5 ngày");
    expect(fmtDeadline(vnDate(2026, 10, 16, 8, 0, 0), { now }).relative).toBe("ngày mai");
    expect(fmtDeadline(vnDate(2026, 10, 15, 17, 0, 0), { now })).toMatchObject({ relative: "hôm nay", late: false });
    expect(fmtDeadline(vnDate(2026, 10, 15, 8, 0, 0), { now })).toMatchObject({ relative: "trễ hôm nay", late: true });
    expect(fmtDeadline(vnDate(2026, 10, 12, 17, 0, 0), { now })).toMatchObject({ relative: "trễ 3 ngày", late: true });
    expect(fmtDeadline(vnDate(2026, 10, 12), { now, done: true }).relative).toBeNull();
    expect(fmtDeadline(null).date).toBe("—");
  });
});
