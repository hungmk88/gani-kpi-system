import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { createSession, hashPassword, verifyPassword } from "@/lib/auth";
import { checkPasswordStrength } from "@/lib/password";
import { BusinessError } from "@/lib/rbac";
import { ERR } from "@/lib/constants";
import { clientMeta, writeAudit } from "@/lib/audit";
import { countAudit, lockKey, recordAttempt, windowStart } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Chống dò mật khẩu hiện tại từ một phiên bị chiếm: 5 lần sai / 15 phút / người.
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60_000;

const schema = z.object({
  currentPassword: z.string().min(1, "Chưa nhập mật khẩu hiện tại."),
  newPassword: z.string().min(1, "Chưa nhập mật khẩu mới."),
});

/**
 * Người dùng tự đổi mật khẩu của CHÍNH MÌNH.
 *
 * Không có tham số userId ở đây, và cố ý như vậy: đường này chỉ đổi được mật
 * khẩu của người đang đăng nhập. Quản trị muốn đặt lại cho người khác thì đi
 * đường `PATCH /api/admin/users/:id` — đường đó ghi nhật ký khác và bật cờ bắt
 * người kia phải tự đổi lại ngay lần đăng nhập sau.
 *
 * Bắt buộc nhập mật khẩu hiện tại: nếu ai đó ngồi vào máy đang mở sẵn phiên
 * đăng nhập, họ vẫn không chiếm được tài khoản.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const actor = await requireUser({ allowMustChange: true });
    const body = schema.parse(await req.json());

    const meta = clientMeta(req);

    // Đếm + so mật khẩu hiện tại + ghi lần sai chạy trong một transaction giữ
    // advisory lock theo user: phiên bị chiếm (cookie bị trộm) không thể dò
    // mật khẩu hiện tại bằng cách bắn song song nhiều request.
    const outcome = await prisma.$transaction(
      async (tx) => {
        await lockKey(tx, `pwchange:${actor.id}`);
        const fails = await countAudit(tx, {
          action: "PASSWORD_CHANGE_FAILED",
          entityId: actor.id,
          since: windowStart(WINDOW_MS),
        });
        if (fails >= MAX_FAILS) return { kind: "throttled" as const };

        const user = await tx.user.findUnique({
          where: { id: actor.id },
          omit: { passwordHash: false },
        });
        if (!user) return { kind: "missing" as const };

        if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
          // Ghi lại cả lần thử hỏng — đây là dấu hiệu có người đụng vào máy
          // người khác. Ghi thẳng qua tx (không nuốt lỗi) vì nó là dòng đếm.
          await recordAttempt(tx, {
            action: "PASSWORD_CHANGE_FAILED",
            entityName: "users",
            entityId: user.id,
            userId: actor.id,
            userEmail: actor.email,
            after: { reason: "Sai mật khẩu hiện tại" },
            ...meta,
          });
          return { kind: "failed" as const };
        }
        return { kind: "ok" as const, user };
      },
      { maxWait: 10_000, timeout: 15_000 }
    );

    if (outcome.kind === "throttled") {
      throw new BusinessError(
        "TOO_MANY_ATTEMPTS",
        "Nhập sai mật khẩu hiện tại quá nhiều lần. Vui lòng thử lại sau 15 phút.",
        429
      );
    }
    if (outcome.kind === "missing") {
      throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy tài khoản.", 404);
    }
    if (outcome.kind === "failed") {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        "Mật khẩu hiện tại không đúng.",
        400
      );
    }
    const user = outcome.user;

    if (body.newPassword === body.currentPassword) {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        "Mật khẩu mới phải khác mật khẩu đang dùng.",
        400
      );
    }

    const check = checkPasswordStrength(body.newPassword, {
      fullName: user.fullName,
      email: user.email,
    });
    if (!check.ok) {
      throw new BusinessError(ERR.VALIDATION_FAILED, check.reason, 400);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(body.newPassword),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        // Cố ý KHÔNG ngắt Telegram ở đây: chính chủ tự đổi (đã nhập đúng mật
        // khẩu cũ). Ngắt Telegram chỉ khi quản trị đặt lại hộ — xem
        // PATCH /api/admin/users/:id.
      },
    });

    // Đổi mật khẩu làm mọi phiên cũ hết hiệu lực (kể cả phiên đang dùng) —
    // cấp lại phiên mới cho chính người vừa đổi để họ không bị đăng xuất.
    await createSession(actor);

    // Nhật ký KHÔNG chứa mật khẩu cũ lẫn mới, chỉ ghi là đã đổi
    await writeAudit({
      actor,
      action: "PASSWORD_CHANGE",
      entityName: "users",
      entityId: user.id,
      after: { self: true },
      ...meta,
    });

    return ok({ changed: true });
  });
}
