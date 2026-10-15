import { describe, expect, it } from "vitest";
import {
  formatVnDate,
  formatVnDateTime,
  parseVnDate,
  vnDate,
  vnDateKey,
  vnDayDiff,
  vnDayRange,
  vnHalfOfYear,
  vnMonthRange,
  vnParts,
  vnStartOfDay,
} from "@/lib/vn-time";

// Các test này phải xanh bất kể máy chạy ở múi giờ nào — CI chạy cả TZ=UTC
// lẫn TZ=Asia/Ho_Chi_Minh.

describe("vn-time", () => {
  it("vnDate trả mốc UTC đúng của giờ Việt Nam", () => {
    expect(vnDate(2026, 10, 1).toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(vnDate(2026, 11, 2, 23, 59, 59).toISOString()).toBe("2026-11-02T16:59:59.000Z");
  });

  it("vnDate tự cuộn tháng 13 sang năm sau", () => {
    expect(vnDate(2026, 13, 2).toISOString()).toBe(vnDate(2027, 1, 2).toISOString());
  });

  it("vnParts đọc ngày theo lịch VN, không theo UTC", () => {
    // 20:00Z ngày 30/09 = 03:00 sáng 01/10 ở VN
    const p = vnParts(new Date("2026-09-30T20:00:00Z"));
    expect([p.year, p.month, p.day, p.hour]).toEqual([2026, 10, 1, 3]);
  });

  it("vnStartOfDay / vnDayRange", () => {
    const d = new Date("2026-09-30T20:00:00Z");
    expect(vnStartOfDay(d).toISOString()).toBe("2026-09-30T17:00:00.000Z");
    const r = vnDayRange(d);
    expect(r.lt.getTime() - r.gte.getTime()).toBe(86_400_000);
  });

  it("vnMonthRange bao trọn tháng VN", () => {
    const r = vnMonthRange(2026, 12);
    expect(r.gte.toISOString()).toBe("2026-11-30T17:00:00.000Z");
    expect(r.lt.toISOString()).toBe("2026-12-31T17:00:00.000Z");
  });

  it("parseVnDate nhận cả YYYY-MM-DD và ISO đầy đủ", () => {
    expect(parseVnDate("2026-10-16").toISOString()).toBe("2026-10-15T17:00:00.000Z");
    // ISO 00:00 giờ VN do trình duyệt gửi (kiểu cũ) -> vẫn đúng ngày 16
    expect(parseVnDate("2026-10-15T17:00:00.000Z").toISOString()).toBe(
      "2026-10-15T17:00:00.000Z"
    );
    expect(() => parseVnDate("không phải ngày")).toThrow();
  });

  it("định dạng hiển thị", () => {
    const d = new Date("2026-10-15T17:30:00Z");
    expect(formatVnDate(d)).toBe("16/10/2026");
    expect(formatVnDateTime(d)).toBe("16/10/2026 · 00:30");
    expect(vnDateKey(d)).toBe("2026-10-16");
    expect(formatVnDate(null)).toBe("—");
  });

  it("vnDayDiff đếm ngày lịch, bỏ qua giờ", () => {
    expect(vnDayDiff(vnDate(2026, 10, 16, 23), vnDate(2026, 10, 17, 1))).toBe(1);
    expect(vnDayDiff(vnDate(2026, 10, 16), vnDate(2026, 10, 16, 22))).toBe(0);
  });

  it("vnHalfOfYear", () => {
    expect(vnHalfOfYear(vnDate(2026, 6, 30, 23))).toBe(1);
    expect(vnHalfOfYear(vnDate(2026, 7, 1))).toBe(2);
  });
});
