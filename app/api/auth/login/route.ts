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

// Chống dò mật khẩu: quá 5 lần sai trong 15 phút (theo email HOẶC theo IP)
// thì tạm khoá đăng nhập. Đếm từ audit_logs — không cần thêm bảng hay Redis.
const MAX_FAILS = 5;
const MAX_FAILS_PER_IP = 20;
const WINDOW_MS = 15 * 60_000;

// Hash giả để email không tồn tại vẫn tốn đúng một lần bcrypt — không lộ email
// nào có thật qua thời gian phản hồi.
const DUMMY_HASH = "$2a$10$ZDDCYgXxY09X5K3s3EjWbe6ZhK2Va5b0/C4Qt5qBp6J7LPO4uzNJS";

export async function POST(req: Request) {
  return handle(async () => {
    const body = schema.parse(await req.json());
    const email = body.email.toLowerCase().trim();
    const meta = clientMeta(req);
    const since = new Date(Date.now() - WINDOW_MS);

    const [failsByEmail, failsByIp] = await Promise.all([
      prisma.auditLog.count({
        where: { action: "LOGIN_FAILED", entityId: email, createdAt: { gte: since } },
      }),
      meta.ip
        ? prisma.auditLog.count({
            where: { action: "LOGIN_FAILED", ipAddress: meta.ip, createdAt: { gte: since } },
          })
        : Promise.resolve(0),
    ]);
    if (failsByEmail >= MAX_FAILS || failsByIp >= MAX_FAILS_PER_IP) {
      return fail(
        "TOO_MANY_ATTEMPTS",
        "Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.",
        429
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { department: true },
      omit: { passwordHash: false },
    });

    const passwordOk = await verifyPassword(
      body.password,
      user?.passwordHash ?? DUMMY_HASH
    );

    // Thông báo lỗi cố tình mơ hồ để không lộ email nào có thật; tài khoản
    // bị khoá cũng báo y như sai mật khẩu.
    if (!user || !passwordOk || !user.isActive) {
      await writeAudit({
        actor: null,
        action: "LOGIN_FAILED",
        entityName: "users",
        entityId: email,
        after: { reason: !user ? "unknown_email" : !passwordOk ? "bad_password" : "inactive" },
        ...meta,
      });
      return fail(
        "INVALID_CREDENTIALS",
        "Email hoặc mật khẩu không đúng.",
        401
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
      ...meta,
    });

    // Bên gọi API cần biết ngay: tài khoản này còn dùng mật khẩu do quản trị
    // đặt hộ, phải qua /doi-mat-khau trước khi làm gì khác.
    return ok({ user: sessionUser, mustChangePassword: user.mustChangePassword });
  });
}
