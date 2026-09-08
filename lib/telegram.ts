import {
  appUrl,
  escapeHtml,
  sendMessage,
  telegramEnabled,
} from "./telegram-api";

/**
 * Cảnh báo Telegram cho Ban Giám đốc.
 *
 * `notify` (thông báo cho từng người, đa kênh) nằm ở lib/notify.ts — ở đây chỉ
 * xuất lại để những chỗ gọi cũ không phải sửa import.
 */
export { notify, type NotifyInput } from "./notify";

/**
 * CEO EXECUTIVE ALERT — cảnh báo đỏ bắn thẳng vào Telegram Ban Giám đốc.
 * Dùng cho: Task CRITICAL, KPI báo động, Data Mismatch.
 */
export async function sendCeoAlert(opts: {
  title: string;
  details: string;
  actionPath?: string;
}) {
  const chatId = process.env.CEO_TELEGRAM_CHAT_ID;
  const url = appUrl(opts.actionPath ?? "");

  const message = [
    "🔴 <b>[CẢNH BÁO BAN GIÁM ĐỐC] CẦN XỬ LÝ NGAY</b>",
    "──────────────────────────",
    `⚠️ <b>Vấn đề:</b> ${escapeHtml(opts.title)}`,
    `📝 <b>Chi tiết:</b> ${escapeHtml(opts.details)}`,
    `⏰ <b>Phát hiện lúc:</b> ${new Date().toLocaleString("vi-VN")}`,
    "",
    `👉 <a href="${url}">Bấm vào đây để xử lý</a>`,
  ].join("\n");

  if (!telegramEnabled() || !chatId) {
    console.log("[TELEGRAM tắt] Bỏ qua cảnh báo CEO:", opts.title);
    return { sent: false, reason: "TELEGRAM_DISABLED" };
  }

  const res = await sendMessage(chatId, message);
  if (!res.ok) {
    console.error("[TELEGRAM] Gửi cảnh báo CEO thất bại:", res.error);
    return { sent: false, reason: res.error };
  }
  return { sent: true };
}

/** Kiểm tra cấu hình Telegram — dùng ở trang Quản trị. */
export async function testTelegram(chatId: string) {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return { ok: false, error: "Chưa cấu hình TELEGRAM_BOT_TOKEN trong .env" };
  }
  const res = await sendMessage(
    chatId,
    "✅ <b>GANI KPI System</b>\nKết nối Telegram thành công. Từ giờ cảnh báo sẽ về đây."
  );
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}
