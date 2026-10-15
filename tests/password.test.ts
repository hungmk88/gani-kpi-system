import { describe, expect, it } from "vitest";
import {
  checkPasswordStrength,
  PASSWORD_MIN_LENGTH,
  SAMPLE_PASSWORDS,
} from "@/lib/password";

const good = "Kh0ng-De-Doan";

describe("checkPasswordStrength", () => {
  it("chấp nhận mật khẩu đủ mạnh", () => {
    expect(checkPasswordStrength(good)).toEqual({ ok: true });
  });

  it(`từ chối mật khẩu ngắn hơn ${PASSWORD_MIN_LENGTH} ký tự`, () => {
    const r = checkPasswordStrength("Ab1".padEnd(PASSWORD_MIN_LENGTH - 1, "x"));
    expect(r.ok).toBe(false);
    // đúng ngưỡng thì qua
    expect(
      checkPasswordStrength("Ab1".padEnd(PASSWORD_MIN_LENGTH, "x")).ok
    ).toBe(true);
  });

  it("từ chối mật khẩu dài quá 200 ký tự", () => {
    expect(checkPasswordStrength("a1".repeat(101)).ok).toBe(false);
  });

  it("từ chối mật khẩu có khoảng trắng", () => {
    expect(checkPasswordStrength("abc def 12345").ok).toBe(false);
    expect(checkPasswordStrength("abcdef\t12345").ok).toBe(false);
  });

  it("bắt buộc có chữ cái", () => {
    expect(checkPasswordStrength("1234567890!@#").ok).toBe(false);
  });

  it("bắt buộc có chữ số", () => {
    expect(checkPasswordStrength("KhongCoChuSo!").ok).toBe(false);
  });

  it('từ chối mật khẩu mẫu đã công bố "Gani@2026" (mọi kiểu hoa/thường)', () => {
    expect(checkPasswordStrength("Gani@2026").ok).toBe(false);
    expect(checkPasswordStrength("GANI@2026").ok).toBe(false);
    expect(checkPasswordStrength("gani@2026").ok).toBe(false);
  });

  it("từ chối mọi mật khẩu trong danh sách mẫu", () => {
    for (const p of SAMPLE_PASSWORDS) {
      expect(checkPasswordStrength(p).ok, p).toBe(false);
    }
  });

  it("từ chối mật khẩu chứa phần trước @ của email", () => {
    const r = checkPasswordStrength("trinh.nguyen2026", {
      email: "trinh.nguyen@ganifoody.vn",
    });
    expect(r.ok).toBe(false);
  });

  it("phần email quá ngắn (< 4 ký tự) thì không xét", () => {
    expect(
      checkPasswordStrength("abcXyz12345", { email: "abc@ganifoody.vn" }).ok
    ).toBe(true);
  });

  it("từ chối mật khẩu chứa tên riêng (không phân biệt hoa thường)", () => {
    const r = checkPasswordStrength("Thanh2026!xyz", { fullName: "Nguyễn Văn Thanh" });
    expect(r.ok).toBe(false);
  });

  it("phần tên ngắn (< 4 ký tự) không bị xét", () => {
    expect(
      checkPasswordStrength("vanAbc12345", { fullName: "Lê Văn An" }).ok
    ).toBe(true);
  });

  it("trả kèm lý do khi từ chối", () => {
    const r = checkPasswordStrength("short1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
  });
});
