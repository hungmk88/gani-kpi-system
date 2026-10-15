import { afterEach, describe, expect, it } from "vitest";
import { safeEqual, strongSecret } from "@/lib/secrets";

const KEY = "TEST_STRONG_SECRET_FOR_VITEST";

describe("strongSecret — từ chối secret yếu", () => {
  afterEach(() => {
    delete process.env[KEY];
  });

  it("thiếu biến môi trường -> null", () => {
    delete process.env[KEY];
    expect(strongSecret(KEY, 16)).toBeNull();
  });

  it("chuỗi rỗng -> null", () => {
    process.env[KEY] = "";
    expect(strongSecret(KEY, 16)).toBeNull();
  });

  it("ngắn hơn độ dài tối thiểu -> null", () => {
    process.env[KEY] = "a".repeat(15);
    expect(strongSecret(KEY, 16)).toBeNull();
  });

  it("mặc định đòi tối thiểu 24 ký tự", () => {
    process.env[KEY] = "x".repeat(23);
    expect(strongSecret(KEY)).toBeNull();
    process.env[KEY] = "x".repeat(24);
    expect(strongSecret(KEY)).toBe("x".repeat(24));
  });

  it("còn nguyên chuỗi mẫu 'doi-chuoi...' trong .env.example -> null (kể cả đủ dài, hoa/thường)", () => {
    process.env[KEY] = "doi-chuoi-nay-thanh-mot-chuoi-ngau-nhien-dai";
    expect(strongSecret(KEY, 16)).toBeNull();
    process.env[KEY] = "DOI-CHUOI-NAY-THANH-MOT-CHUOI-NGAU-NHIEN-DAI";
    expect(strongSecret(KEY, 16)).toBeNull();
  });

  it("đủ dài, không phải chuỗi mẫu -> trả nguyên giá trị", () => {
    const v = "3f9a1c7e0b2d4f6a8c1e3b5d7f9a0c2e";
    process.env[KEY] = v;
    expect(strongSecret(KEY, 16)).toBe(v);
    expect(strongSecret(KEY, 32)).toBe(v);
    expect(strongSecret(KEY, 33)).toBeNull();
  });
});

describe("safeEqual — so sánh thời gian hằng", () => {
  it("hai chuỗi giống nhau -> true", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true);
  });

  it("khác nội dung cùng độ dài -> false", () => {
    expect(safeEqual("abc123", "abc124")).toBe(false);
  });

  it("khác độ dài -> false (không ném lỗi)", () => {
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("abcd", "abc")).toBe(false);
  });

  it("thiếu một bên (null/undefined/rỗng) -> false, kể cả hai bên cùng rỗng", () => {
    expect(safeEqual(null, "abc")).toBe(false);
    expect(safeEqual("abc", undefined)).toBe(false);
    expect(safeEqual("", "")).toBe(false);
    expect(safeEqual(null, null)).toBe(false);
  });

  it("chuỗi Unicode", () => {
    expect(safeEqual("khoá-bí-mật", "khoá-bí-mật")).toBe(true);
    expect(safeEqual("khoá-bí-mật", "khoa-bi-mat")).toBe(false);
  });
});
