import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { assertPermission, BusinessError } from "@/lib/rbac";
import { hashPassword } from "@/lib/auth";
import { checkPasswordStrength } from "@/lib/password";
import { clientMeta, writeAudit } from "@/lib/audit";
import { ERR, ROLES } from "@/lib/constants";
import { PRODUCTION_ROLES } from "@/lib/production/constants";
import {
  alertCeos,
  isEmployeeCodeConflict,
  resolveEmployeeCode,
} from "@/lib/services/user-security";

// Thông báo lỗi tiếng Việt cho từng trường — màn quản trị hiện nguyên văn,
// không còn "Dữ liệu gửi lên không hợp lệ" chung chung.
const schema = z.object({
  email: z.string().email("Email không hợp lệ."),
  fullName: z
    .string()
    .min(2, "Họ tên tối thiểu 2 ký tự.")
    .max(255, "Họ tên quá dài."),
  jobTitle: z.string().max(255, "Chức danh quá dài.").optional(),
  employeeCode: z.string().max(100).nullable().optional(),
  role: z.enum(ROLES, { message: "Vai trò không hợp lệ." }),
  departmentId: z.string().nullable().optional(),
  // Vai trò trong xưởng (KCS, tổ trưởng…) — tách riêng khỏi vai trò tổ chức.
  productionRole: z
    .enum(PRODUCTION_ROLES, { message: "Vai trò sản xuất không hợp lệ." })
    .nullable()
    .optional(),
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

    // Vai trò xưởng mở quyền ký xác nhận phẩm chất / khoá ca (KCS, Giám đốc
    // Sản xuất) — chỉ Quản trị hệ thống gán, giống mọi quyền khác.
    if (body.productionRole && actor.role !== "ADMIN") {
      throw new BusinessError(
        ERR.FORBIDDEN,
        "Chỉ Quản trị hệ thống được gán vai trò sản xuất.",
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

    const employeeCode = await resolveEmployeeCode(body.employeeCode);

    const user = await prisma.user.create({
      data: {
        email,
        fullName: body.fullName,
        employeeCode,
        jobTitle: body.jobTitle ?? null,
        role: body.role,
        departmentId: body.departmentId ?? null,
        productionRole: body.productionRole ?? null,
        passwordHash: await hashPassword(body.password),
        telegramChatId: null,
        phone: body.phone ?? null,
        // Mật khẩu này do quản trị đặt nên quản trị biết. Người mới vào hệ thống
        // là bị chặn ở trang đổi mật khẩu, chưa xem được gì cho tới khi tự đặt.
        mustChangePassword: true,
      },
    }).catch((e) => {
      if (isEmployeeCodeConflict(e)) {
        throw new BusinessError(ERR.VALIDATION_FAILED, `Mã NV ${employeeCode} vừa được dùng cho tài khoản khác.`, 409);
      }
      throw e;
    });

    await writeAudit({
      actor,
      action: "USER_CREATE",
      entityName: "users",
      entityId: user.id,
      after: {
        email,
        employeeCode,
        role: body.role,
        departmentId: body.departmentId,
        productionRole: body.productionRole ?? null,
      },
      ...clientMeta(req),
    });

    if (body.role === "CEO") {
      await alertCeos(
        `Vừa tạo tài khoản Ban Giám đốc mới: ${email}`,
        `Người thực hiện: ${actor.email}. Nếu không phải chủ ý của Ban Giám đốc, khoá tài khoản này ngay.`
      );
    } else if (body.role === "MANAGER" || body.productionRole) {
      // Trưởng phòng duyệt KPI cả phòng; vai trò xưởng ký KCS / khoá ca —
      // tạo mới cũng nhạy cảm như ĐỔI sang các vai trò này (route [id]).
      const what = [
        body.role === "MANAGER" ? "trưởng phòng" : null,
        body.productionRole ? `vai trò sản xuất ${body.productionRole}` : null,
      ]
        .filter(Boolean)
        .join(", ");
      await alertCeos(
        `Vừa tạo tài khoản ${what}: ${email}`,
        `Người thực hiện: ${actor.email}. Nếu không phải chủ ý của Ban Giám đốc, khoá tài khoản này ngay.`
      ).catch((e) => console.error("[USER_CREATE] Không gửi được báo động Ban Giám đốc:", e));
    }

    return ok({ user }, 201);
  });
}
