import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { BusinessError } from "@/lib/rbac";
import { generateLinkCode } from "@/lib/integrations/signature";
import { telegramEnabled } from "@/lib/telegram-api";

export const runtime = "nodejs";

/** Mã sống 10 phút — đủ để chép sang Telegram, không đủ để ai nhặt được dùng lại. */
const TTL_MINUTES = 10;

/**
 * Sinh mã một lần để người dùng tự nối tài khoản Telegram của mình.
 *
 * Cách này thay cho việc quản trị phải đi hỏi từng người chat_id rồi chép tay —
 * vừa mất công vừa dễ chép nhầm sang người khác.
 */
export async function POST() {
  return handle(async () => {
    const user = await requireUser();

    // Dọn mã cũ chưa dùng để mỗi người chỉ có đúng một mã còn hiệu lực
    await prisma.telegramLink.deleteMany({
      where: { userId: user.id, usedAt: null },
    });

    // Dọn luôn mã hết hạn chưa dùng của mọi người — giải phóng không gian mã
    // (cột code là unique) và để mã cũ không còn nằm chờ bị dò trúng.
    await prisma.telegramLink.deleteMany({
      where: { usedAt: null, expiresAt: { lt: new Date() } },
    });

    // Vòng lặp phòng trường hợp hiếm gặp: mã 6 số trùng với mã đã có
    let code: string | null = null;
    for (let i = 0; i < 8; i++) {
      const candidate = generateLinkCode();
      const clash = await prisma.telegramLink.findUnique({
        where: { code: candidate },
        select: { id: true },
      });
      if (!clash) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      throw new BusinessError(
        "LINK_CODE_UNAVAILABLE",
        "Chưa sinh được mã nối, vui lòng bấm lại sau ít giây.",
        503
      );
    }

    const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000);
    await prisma.telegramLink.create({
      data: { code, userId: user.id, expiresAt },
    });

    const current = await prisma.user.findUnique({
      where: { id: user.id },
      select: { telegramChatId: true },
    });

    return ok({
      code,
      expiresAt: expiresAt.toISOString(),
      ttlMinutes: TTL_MINUTES,
      botUsername: process.env.TELEGRAM_BOT_USERNAME || null,
      telegramEnabled: telegramEnabled(),
      alreadyLinked: !!current?.telegramChatId,
      instruction: `Mở Telegram, nhắn RIÊNG cho bot của công ty (không gõ trong nhóm): /start ${code}`,
    });
  });
}

/** Ngắt nối từ phía web (tương đương lệnh /huy trong Telegram). */
export async function DELETE() {
  return handle(async () => {
    const user = await requireUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { telegramChatId: null },
    });
    await prisma.telegramLink.deleteMany({ where: { userId: user.id } });
    return ok({ unlinked: true });
  });
}
