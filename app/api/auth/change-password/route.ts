import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { checkPasswordStrength } from "@/lib/password";
import { BusinessError } from "@/lib/rbac";
import { ERR } from "@/lib/constants";
import { clientMeta, writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

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
    const actor = await requireUser();
    const body = schema.parse(await req.json());

    const user = await prisma.user.findUnique({ where: { id: actor.id } });
    if (!user) {
      throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy tài khoản.", 404);
    }

    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
      // Ghi lại cả lần thử hỏng — đây là dấu hiệu có người đụng vào máy người khác
      await writeAudit({
        actor,
        action: "PASSWORD_CHANGE_FAILED",
        entityName: "users",
        entityId: user.id,
        after: { reason: "Sai mật khẩu hiện tại" },
        ...clientMeta(req),
      });
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        "Mật khẩu hiện tại không đúng.",
        400
      );
    }

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
      },
    });

    // Nhật ký KHÔNG chứa mật khẩu cũ lẫn mới, chỉ ghi là đã đổi
    await writeAudit({
      actor,
      action: "PASSWORD_CHANGE",
      entityName: "users",
      entityId: user.id,
      after: { self: true },
      ...clientMeta(req),
    });

    return ok({ changed: true });
  });
}
