import { describe, expect, it } from "vitest";
import {
  generateLinkCode,
  generateSecret,
  signPayload,
  SIGNATURE_TOLERANCE_SECONDS,
  verifyWebhookSignature,
} from "@/lib/integrations/signature";

const secret = "a".repeat(64);
const body = JSON.stringify({ kpiCode: "DOANH_THU", value: 1000 });
const now = new Date("2026-10-15T03:00:00Z");
const nowSec = Math.floor(now.getTime() / 1000);

function check(over: Partial<Parameters<typeof verifyWebhookSignature>[0]> = {}) {
  return verifyWebhookSignature({
    rawBody: body,
    signatureHeader: signPayload(body, nowSec, secret),
    timestampHeader: String(nowSec),
    secret,
    now,
    ...over,
  });
}

describe("verifyWebhookSignature — HMAC SHA256", () => {
  it("chữ ký hợp lệ -> ok", () => {
    expect(check()).toEqual({ ok: true });
  });

  it("định dạng chữ ký là sha256=<hex 64 ký tự>", () => {
    expect(signPayload(body, nowSec, secret)).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("bỏ qua khoảng trắng thừa quanh header chữ ký", () => {
    expect(check({ signatureHeader: `  ${signPayload(body, nowSec, secret)} ` }).ok).toBe(true);
  });

  it("sai chữ ký -> từ chối", () => {
    const r = check({ signatureHeader: "sha256=" + "0".repeat(64) });
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it("ký bằng khoá khác -> từ chối", () => {
    expect(
      check({ signatureHeader: signPayload(body, nowSec, "b".repeat(64)) }).ok
    ).toBe(false);
  });

  it("thân tin bị sửa sau khi ký -> từ chối", () => {
    expect(check({ rawBody: body.replace("1000", "9999") }).ok).toBe(false);
  });

  it("đổi timestamp mà giữ chữ ký cũ -> từ chối (timestamp nằm trong chuỗi ký)", () => {
    expect(check({ timestampHeader: String(nowSec + 1) }).ok).toBe(false);
  });

  it("thiếu header chữ ký / timestamp / khoá -> từ chối", () => {
    expect(check({ signatureHeader: null }).ok).toBe(false);
    expect(check({ timestampHeader: null }).ok).toBe(false);
    expect(check({ secret: "" }).ok).toBe(false);
  });

  it("timestamp không phải số -> từ chối", () => {
    expect(check({ timestampHeader: "hom-qua" }).ok).toBe(false);
  });

  it("gói cũ bị phát lại (quá cửa sổ cho phép) -> từ chối dù chữ ký đúng", () => {
    const old = nowSec - SIGNATURE_TOLERANCE_SECONDS - 1;
    const r = check({
      timestampHeader: String(old),
      signatureHeader: signPayload(body, old, secret),
    });
    expect(r.ok).toBe(false);
  });

  it("timestamp ở tương lai quá xa -> từ chối", () => {
    const future = nowSec + SIGNATURE_TOLERANCE_SECONDS + 1;
    expect(
      check({
        timestampHeader: String(future),
        signatureHeader: signPayload(body, future, secret),
      }).ok
    ).toBe(false);
  });

  it("vừa đúng mép cửa sổ -> vẫn chấp nhận", () => {
    const edge = nowSec - SIGNATURE_TOLERANCE_SECONDS;
    expect(
      check({
        timestampHeader: String(edge),
        signatureHeader: signPayload(body, edge, secret),
      }).ok
    ).toBe(true);
  });
});

describe("sinh khoá / mã liên kết", () => {
  it("generateSecret: 64 ký tự hex, mỗi lần một khác", () => {
    const a = generateSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(generateSecret()).not.toBe(a);
  });

  it("generateLinkCode: đúng 6 chữ số", () => {
    for (let i = 0; i < 50; i++) expect(generateLinkCode()).toMatch(/^\d{6}$/);
  });
});
