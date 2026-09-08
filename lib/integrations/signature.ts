import crypto from "node:crypto";

/**
 * XÁC MINH CHỮ KÝ WEBHOOK — HMAC SHA256.
 *
 * Tài liệu thiết kế để hàm này trả về `true` cứng kèm ghi chú "logic xác thực
 * HMAC SHA256". Đó là lỗ hổng: cứ ai biết địa chỉ webhook là đẩy được số doanh
 * thu giả vào bảng KPI. Đây là bản làm thật.
 *
 * Cách bên gửi phải ký:
 *   chuoi_ky = "<timestamp>.<body JSON nguyên văn>"
 *   chu_ky   = HMAC_SHA256(chuoi_ky, secret_cua_nguon)  -> hex thường
 *
 * Gửi kèm hai header:
 *   X-Signature: sha256=<chu_ky>
 *   X-Timestamp: <timestamp giây UNIX>
 */

/** Cửa sổ thời gian chấp nhận, tính bằng giây. Quá thì coi là gói cũ bị phát lại. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type SignatureCheck = {
  ok: boolean;
  reason?: string;
};

export function verifyWebhookSignature(opts: {
  rawBody: string;
  signatureHeader: string | null;
  timestampHeader: string | null;
  secret: string;
  now?: Date;
}): SignatureCheck {
  const { rawBody, secret } = opts;
  const now = opts.now ?? new Date();

  if (!secret) {
    return { ok: false, reason: "Nguồn này chưa được cấu hình khoá bí mật." };
  }
  if (!opts.signatureHeader) {
    return { ok: false, reason: "Thiếu header X-Signature." };
  }
  if (!opts.timestampHeader) {
    return { ok: false, reason: "Thiếu header X-Timestamp." };
  }

  const ts = Number(opts.timestampHeader);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: "X-Timestamp không phải số." };
  }

  // Chặn phát lại gói cũ: người chặn được đường truyền không thể lưu lại một
  // gói hợp lệ rồi bắn lại sau vài ngày để ghi đè số liệu.
  const driftSeconds = Math.abs(now.getTime() / 1000 - ts);
  if (driftSeconds > SIGNATURE_TOLERANCE_SECONDS) {
    return {
      ok: false,
      reason: `Dấu thời gian lệch ${Math.round(driftSeconds)} giây so với máy chủ (cho phép tối đa ${SIGNATURE_TOLERANCE_SECONDS} giây).`,
    };
  }

  const expected = signPayload(rawBody, ts, secret);
  const provided = opts.signatureHeader.trim();

  if (!timingSafeEqualStr(expected, provided)) {
    return { ok: false, reason: "Chữ ký không khớp." };
  }

  return { ok: true };
}

/** Tạo chữ ký — dùng cho tài liệu, cho bộ kiểm thử, và cho bên gửi tham khảo. */
export function signPayload(
  rawBody: string,
  timestampSeconds: number,
  secret: string
): string {
  const mac = crypto.createHmac("sha256", secret);
  mac.update(`${timestampSeconds}.${rawBody}`, "utf8");
  return `sha256=${mac.digest("hex")}`;
}

/**
 * So sánh không lộ thời gian.
 * So bằng `===` thì kẻ tấn công đo được thời gian phản hồi và dò dần từng ký tự
 * của chữ ký đúng. Băm cả hai bên trước rồi mới so, để độ dài luôn bằng nhau.
 */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Sinh khoá bí mật cho một nguồn tích hợp mới. */
export function generateSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Sinh mã 6 chữ số để người dùng tự nối tài khoản Telegram. */
export function generateLinkCode(): string {
  // randomInt an toàn về mặt mật mã, khác Math.random
  return String(crypto.randomInt(100000, 1000000));
}
