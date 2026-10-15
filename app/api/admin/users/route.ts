import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { assertPermission, BusinessError } from "@/lib/rbac";
import { hashPassword } from "@/lib/auth";
import { checkPasswordStrength } from "@/lib/password";
import { clientMeta, writeAudit } from "@/lib/audit";
import { ERR, ROLES } from "@/lib/constants";
import { alertCeos } from "@/lib/services/user-security";

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
    // Quản trị (admin.users) tạo được mọi vai trò TRỪ Ban Giám đốc. Ban Giám
    // đốc không có admin.users — chỉ đi qua đường này để tạo tài khoản CEO.
    const actorIsCeo = actor.role === "CEO";
    if (!actorIsCeo) assertPermission(actor, "admin.users");
    const body = schema.parse(await req.json());

    if (body.role === "CEO" && !actorIsCeo) {
      // Tạo CEO là trao quyền "Duyệt & khoá" KPI toàn công ty.
      throw new BusinessError(
        ERR.FORBIDDEN,
        "Quản trị không được tạo tài khoản Ban Giám đốc. Việc này do Ban Giám đốc thực hiện.",
        403
      );
    }
    if (body.role !== "CEO" && actorIsCeo) {
      throw new BusinessError(
        ERR.FORBIDDEN,
        "Tài khoản vai trò khác do Quản trị hệ thống tạo. Ban Giám đốc chỉ tạo ở đây tài khoản Ban Giám đốc.",
        403
      );
    }
    // Telegram chỉ chính chủ tự nối bằng mã liên kết (trang Thông báo) — với
    // MỌI vai trò, không riêng Ban Giám đốc. Ai đặt sẵn được Chat ID thì trỏ
    // được thông báo (và các nút bấm duyệt trong chat) của người khác về
    // Telegram của mình.
    if (body.telegramChatId) {
      throw new BusinessError(
        ERR.FORBIDDEN,
        "Không đặt sẵn Telegram khi tạo tài khoản. Người dùng tự liên kết trong trang Thông báo.",
        403
      );
    }

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
        telegramChatId: null,
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

    if (body.role === "CEO") {
      await alertCeos(
        `Vừa tạo tài khoản Ban Giám đốc mới: ${email}`,
        `Người thực hiện: ${actor.email}. Nếu không phải chủ ý của Ban Giám đốc, khoá tài khoản này ngay.`
      );
    }

    return ok({ user }, 201);
  });
}
