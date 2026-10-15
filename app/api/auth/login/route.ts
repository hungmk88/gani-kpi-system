import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";
import { fail, handle, ok } from "@/lib/api";
import { writeAudit, clientMeta } from "@/lib/audit";
import { countAudit, lockKey, recordAttempt, windowStart } from "@/lib/rate-limit";
import type { Role } from "@/lib/constants";

const schema = z.object({
  email: z.string().email("Email không hợp lệ."),
  password: z.string().min(1, "Chưa nhập mật khẩu."),
});

// Chống dò mật khẩu — đếm các lần sai trong 15 phút từ audit_logs:
//  - theo (email + IP): 5 lần -> khoá cặp đó. Đây là ngưỡng chặt nhất, nhắm
//    đúng kẻ đang dò từ một máy.
//  - theo email (mọi IP): 20 lần. Cố ý rộng hơn: nếu chỉ cần 5 lần sai theo
//    email là khoá, ai cũng có thể gõ bừa 5 lần để khoá ngoài tài khoản CEO.
//  - theo IP (mọi email): 30 lần — chặn dò rải nhiều email từ một chỗ.
const MAX_FAILS_PER_EMAIL_IP = 5;
const MAX_FAILS_PER_EMAIL = 20;
const MAX_FAILS_PER_IP = 30;
const WINDOW_MS = 15 * 60_000;

// Hash giả để email không tồn tại vẫn tốn đúng một lần bcrypt — không lộ email
// nào có thật qua thời gian phản hồi.
const DUMMY_HASH = "$2a$10$ZDDCYgXxY09X5K3s3EjWbe6ZhK2Va5b0/C4Qt5qBp6J7LPO4uzNJS";

export async function POST(req: Request) {
  return handle(async () => {
    const body = schema.parse(await req.json());
    const email = body.email.toLowerCase().trim();
    const meta = clientMeta(req);

    // Đếm + so mật khẩu + ghi dòng LOGIN_FAILED chạy trong MỘT transaction giữ
    // advisory lock theo email: các lượt thử song song cùng email phải xếp
    // hàng, không thể cùng đọc "mới 4 lần sai" rồi cùng lọt. (Đếm theo IP chỉ
    // khoá theo email nên có thể vượt ngưỡng vài lượt khi dò song song nhiều
    // email — chấp nhận, đổi lại không bắt cả văn phòng chung IP xếp hàng.)
    const outcome = await prisma.$transaction(
      async (tx) => {
        await lockKey(tx, `login:${email}`);
        const since = windowStart(WINDOW_MS);
        const failsByEmailIp = await countAudit(tx, {
          action: "LOGIN_FAILED",
          entityId: email,
          ip: meta.ip,
          since,
        });
        const failsByEmail = await countAudit(tx, {
          action: "LOGIN_FAILED",
          entityId: email,
          since,
        });
        const failsByIp = await countAudit(tx, {
          action: "LOGIN_FAILED",
          ip: meta.ip,
          since,
        });
        if (
          failsByEmailIp >= MAX_FAILS_PER_EMAIL_IP ||
          failsByEmail >= MAX_FAILS_PER_EMAIL ||
          failsByIp >= MAX_FAILS_PER_IP
        ) {
          return { kind: "throttled" as const };
        }

        const user = await tx.user.findUnique({
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
          await recordAttempt(tx, {
            action: "LOGIN_FAILED",
            entityName: "users",
            entityId: email,
            after: {
              reason: !user ? "unknown_email" : !passwordOk ? "bad_password" : "inactive",
            },
            ...meta,
          });
          return { kind: "failed" as const };
        }
        return { kind: "ok" as const, user };
      },
      // bcrypt ~100ms nằm trong transaction; nới trần để lúc DB chậm không
      // bị huỷ oan. maxWait: chờ tới lượt khi có lượt khác cùng email.
      { maxWait: 10_000, timeout: 15_000 }
    );

    if (outcome.kind === "throttled") {
      return fail(
        "TOO_MANY_ATTEMPTS",
        "Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.",
        429
      );
    }
    if (outcome.kind === "failed") {
      return fail(
        "INVALID_CREDENTIALS",
        "Email hoặc mật khẩu không đúng.",
        401
      );
    }
    const user = outcome.user;

    const sessionUser = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role as Role,
      departmentId: user.departmentId,
      departmentName: user.department?.name ?? null,
    };

    // Phiên mới ký SAU mọi lần thu hồi trước đó (đăng xuất ghi
    // sessionsRevokedAt = lúc đó, còn iat ở đây >= lúc này) nên không bị chính
    // lần đăng xuất vừa rồi giết — xem loadActiveUser.
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
