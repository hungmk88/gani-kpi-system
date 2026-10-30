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

/**
 * Bảng chữ của mã nối Telegram: chữ HOA + số, bỏ ký tự dễ nhầm (0/O, 1/I/L).
 * 31 ký tự × 8 vị trí ≈ 8,5×10¹¹ tổ hợp — dò mù không còn khả thi, nên không
 * cần trần chung toàn hệ thống (trần đó trước đây cho phép một người dùng vài
 * tài khoản Telegram nhập sai cho đủ 100 lần là khoá nối của cả công ty).
 */
export const LINK_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const LINK_CODE_LENGTH = 8;

/** Sinh mã nối Telegram 8 ký tự (an toàn mật mã, không lệch phân bố). */
export function generateLinkCode(): string {
  let out = "";
  for (let i = 0; i < LINK_CODE_LENGTH; i++) {
    out += LINK_CODE_ALPHABET[crypto.randomInt(LINK_CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * Chuẩn hoá mã người dùng gõ: bỏ khoảng trắng/gạch, đổi chữ thường thành hoa.
 * Trả null nếu không đúng định dạng (sai độ dài hoặc có ký tự ngoài bảng).
 */
export function normalizeLinkCode(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").replace(/[\s-]/g, "").toUpperCase();
  if (v.length !== LINK_CODE_LENGTH) return null;
  for (const ch of v) if (!LINK_CODE_ALPHABET.includes(ch)) return null;
  return v;
}
