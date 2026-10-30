import { formatVnDateTime } from "./vn-time";
import {
  appUrl,
  escapeHtml,
  isParseError,
  sendMessage,
  sendPlainMessage,
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
    `⏰ <b>Phát hiện lúc:</b> ${formatVnDateTime(new Date())}`,
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

export type BriefingForTelegram = {
  healthScore: number;
  healthLabel: string;
  executiveSummary: string;
  keyRisks: { area: string; riskLevel: "HIGH" | "CRITICAL"; impact: string }[];
  recommendations: string[];
  engine: "GEMINI" | "RULE_BASED";
};

/** Telegram giới hạn 4096 ký tự một tin — chừa khoảng an toàn. */
export const TELEGRAM_SAFE_LENGTH = 4000;

/**
 * Cắt chuỗi THÔ (chưa escape) về tối đa `max` ký tự, theo code point để không
 * bẻ đôi emoji/ký tự ghép UTF-16.
 */
export function clipText(text: string, max: number) {
  const chars = Array.from(String(text ?? ""));
  if (chars.length <= max) return chars.join("");
  if (max <= 1) return "…".slice(0, Math.max(0, max));
  return chars.slice(0, max - 1).join("").trimEnd() + "…";
}

/**
 * Soạn tin giao ban. Cắt TỪNG TRƯỜNG trước khi escape/gắn thẻ — không bao giờ
 * cắt ngang thẻ HTML hay entity (&amp;...) như kiểu cắt cả tin ở ký tự 3970.
 * Còn dài thì bớt dần mục khuyến nghị/rủi ro, rồi rút ngắn phần tóm tắt.
 * `html: false` = bản chữ thường (đường lùi khi Telegram từ chối HTML).
 */
export function buildBriefingMessage(
  briefing: BriefingForTelegram,
  periodName: string,
  opts: { html: boolean; url: string; generatedAt: Date }
) {
  const esc = opts.html ? escapeHtml : (x: string) => x;
  const b = (x: string) => (opts.html ? `<b>${x}</b>` : x);
  const i = (x: string) => (opts.html ? `<i>${x}</i>` : x);

  const render = (lim: { summary: number; items: number; itemLen: number }) => {
    const risks = briefing.keyRisks.slice(0, lim.items);
    const recs = briefing.recommendations.slice(0, lim.items);
    const riskLines = risks.length
      ? risks
          .map(
            (r) =>
              `• ${b(esc(clipText(r.area, 80)))} (${
                r.riskLevel === "CRITICAL" ? "nghiêm trọng" : "cao"
              }): ${esc(clipText(r.impact, lim.itemLen))}`
          )
          .join("\n")
      : "Không có rủi ro nổi bật.";
    const recLines = recs.length
      ? recs.map((r, idx) => `${idx + 1}. ${esc(clipText(r, lim.itemLen))}`).join("\n")
      : "Không có khuyến nghị nào cần làm gấp.";
    const more =
      briefing.keyRisks.length > risks.length ||
      briefing.recommendations.length > recs.length
        ? ["", i("… còn nữa, xem đủ trong hệ thống.")]
        : [];
    return [
      `📋 ${b(`BÁO CÁO GIAO BAN — Kỳ ${esc(clipText(periodName, 60))}`)}`,
      "──────────────────────────",
      `💯 ${b("Điểm sức khoẻ:")} ${briefing.healthScore}/100 (${esc(clipText(briefing.healthLabel, 60))})`,
      "",
      esc(clipText(briefing.executiveSummary, lim.summary)),
      "",
      b("Rủi ro cần để mắt:"),
      riskLines,
      "",
      b("Khuyến nghị:"),
      recLines,
      ...more,
      "",
      `🤖 ${i(`Sinh bởi ${briefing.engine === "GEMINI" ? "Gemini" : "bộ đọc luật cứng"} lúc ${formatVnDateTime(opts.generatedAt)}`)}`,
      opts.html
        ? `👉 <a href="${escapeHtml(opts.url).replace(/"/g, "&quot;")}">Xem chi tiết trong hệ thống</a>`
        : `👉 Xem chi tiết: ${opts.url}`,
    ].join("\n");
  };

  const lim = { summary: 1500, items: 5, itemLen: 300 };
  let message = render(lim);
  // Bớt dần cho tới khi vừa. Mỗi vòng giảm ít nhất một giới hạn -> chắc chắn dừng.
  while (message.length > TELEGRAM_SAFE_LENGTH) {
    if (lim.items > 2) lim.items--;
    else if (lim.itemLen > 120) lim.itemLen -= 60;
    else if (lim.summary > 300) lim.summary -= 300;
    else if (lim.items > 0) lim.items--;
    else break;
    message = render(lim);
  }
  return message;
}

/**
 * BÁO CÁO GIAO BAN — bản tóm tắt gửi Telegram Ban Giám đốc đúng ngày chốt kỳ.
 * Khác `sendCeoAlert`: đây không phải cảnh báo đỏ, chỉ là bản tin định kỳ.
 * Telegram từ chối HTML (lỗi 400 parse) thì gửi lại MỘT lần bằng chữ thường.
 */
export async function sendExecutiveBriefingTelegram(
  briefing: BriefingForTelegram,
  periodName: string
) {
  const chatId = process.env.CEO_TELEGRAM_CHAT_ID;
  const url = appUrl("/analytics");
  const generatedAt = new Date();

  if (!telegramEnabled() || !chatId) {
    console.log("[TELEGRAM tắt] Bỏ qua báo cáo giao ban.");
    return { sent: false, reason: "TELEGRAM_DISABLED" };
  }

  let res = await sendMessage(
    chatId,
    buildBriefingMessage(briefing, periodName, { html: true, url, generatedAt })
  );
  if (isParseError(res)) {
    console.warn("[TELEGRAM] Báo cáo giao ban bị từ chối HTML, gửi lại dạng chữ thường:", res.error);
    res = await sendPlainMessage(
      chatId,
      buildBriefingMessage(briefing, periodName, { html: false, url, generatedAt })
    );
  }
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
