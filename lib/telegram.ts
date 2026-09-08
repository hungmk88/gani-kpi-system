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

/**
 * BÁO CÁO GIAO BAN — bản tóm tắt gửi Telegram Ban Giám đốc đúng ngày chốt kỳ.
 * Khác `sendCeoAlert`: đây không phải cảnh báo đỏ, chỉ là bản tin định kỳ.
 */
export async function sendExecutiveBriefingTelegram(
  briefing: {
    healthScore: number;
    healthLabel: string;
    executiveSummary: string;
    keyRisks: { area: string; riskLevel: "HIGH" | "CRITICAL"; impact: string }[];
    recommendations: string[];
    engine: "GEMINI" | "RULE_BASED";
  },
  periodName: string
) {
  const chatId = process.env.CEO_TELEGRAM_CHAT_ID;
  const url = appUrl("/analytics");

  const riskLines = briefing.keyRisks.length
    ? briefing.keyRisks
        .map(
          (r) =>
            `• <b>${escapeHtml(r.area)}</b> (${
              r.riskLevel === "CRITICAL" ? "nghiêm trọng" : "cao"
            }): ${escapeHtml(r.impact)}`
        )
        .join("\n")
    : "Không có rủi ro nổi bật.";

  const recLines = briefing.recommendations.length
    ? briefing.recommendations
        .map((r, i) => `${i + 1}. ${escapeHtml(r)}`)
        .join("\n")
    : "Không có khuyến nghị nào cần làm gấp.";

  let message = [
    `📋 <b>BÁO CÁO GIAO BAN — Kỳ ${escapeHtml(periodName)}</b>`,
    "──────────────────────────",
    `💯 <b>Điểm sức khoẻ:</b> ${briefing.healthScore}/100 (${escapeHtml(briefing.healthLabel)})`,
    "",
    escapeHtml(briefing.executiveSummary),
    "",
    "<b>Rủi ro cần để mắt:</b>",
    riskLines,
    "",
    "<b>Khuyến nghị:</b>",
    recLines,
    "",
    `🤖 <i>Sinh bởi ${briefing.engine === "GEMINI" ? "Gemini" : "bộ đọc luật cứng"} lúc ${new Date().toLocaleString("vi-VN")}</i>`,
    `👉 <a href="${url}">Xem chi tiết trong hệ thống</a>`,
  ].join("\n");

  // Telegram giới hạn 4096 ký tự một tin — cắt an toàn, không để gửi lỗi.
  if (message.length > 4000) {
    message = message.slice(0, 3970) + "\n\n… (xem đủ trong hệ thống)";
  }

  if (!telegramEnabled() || !chatId) {
    console.log("[TELEGRAM tắt] Bỏ qua báo cáo giao ban.");
    return { sent: false, reason: "TELEGRAM_DISABLED" };
  }

  const res = await sendMessage(chatId, message);
  if (!res.ok) {
    console.error("[TELEGRAM] Gửi báo cáo giao ban thất bại:", res.error);
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
