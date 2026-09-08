import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";
import { fail, handle, ok } from "@/lib/api";
import { writeAudit, clientMeta } from "@/lib/audit";
import type { Role } from "@/lib/constants";

const schema = z.object({
  email: z.string().email("Email không hợp lệ."),
  password: z.string().min(1, "Chưa nhập mật khẩu."),
});

export async function POST(req: Request) {
  return handle(async () => {
    const body = schema.parse(await req.json());

    const user = await prisma.user.findUnique({
      where: { email: body.email.toLowerCase().trim() },
      include: { department: true },
    });

    // Thông báo lỗi cố tình mơ hồ để không lộ email nào có thật
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      return fail(
        "INVALID_CREDENTIALS",
        "Email hoặc mật khẩu không đúng.",
        401
      );
    }
    if (!user.isActive) {
      return fail(
        "ACCOUNT_DISABLED",
        "Tài khoản đã bị khoá. Liên hệ quản trị hệ thống.",
        403
      );
    }

    const sessionUser = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role as Role,
      departmentId: user.departmentId,
      departmentName: user.department?.name ?? null,
    };

    await createSession(sessionUser);
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await writeAudit({
      actor: sessionUser,
      action: "LOGIN",
      entityName: "users",
      entityId: user.id,
      ...clientMeta(req),
    });

    // Bên gọi API cần biết ngay: tài khoản này còn dùng mật khẩu do quản trị
    // đặt hộ, phải qua /doi-mat-khau trước khi làm gì khác.
    return ok({ user: sessionUser, mustChangePassword: user.mustChangePassword });
  });
}
