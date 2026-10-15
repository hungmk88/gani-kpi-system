import { prisma } from "@/lib/db";
import { destroySession, getSession, loadActiveUser } from "@/lib/auth";
import { handle, ok } from "@/lib/api";
import { clientMeta, writeAudit } from "@/lib/audit";

/**
 * Đăng xuất = THU HỒI token, không chỉ xoá cookie. Xoá cookie thôi thì token
 * đã bị chép ra (máy lạ, extension, log proxy...) vẫn dùng được tới hết hạn
 * 12 tiếng. Ghi sessionsRevokedAt = bây giờ: mọi token ký trước mốc này của
 * người dùng bị loadActiveUser từ chối — tức đăng xuất ở một nơi là đăng xuất
 * mọi thiết bị.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const active = await loadActiveUser(await getSession());
    if (active) {
      await prisma.user.update({
        where: { id: active.user.id },
        data: { sessionsRevokedAt: new Date() },
      });
      await writeAudit({
        actor: active.user,
        action: "LOGOUT",
        entityName: "users",
        entityId: active.user.id,
        after: { sessionsRevoked: true },
        ...clientMeta(req),
      });
    }
    await destroySession();
    return ok({ success: true });
  });
}
