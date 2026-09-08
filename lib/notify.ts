import { prisma } from "./db";
import {
  appUrl,
  escapeHtml,
  sendMessage,
  telegramEnabled,
} from "./telegram-api";
import { sendZns, zaloEnabled, type ZaloTemplateKind } from "./zalo";

/**
 * CỔNG THÔNG BÁO ĐA KÊNH.
 *
 * Thứ tự bất di bất dịch:
 *   1. LUÔN lưu vào bảng notifications (trong ứng dụng). Kênh này không bao giờ
 *      hỏng, nên không có thông báo nào bị mất.
 *   2. Bắn thêm Telegram nếu người nhận đã nối tài khoản.
 *   3. Bắn thêm Zalo ZNS nếu tin thuộc loại đã đăng ký mẫu và người nhận có số.
 *
 * Kênh ngoài hỏng thì chỉ ghi lại `sendError`, không làm hỏng nghiệp vụ đang chạy.
 * Nguyên tắc: không bao giờ để việc gửi tin nhắn làm sập việc duyệt KPI.
 */

export type NotifyInput = {
  userId: string;
  title: string;
  body: string;
  level?: "INFO" | "WARNING" | "CRITICAL";
  linkUrl?: string | null;
  /** Loại mẫu Zalo tương ứng, nếu tin này có đăng ký mẫu ZNS. */
  zaloKind?: ZaloTemplateKind;
  zaloData?: Record<string, string>;
};

export async function notify(input: NotifyInput) {
  const level = input.level ?? "INFO";
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user) return;

  const channels: string[] = ["IN_APP"];
  const errors: string[] = [];

  // --- Telegram ---
  if (telegramEnabled() && user.telegramChatId) {
    const res = await sendMessage(
      user.telegramChatId,
      renderMessage(input, level)
    );
    if (res.ok) channels.push("TELEGRAM");
    else errors.push(res.error ?? "Telegram lỗi không rõ");
  }

  // --- Zalo ZNS ---
  if (zaloEnabled() && input.zaloKind && user.phone) {
    const res = await sendZns({
      phone: user.phone,
      kind: input.zaloKind,
      data: input.zaloData ?? {},
    });
    if (res.ok) channels.push("ZALO");
    else if (!res.skipped) errors.push(res.error ?? "Zalo lỗi không rõ");
  }

  if (errors.length) console.error("[NOTIFY]", errors.join(" | "));

  await prisma.notification.create({
    data: {
      userId: input.userId,
      title: input.title,
      body: input.body,
      level,
      linkUrl: input.linkUrl ?? null,
      channel: channels.join("+"),
      sentOk: errors.length === 0,
      sendError: errors.length ? errors.join(" | ") : null,
    },
  });
}

function renderMessage(input: NotifyInput, level: string) {
  const icon = level === "CRITICAL" ? "🔴" : level === "WARNING" ? "🟠" : "🔔";
  const lines = [
    `${icon} <b>${escapeHtml(input.title)}</b>`,
    escapeHtml(input.body),
  ];
  if (input.linkUrl) {
    lines.push("", `👉 <a href="${appUrl(input.linkUrl)}">Mở trong hệ thống</a>`);
  }
  return lines.join("\n");
}
