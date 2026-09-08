import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { assertPermission, BusinessError } from "@/lib/rbac";
import { hashPassword } from "@/lib/auth";
import { checkPasswordStrength } from "@/lib/password";
import { clientMeta, writeAudit } from "@/lib/audit";
import { ERR, ROLES } from "@/lib/constants";
import { EMPLOYMENT_TYPES } from "@/lib/production/constants";

const schema = z.object({
  fullName: z.string().min(2).max(255).optional(),
  jobTitle: z.string().max(255).nullable().optional(),
  role: z.enum(ROLES).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  departmentId: z.string().nullable().optional(),
  telegramChatId: z.string().max(100).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  isActive: z.boolean().optional(),
  newPassword: z.string().min(8).optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const { id } = await ctx.params;
    const actor = await requireUser();
    assertPermission(actor, "admin.users");
    const body = schema.parse(await req.json());

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) {
      throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy tài khoản.", 404);
    }

    // Không cho tự khoá chính mình -> tránh mất lối vào hệ thống
    if (target.id === actor.id && body.isActive === false) {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        "Không thể tự khoá tài khoản của chính bạn.",
        400
      );
    }

    // Luôn phải còn ít nhất một CEO đang hoạt động
    if (
      target.role === "CEO" &&
      (body.role === "EMPLOYEE" || body.role === "MANAGER" || body.isActive === false)
    ) {
      const activeCeos = await prisma.user.count({
        where: { role: "CEO", isActive: true, id: { not: id } },
      });
      if (activeCeos === 0) {
        throw new BusinessError(
          ERR.VALIDATION_FAILED,
          "Đây là tài khoản Ban Giám đốc duy nhất còn hoạt động — không thể hạ quyền hoặc khoá.",
          400
        );
      }
    }

    const data: Record<string, unknown> = {};
    for (const k of [
      "fullName",
      "jobTitle",
      "role",
      "employmentType",
      "departmentId",
      "telegramChatId",
      "phone",
      "isActive",
    ] as const) {
      if (body[k] !== undefined) data[k] = body[k];
    }
    if (body.newPassword) {
      const check = checkPasswordStrength(body.newPassword, {
        fullName: target.fullName,
        email: target.email,
      });
      if (!check.ok) {
        throw new BusinessError(ERR.VALIDATION_FAILED, check.reason, 400);
      }
      data.passwordHash = await hashPassword(body.newPassword);
      // Quản trị đặt hộ nghĩa là quản trị BIẾT mật khẩu đó. Bắt người kia tự
      // đổi ngay lần đăng nhập sau, để cuối cùng chỉ họ biết mật khẩu của mình.
      data.mustChangePassword = true;
      data.passwordChangedAt = null;
    }

    const updated = await prisma.user.update({ where: { id }, data });

    await writeAudit({
      actor,
      action: "USER_UPDATE",
      entityName: "users",
      entityId: id,
      before: {
        role: target.role,
        employmentType: target.employmentType,
        departmentId: target.departmentId,
        isActive: target.isActive,
        telegramChatId: target.telegramChatId,
      },
      after: {
        role: updated.role,
        employmentType: updated.employmentType,
        departmentId: updated.departmentId,
        isActive: updated.isActive,
        telegramChatId: updated.telegramChatId,
        passwordReset: !!body.newPassword,
      },
      ...clientMeta(req),
    });

    return ok({ user: { ...updated, passwordHash: undefined } });
  });
}
