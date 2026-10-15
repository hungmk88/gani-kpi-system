import { describe, expect, it } from "vitest";
import { formatVnNumber, parseVnNumber } from "@/lib/vn-number";

describe("parseVnNumber", () => {
  it("đọc dấu chấm hàng nghìn, dấu phẩy thập phân", () => {
    expect(parseVnNumber("135.000.000")).toBe(135_000_000);
    expect(parseVnNumber("7,5")).toBe(7.5);
    expect(parseVnNumber("1.234.567,89")).toBe(1234567.89);
    expect(parseVnNumber("1.500")).toBe(1500);
    expect(parseVnNumber(",5")).toBe(0.5);
  });

  it("vẫn nhận kiểu gõ máy tính", () => {
    expect(parseVnNumber("1234.5")).toBe(1234.5);
    expect(parseVnNumber("12.5")).toBe(12.5);
    expect(parseVnNumber("0.125")).toBe(0.125);
    expect(parseVnNumber("135000000")).toBe(135_000_000);
    expect(parseVnNumber("  42 ")).toBe(42);
    expect(parseVnNumber("0")).toBe(0);
  });

  it("đọc được số âm (nơi gọi tự chặn)", () => {
    expect(parseVnNumber("-3,5")).toBe(-3.5);
    expect(parseVnNumber("-0")).toBe(0);
  });

  it("trả null khi để trống hoặc không phải số", () => {
    for (const s of ["", "   ", "-", "abc", "12a", "1,2,3", "1.23.4", "1,", "1.", "1.2,3.4", "1e5", "+5", "Infinity"]) {
      expect(parseVnNumber(s), s).toBeNull();
    }
  });
});

describe("formatVnNumber", () => {
  it("hiển thị kiểu Việt, không làm tròn", () => {
    expect(formatVnNumber(135_000_000)).toBe("135.000.000");
    expect(formatVnNumber(7.5)).toBe("7,5");
    expect(formatVnNumber(1234.5678)).toBe("1.234,5678");
    expect(formatVnNumber(0)).toBe("0");
    expect(formatVnNumber(-1500)).toBe("-1.500");
  });

  it("đi một vòng format → parse ra lại đúng số", () => {
    for (const n of [0, 1, 2.125, 0.1, 999, 1000, 1500.25, 135_000_000, 0.30000000000000004]) {
      expect(parseVnNumber(formatVnNumber(n))).toBe(n);
    }
  });
});
