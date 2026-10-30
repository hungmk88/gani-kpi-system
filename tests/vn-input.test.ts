import { describe, expect, it } from "vitest";
import { isoToVnLocal, vnLocalToIso } from "@/lib/vn-input";

describe("vn-input: ô datetime-local theo giờ VN", () => {
  it("17:00 giờ VN = 10:00 UTC, không phụ thuộc múi giờ máy", () => {
    expect(vnLocalToIso("2026-11-02T17:00")).toBe("2026-11-02T10:00:00.000Z");
    // Qua nửa đêm UTC: 06:30 sáng VN ngày 1 = 23:30 UTC ngày hôm trước
    expect(vnLocalToIso("2026-01-01T06:30")).toBe("2025-12-31T23:30:00.000Z");
  });

  it("chuỗi sai / ngày không có thật → null", () => {
    expect(vnLocalToIso("")).toBeNull();
    expect(vnLocalToIso("02/11/2026 17:00")).toBeNull();
    expect(vnLocalToIso("2026-02-31T08:00")).toBeNull();
    expect(vnLocalToIso("2026-13-01T08:00")).toBeNull();
  });

  it("ISO → chuỗi ô nhập theo giờ VN, đi vòng không lệch", () => {
    expect(isoToVnLocal("2025-12-31T23:30:00.000Z")).toBe("2026-01-01T06:30");
    expect(isoToVnLocal(null)).toBe("");
    expect(isoToVnLocal("không phải ngày")).toBe("");
    const s = "2026-11-02T17:05";
    expect(isoToVnLocal(vnLocalToIso(s)!)).toBe(s);
  });
});
