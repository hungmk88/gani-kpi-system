import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { assertPermission, BusinessError } from "@/lib/rbac";
import { hashPassword } from "@/lib/auth";
import { checkPasswordStrength } from "@/lib/password";
import { clientMeta, writeAudit } from "@/lib/audit";
import { ERR, ROLES } from "@/lib/constants";

const schema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2).max(255),
  jobTitle: z.string().max(255).optional(),
  role: z.enum(ROLES),
  departmentId: z.string().nullable().optional(),
  password: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự."),
  telegramChatId: z.string().max(100).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
});

export async function POST(req: Request) {
  return handle(async () => {
    const actor = await requireUser();
    assertPermission(actor, "admin.users");
    const body = schema.parse(await req.json());

    const check = checkPasswordStrength(body.password, {
      fullName: body.fullName,
      email: body.email,
    });
    if (!check.ok) {
      throw new BusinessError(ERR.VALIDATION_FAILED, check.reason, 400);
    }

    const email = body.email.toLowerCase().trim();
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        "Email này đã có tài khoản.",
        409
      );
    }

    const user = await prisma.user.create({
      data: {
        email,
        fullName: body.fullName,
        jobTitle: body.jobTitle ?? null,
        role: body.role,
        departmentId: body.departmentId ?? null,
        passwordHash: await hashPassword(body.password),
        telegramChatId: body.telegramChatId ?? null,
        phone: body.phone ?? null,
        // Mật khẩu này do quản trị đặt nên quản trị biết. Người mới vào hệ thống
        // là bị chặn ở trang đổi mật khẩu, chưa xem được gì cho tới khi tự đặt.
        mustChangePassword: true,
      },
    });

    await writeAudit({
      actor,
      action: "USER_CREATE",
      entityName: "users",
      entityId: user.id,
      after: { email, role: body.role, departmentId: body.departmentId },
      ...clientMeta(req),
    });

    return ok({ user: { ...user, passwordHash: undefined } }, 201);
  });
}
