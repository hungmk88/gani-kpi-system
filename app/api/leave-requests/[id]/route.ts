import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { BusinessError } from "@/lib/rbac";
import { clientMeta, writeAudit } from "@/lib/audit";
import { notify } from "@/lib/telegram";
import { ERR } from "@/lib/constants";
import { formatVnDate } from "@/lib/vn-time";
import { assertLeaveQuota, lockLeaveOwner } from "@/lib/services/leave-service";

/** Đơn đã bị người khác xử lý trước (bấm đúp, hai người duyệt cùng lúc). */
function alreadyHandled(): never {
  throw new BusinessError(ERR.VALIDATION_FAILED, "Đơn đã được xử lý.", 409);
}

const schema = z.object({
  action: z.enum(["APPROVE", "REJECT", "CANCEL"]),
  note: z.string().max(1000).optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await requireUser();
    const body = schema.parse(await req.json());

    const request = await prisma.leaveRequest.findUnique({
      where: { id },
      include: { employee: { select: { id: true, role: true } } },
    });
    if (!request) {
      throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy đơn nghỉ phép.", 404);
    }
    if (request.status !== "PENDING") {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        "Đơn đã được xử lý.",
        409
      );
    }

    if (body.action === "CANCEL") {
      if (request.employeeId !== user.id) {
        throw new BusinessError(
          ERR.FORBIDDEN,
          "Chỉ người gửi mới huỷ được đơn của chính mình.",
          403
        );
      }
      // Cập nhật có điều kiện status = PENDING: kiểm tra ở trên chỉ là đọc
      // trước, giữa lúc đọc và lúc ghi đơn có thể đã được duyệt.
      const res = await prisma.leaveRequest.updateMany({
        where: { id, status: "PENDING", employeeId: user.id },
        data: { status: "CANCELLED", resolvedAt: new Date() },
      });
      if (res.count !== 1) alreadyHandled();
      await writeAudit({
        actor: user,
        action: "LEAVE_REQUEST_CANCEL",
        entityName: "leave_requests",
        entityId: id,
        ...clientMeta(req),
      });
      return ok({ status: "CANCELLED" });
    }

    // Trưởng phòng xin nghỉ, hoặc Admin xin nghỉ -> chỉ CEO được duyệt.
    // Nhân viên thường -> CEO hoặc đúng Trưởng phòng của phòng ban đó.
    const requesterNeedsCeo =
      request.employee.role === "MANAGER" || request.employee.role === "ADMIN";
    const isDeptManager =
      user.role === "MANAGER" && user.departmentId === request.departmentId;
    const canReview = user.role === "CEO" || (!requesterNeedsCeo && isDeptManager);
    if (!canReview) {
      throw new BusinessError(
        ERR.FORBIDDEN,
        requesterNeedsCeo
          ? "Chỉ Ban Giám đốc mới duyệt được đơn nghỉ của Trưởng phòng/Quản trị."
          : "Chỉ Trưởng phòng của người gửi hoặc Ban Giám đốc mới duyệt được đơn này.",
        403
      );
    }

    if (body.action === "REJECT") {
      if (!body.note?.trim()) {
        throw new BusinessError(
          ERR.REASON_REQUIRED,
          "Từ chối đơn nghỉ bắt buộc ghi lý do.",
          400
        );
      }
      const res = await prisma.leaveRequest.updateMany({
        where: { id, status: "PENDING" },
        data: {
          status: "REJECTED",
          reviewedById: user.id,
          reviewNote: body.note,
          resolvedAt: new Date(),
        },
      });
      if (res.count !== 1) alreadyHandled();
      await writeAudit({
        actor: user,
        action: "LEAVE_REQUEST_REJECT",
        entityName: "leave_requests",
        entityId: id,
        reason: body.note,
        ...clientMeta(req),
      });
      await notify({
        userId: request.employeeId,
        title: "Đơn nghỉ phép bị từ chối",
        body: `${user.fullName} từ chối. Lý do: ${body.note}`,
        level: "WARNING",
        linkUrl: "/leave-requests",
      });
      return ok({ status: "REJECTED" });
    }

    // APPROVE — kiểm lại hạn mức (đã DUYỆT + đơn này) và chuyển trạng thái
    // trong cùng một transaction, khoá theo người xin nghỉ để hai đơn của
    // cùng một người không cùng lọt hạn mức khi được duyệt song song.
    await prisma.$transaction(async (tx) => {
      await lockLeaveOwner(tx, request.employeeId);
      await assertLeaveQuota(
        tx,
        request.employeeId,
        request.startDate,
        request.endDate,
        id
      );
      const res = await tx.leaveRequest.updateMany({
        where: { id, status: "PENDING" },
        data: {
          status: "APPROVED",
          reviewedById: user.id,
          reviewNote: body.note ?? null,
          resolvedAt: new Date(),
        },
      });
      if (res.count !== 1) alreadyHandled();
    });
    await writeAudit({
      actor: user,
      action: "LEAVE_REQUEST_APPROVE",
      entityName: "leave_requests",
      entityId: id,
      ...clientMeta(req),
    });
    await notify({
      userId: request.employeeId,
      title: "Đơn nghỉ phép đã được duyệt",
      body: `${user.fullName} đã duyệt đơn nghỉ từ ${formatVnDate(
        request.startDate
      )} đến ${formatVnDate(request.endDate)}.`,
      level: "INFO",
      linkUrl: "/leave-requests",
    });
    return ok({ status: "APPROVED" });
  });
}
