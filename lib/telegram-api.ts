/**
 * LỚP GỌI API TELEGRAM (mức thấp).
 *
 * Tách riêng khỏi phần nghiệp vụ để `notify`, `sendCeoAlert` và bot tương tác
 * dùng chung mà không tạo vòng import.
 */

const API = "https://api.telegram.org";

export function telegramEnabled() {
  return (
    process.env.TELEGRAM_ENABLED === "true" && !!process.env.TELEGRAM_BOT_TOKEN
  );
}

export function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export type TelegramResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
  /** Mã HTTP Telegram trả về (400 = tin sai định dạng, vd HTML hỏng) */
  status?: number;
};

/** Telegram từ chối vì không đọc được HTML/entity trong tin (lỗi 400). */
export function isParseError(res: TelegramResult) {
  return (
    !res.ok &&
    res.status === 400 &&
    /can't parse entities|unsupported start tag|can't find end tag/i.test(res.error ?? "")
  );
}

/** Gọi một phương thức bất kỳ của Bot API. Không ném lỗi ra ngoài. */
export async function callTelegram(
  method: string,
  payload: Record<string, unknown>,
  timeoutMs = 15000
): Promise<TelegramResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    return { ok: false, error: "Chưa cấu hình TELEGRAM_BOT_TOKEN trong .env" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.ok === false) {
      return {
        ok: false,
        status: res.status,
        error: `Telegram ${method} lỗi ${res.status}: ${
          body?.description ?? "không rõ"
        }`,
      };
    }
    return { ok: true, data: body?.result };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error && e.name === "AbortError"
          ? `Telegram ${method} phản hồi quá chậm`
          : e instanceof Error
            ? e.message
            : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Gửi tin nhắn HTML, kèm bàn phím nút bấm nếu có. */
export async function sendMessage(
  chatId: string,
  html: string,
  replyMarkup?: unknown
): Promise<TelegramResult> {
  return callTelegram("sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

/** Gửi tin chữ thường (không parse HTML) — đường lùi khi bản HTML bị từ chối. */
export async function sendPlainMessage(chatId: string, text: string): Promise<TelegramResult> {
  return callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
}

export function appUrl(path = "") {
  const base = process.env.APP_URL || "http://localhost:3000";
  return `${base}${path}`;
}
