import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { BusinessError } from "@/lib/rbac";
import { clientMeta, writeAudit } from "@/lib/audit";
import { notify } from "@/lib/telegram";
import { ERR } from "@/lib/constants";
import { formatVnDate, parseVnDate } from "@/lib/vn-time";
import {
  assertLeaveQuota,
  assertNoLeaveOverlap,
  lockLeaveOwner,
} from "@/lib/services/leave-service";

const LEAVE_NOTICE_HOURS = 24;

// Ngày nghỉ là NGÀY (không có giờ): nhận "YYYY-MM-DD"; vẫn nhận ISO đầy đủ
// cho client cũ — cả hai đều quy về 00:00 giờ VN của ngày đó.
const dateInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .or(z.string().datetime());

const schema = z.object({
  startDate: dateInput,
  endDate: dateInput,
  reason: z.string().min(3).max(1000),
});

function toVnDay(input: string): Date {
  try {
    return parseVnDate(input);
  } catch {
    throw new BusinessError(ERR.VALIDATION_FAILED, "Ngày nghỉ không hợp lệ.", 400);
  }
}

/**
 * Đơn xin nghỉ, luật báo trước 24 tiếng: KHÔNG chặn cứng khi gửi trễ hơn — ốm
 * đột xuất là chuyện thật, chặn cứng dễ gây phẫn nộ và vô nhân đạo. Hệ thống
 * chỉ đánh dấu isUrgent để người duyệt thấy rõ ngay đây là trường hợp không
 * kịp báo trước, quyết định vẫn thuộc về con người.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = schema.parse(await req.json());

    const startDate = toVnDay(body.startDate);
    const endDate = toVnDay(body.endDate);
    if (endDate < startDate) {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        "Ngày kết thúc không được trước ngày bắt đầu.",
        400
      );
    }

    // Báo trước tính từ 00:00 giờ VN của ngày bắt đầu nghỉ.
    const noticeMs = startDate.getTime() - Date.now();
    const isUrgent = noticeMs < LEAVE_NOTICE_HOURS * 3600_000;

    // CEO không có ai ở trên để duyệt -> tự động duyệt luôn.
    const autoApprove = user.role === "CEO";

    const managers =
      !autoApprove && user.role !== "MANAGER" && user.role !== "ADMIN"
        ? await prisma.user.findMany({
            where: {
              departmentId: user.departmentId ?? "__none__",
              role: "MANAGER",
              isActive: true,
            },
            select: { id: true },
          })
        : [];

    // Trưởng phòng xin nghỉ, Admin xin nghỉ, hoặc phòng chưa có trưởng phòng
    // -> Ban Giám đốc duyệt thẳng.
    const needsCeo =
      !autoApprove &&
      (user.role === "MANAGER" || user.role === "ADMIN" || managers.length === 0);

    // Hạn mức: chặn ngay khi gửi nếu (đã DUYỆT + đơn này) vượt 12 ngày/năm
    // hoặc 6 ngày/nửa năm — đơn đang chờ khác không tính, lúc duyệt kiểm lại.
    // CEO tự duyệt cũng phải qua đúng bước này.
    const request = await prisma.$transaction(async (tx) => {
      await lockLeaveOwner(tx, user.id);
      // Không cho hai đơn (chờ / đã duyệt) của cùng một người chồng ngày nhau —
      // nếu không, một ngày nghỉ bị trừ phép hai lần.
      await assertNoLeaveOverlap(tx, user.id, startDate, endDate);
      await assertLeaveQuota(tx, user.id, startDate, endDate);
      return tx.leaveRequest.create({
        data: {
          employeeId: user.id,
          departmentId: user.departmentId,
          startDate,
          endDate,
          reason: body.reason,
          isUrgent,
          status: autoApprove ? "APPROVED" : "PENDING",
          reviewedById: autoApprove ? user.id : null,
          resolvedAt: autoApprove ? new Date() : null,
        },
      });
    });

    await writeAudit({
      actor: user,
      action: "LEAVE_REQUEST_CREATE",
      entityName: "leave_requests",
      entityId: request.id,
      after: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        isUrgent,
        autoApprove,
      },
      ...clientMeta(req),
    });

    if (!autoApprove) {
      const urgentTag = isUrgent ? "🔴 KHẨN CẤP (không đủ 24h báo trước) — " : "";
      const recipients = needsCeo
        ? await prisma.user.findMany({
            where: { role: "CEO", isActive: true },
            select: { id: true },
          })
        : managers;

      for (const r of recipients) {
        await notify({
          userId: r.id,
          title: `${urgentTag}Đơn nghỉ phép từ ${user.fullName}`,
          body: `Từ ${formatVnDate(startDate)} đến ${formatVnDate(endDate)}. Lý do: ${body.reason}`,
          level: isUrgent ? "CRITICAL" : "WARNING",
          linkUrl: "/leave-requests",
        });
      }

      if (recipients.length === 0) {
        await notify({
          userId: user.id,
          title: "Đơn nghỉ phép chưa có ai nhận duyệt",
          body: "Phòng bạn chưa có trưởng phòng và hệ thống chưa tìm được Ban Giám đốc. Báo trực tiếp cho quản trị hệ thống.",
          level: "WARNING",
          linkUrl: "/leave-requests",
        });
      }
    }

    return ok({ request }, 201);
  });
}

export async function GET() {
  return handle(async () => {
    const user = await requireUser();

    const where =
      user.role === "CEO" || user.role === "ADMIN"
        ? {}
        : user.role === "MANAGER"
          ? {
              OR: [
                { employeeId: user.id },
                {
                  departmentId: user.departmentId ?? "__none__",
                  employee: { role: { not: "MANAGER" } },
                },
              ],
            }
          : { employeeId: user.id };

    const requests = await prisma.leaveRequest.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            role: true,
            departmentId: true,
            department: { select: { id: true, name: true, code: true } },
          },
        },
        reviewedBy: { select: { id: true, fullName: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
    return ok({ requests });
  });
}
