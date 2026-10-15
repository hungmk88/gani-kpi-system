import { describe, expect, it } from "vitest";
import { normalizeEmployeeCode } from "@/lib/employee-code";

describe("normalizeEmployeeCode", () => {
  it("viết hoa, bỏ khoảng trắng hai đầu", () => {
    expect(normalizeEmployeeCode("  nv0012 ")).toEqual({ ok: true, value: "NV0012" });
    expect(normalizeEmployeeCode("sx-01.a_2")).toEqual({ ok: true, value: "SX-01.A_2" });
  });
  it("rỗng là không có mã", () => {
    expect(normalizeEmployeeCode("")).toEqual({ ok: true, value: null });
    expect(normalizeEmployeeCode("   ")).toEqual({ ok: true, value: null });
    expect(normalizeEmployeeCode(null)).toEqual({ ok: true, value: null });
  });
  it("từ chối dấu, khoảng trắng giữa, ký tự lạ, quá dài", () => {
    expect(normalizeEmployeeCode("NV 01").ok).toBe(false);
    expect(normalizeEmployeeCode("Mã01").ok).toBe(false);
    expect(normalizeEmployeeCode("-NV01").ok).toBe(false);
    expect(normalizeEmployeeCode("A".repeat(33)).ok).toBe(false);
  });
});
