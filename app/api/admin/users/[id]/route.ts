import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { assertPermission, BusinessError } from "@/lib/rbac";
import { hashPassword } from "@/lib/auth";
import { checkPasswordStrength } from "@/lib/password";
import { clientMeta, writeAudit } from "@/lib/audit";
import { ERR, ROLE_LABEL, ROLES } from "@/lib/constants";
import { EMPLOYMENT_TYPES, PRODUCTION_ROLES } from "@/lib/production/constants";
import {
  alertCeos,
  isEmployeeCodeConflict,
  resolveEmployeeCode,
} from "@/lib/services/user-security";

/** Vai trò có quyền duyệt KPI — đổi mật khẩu/vai trò của họ phải báo Ban Giám đốc. */
const SENSITIVE_ROLES = new Set<string>(["MANAGER", "CEO"]);

const schema = z.object({
  fullName: z.string().min(2).max(255).optional(),
  jobTitle: z.string().max(255).nullable().optional(),
  // "" hoặc null = gỡ mã
  employeeCode: z.string().max(100).nullable().optional(),
  role: z.enum(ROLES).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  departmentId: z.string().nullable().optional(),
  // null = gỡ vai trò xưởng (người không làm ở xưởng)
  productionRole: z
    .enum(PRODUCTION_ROLES, { message: "Vai trò sản xuất không hợp lệ." })
    .nullable()
    .optional(),
  telegramChatId: z.string().max(100).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  isActive: z.boolean().optional(),
  newPassword: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự.").optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const { id } = await ctx.params;
    const actor = await requireUser();
    // Quản trị (admin.users) quản lý tài khoản thường. Tài khoản Ban Giám đốc
    // thì ngược lại: chỉ Ban Giám đốc được đụng vào (xem chặn bên dưới). Ban
    // Giám đốc KHÔNG có quyền admin.users — họ chỉ đi qua đường này cho đúng
    // các thao tác trên tài khoản Ban Giám đốc / nâng người lên Ban Giám đốc.
    const actorIsCeo = actor.role === "CEO";
    if (!actorIsCeo) assertPermission(actor, "admin.users");
    const body = schema.parse(await req.json());

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) {
      throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy tài khoản.", 404);
    }

    // Quản trị chỉ được GỠ liên kết Telegram (null), không được đặt giá trị:
    // đặt được Chat ID là trỏ được thông báo và nút "Duyệt" của người khác về
    // Telegram của mình. Nối Telegram chỉ qua mã liên kết chính chủ tự lấy ở
    // trang Thông báo. Chuỗi rỗng coi như gỡ.
    if (typeof body.telegramChatId === "string") {
      if (body.telegramChatId.trim() !== "") {
        throw new BusinessError(
          ERR.FORBIDDEN,
          "Không được đặt Telegram Chat ID hộ người khác — chỉ được gỡ liên kết. Người dùng tự liên kết trong trang Thông báo.",
          403
        );
      }
      body.telegramChatId = null;
    }

    const promotingToCeo = body.role === "CEO" && target.role !== "CEO";
    const touchesCeoAccount = target.role === "CEO" || promotingToCeo;

    if (actorIsCeo && !touchesCeoAccount) {
      throw new BusinessError(
        ERR.FORBIDDEN,
        "Tài khoản này do Quản trị hệ thống quản lý. Ban Giám đốc chỉ sửa ở đây các tài khoản Ban Giám đốc.",
        403
      );
    }

    // CHỐNG CHIẾM TÀI KHOẢN BAN GIÁM ĐỐC: quản trị đặt lại mật khẩu / đổi
    // Telegram / đổi quyền / khoá một tài khoản CEO là đủ để đăng nhập thay
    // CEO rồi "Duyệt & khoá" KPI toàn công ty. Những việc này chỉ Ban Giám đốc
    // làm. CEO quên mật khẩu thì một CEO khác đặt lại; CEO tự đổi mật khẩu của
    // mình ở /doi-mat-khau. (Schema PATCH không có email nên không đổi được.)
    if (!actorIsCeo) {
      if (promotingToCeo) {
        throw new BusinessError(
          ERR.FORBIDDEN,
          "Quản trị không được nâng tài khoản lên Ban Giám đốc. Việc này do Ban Giám đốc thực hiện.",
          403
        );
      }
      if (target.role === "CEO") {
        const blocked: string[] = [];
        if (body.newPassword) blocked.push("đặt lại mật khẩu");
        if (body.role !== undefined && body.role !== target.role) blocked.push("đổi vai trò");
        if (body.isActive !== undefined && body.isActive !== target.isActive) {
          blocked.push(body.isActive ? "mở khoá" : "khoá");
        }
        if (
          body.telegramChatId !== undefined &&
          body.telegramChatId !== target.telegramChatId
        ) {
          blocked.push("đổi Telegram");
        }
        if (blocked.length > 0) {
          throw new BusinessError(
            ERR.FORBIDDEN,
            `Quản trị không được ${blocked.join(", ")} tài khoản Ban Giám đốc. Việc này chỉ Ban Giám đốc thực hiện.`,
            403
          );
        }
      }
    }

    // Vai trò xưởng mở quyền ký xác nhận phẩm chất / khoá ca — chỉ Quản trị
    // hệ thống gán hoặc gỡ (Ban Giám đốc đi qua route này chỉ để lo tài khoản
    // Ban Giám đốc, không gán quyền xưởng).
    if (
      body.productionRole !== undefined &&
      body.productionRole !== target.productionRole &&
      actor.role !== "ADMIN"
    ) {
      throw new BusinessError(
        ERR.FORBIDDEN,
        "Chỉ Quản trị hệ thống được đổi vai trò sản xuất.",
        403
      );
    }

    // Không cho tự khoá chính mình -> tránh mất lối vào hệ thống
    if (target.id === actor.id && body.isActive === false) {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        "Không thể tự khoá tài khoản của chính bạn.",
        400
      );
    }

    // Quản trị không tự nâng mình lên Ban Giám đốc (tách quyền: ADMIN không
    // được duyệt KPI hay giao việc — xem lib/rbac.ts).
    if (target.id === actor.id && body.role === "CEO" && actor.role !== "CEO") {
      throw new BusinessError(
        ERR.FORBIDDEN,
        "Không thể tự nâng quyền tài khoản của chính bạn lên Ban Giám đốc.",
        403
      );
    }

    // Telegram của Ban Giám đốc là kênh bấm "Duyệt & khoá" KPI — chỉ chính chủ
    // được liên kết (qua mã liên kết trong trang Thông báo), không ai khác
    // được trỏ nó sang tài khoản Telegram khác. Xét cả vai trò HIỆN TẠI lẫn
    // vai trò SAU khi sửa: một lệnh {role:"CEO", telegramChatId} không được lọt.
    const roleAfter = body.role ?? target.role;
    if (
      (target.role === "CEO" || roleAfter === "CEO") &&
      target.id !== actor.id &&
      body.telegramChatId !== undefined &&
      body.telegramChatId !== target.telegramChatId
    ) {
      throw new BusinessError(
        ERR.FORBIDDEN,
        "Không được sửa Telegram của tài khoản Ban Giám đốc. Người đó tự liên kết trong trang Thông báo.",
        403
      );
    }

    // Luôn phải còn ít nhất một CEO đang hoạt động
    if (
      target.role === "CEO" &&
      ((body.role !== undefined && body.role !== "CEO") || body.isActive === false)
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
      "productionRole",
      "telegramChatId",
      "phone",
      "isActive",
    ] as const) {
      if (body[k] !== undefined) data[k] = body[k];
    }
    if (body.employeeCode !== undefined) {
      data.employeeCode = await resolveEmployeeCode(body.employeeCode, id);
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
      // Mốc đổi mật khẩu = bây giờ -> mọi phiên cũ của người này mất hiệu lực
      // (lib/auth.ts loadActiveUser).
      data.passwordChangedAt = new Date();
      // Đặt lại mật khẩu = coi như tài khoản có thể đã lọt. Cắt luôn Telegram:
      // chat đang nối vẫn bấm "Duyệt & khoá" / nhận thông báo được, và người
      // đang cầm chat đó chưa chắc là chính chủ. Chính chủ tự nối lại bằng mã
      // mới sau khi đổi mật khẩu.
      data.telegramChatId = null;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({ where: { id }, data }).catch((e) => {
        if (isEmployeeCodeConflict(e)) {
          throw new BusinessError(ERR.VALIDATION_FAILED, `Mã NV ${String(data.employeeCode)} vừa được dùng cho tài khoản khác.`, 409);
        }
        throw e;
      });
      if (body.newPassword) {
        // Mã nối Telegram đang chờ (lấy trước lúc đặt lại) cũng huỷ luôn.
        await tx.telegramLink.deleteMany({ where: { userId: id, usedAt: null } });
      }
      return u;
    });

    await writeAudit({
      actor,
      action: "USER_UPDATE",
      entityName: "users",
      entityId: id,
      before: {
        employeeCode: target.employeeCode,
        role: target.role,
        employmentType: target.employmentType,
        departmentId: target.departmentId,
        productionRole: target.productionRole,
        isActive: target.isActive,
        telegramChatId: target.telegramChatId,
      },
      after: {
        employeeCode: updated.employeeCode,
        role: updated.role,
        employmentType: updated.employmentType,
        departmentId: updated.departmentId,
        productionRole: updated.productionRole,
        isActive: updated.isActive,
        telegramChatId: updated.telegramChatId,
        passwordReset: !!body.newPassword,
      },
      ...clientMeta(req),
    });

    if (promotingToCeo) {
      await alertCeos(
        `Tài khoản ${updated.email} vừa được nâng lên Ban Giám đốc`,
        `Người thực hiện: ${actor.email}. Nếu không phải chủ ý của Ban Giám đốc, khoá tài khoản này ngay.`
      );
    } else if (
      updated.role !== target.role &&
      (SENSITIVE_ROLES.has(target.role) || SENSITIVE_ROLES.has(updated.role))
    ) {
      await alertCeos(
        `Đổi vai trò ${updated.email}: ${ROLE_LABEL[target.role] ?? target.role} → ${ROLE_LABEL[updated.role] ?? updated.role}`,
        `Người thực hiện: ${actor.email}. Nếu không phải chủ ý của Ban Giám đốc, kiểm tra lại ngay.`
      );
    }

    if (body.newPassword && SENSITIVE_ROLES.has(target.role)) {
      await alertCeos(
        `Mật khẩu của ${updated.email} (${ROLE_LABEL[target.role] ?? target.role}) vừa bị đặt lại`,
        `Người thực hiện: ${actor.email}. Telegram của tài khoản này đã bị ngắt. Nếu không phải yêu cầu của chính chủ, khoá tài khoản này ngay.`
      );
    }

    return ok({ user: updated });
  });
}
