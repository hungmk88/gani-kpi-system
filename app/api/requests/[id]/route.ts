import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { BusinessError } from "@/lib/rbac";
import { clientMeta, writeAudit } from "@/lib/audit";
import { notify } from "@/lib/telegram";
import { nextTaskCode } from "@/lib/codes";
import { scoreTaskRisk } from "@/lib/risk";
import { riskContextFor } from "@/lib/services/risk-service";
import { ERR } from "@/lib/constants";

const schema = z.object({
  action: z.enum(["ACCEPT", "REJECT"]),
  assigneeId: z.string().nullable().optional(),
  rejectReason: z.string().max(1000).optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await requireUser();
    const body = schema.parse(await req.json());

    const request = await prisma.crossDeptRequest.findUnique({
      where: { id },
      include: { requester: true, targetDept: true },
    });
    if (!request) {
      throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy yêu cầu.", 404);
    }
    if (request.status !== "PENDING") {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        "Yêu cầu này đã được xử lý rồi.",
        409
      );
    }

    // Chỉ trưởng phòng của phòng nhận (hoặc CEO) mới được quyết
    const isTargetManager =
      user.role === "MANAGER" && user.departmentId === request.targetDeptId;
    if (!isTargetManager && user.role !== "CEO") {
      throw new BusinessError(
        ERR.FORBIDDEN,
        "Chỉ trưởng phòng của phòng ban nhận yêu cầu mới được tiếp nhận hoặc từ chối.",
        403
      );
    }

    if (body.action === "REJECT") {
      if (!body.rejectReason?.trim()) {
        throw new BusinessError(
          ERR.REASON_REQUIRED,
          "Từ chối yêu cầu bắt buộc ghi lý do.",
          400
        );
      }
      await prisma.crossDeptRequest.update({
        where: { id },
        data: {
          status: "REJECTED",
          approverId: user.id,
          rejectReason: body.rejectReason,
          resolvedAt: new Date(),
        },
      });
      await writeAudit({
        actor: user,
        action: "CROSS_DEPT_REQUEST_REJECT",
        entityName: "cross_dept_requests",
        entityId: id,
        reason: body.rejectReason,
        ...clientMeta(req),
      });
      await notify({
        userId: request.requesterId,
        title: `Yêu cầu bị từ chối: ${request.title}`,
        body: `${user.fullName} (phòng ${request.targetDept.name}) từ chối. Lý do: ${body.rejectReason}`,
        level: "WARNING",
        linkUrl: "/requests",
      });
      return ok({ status: "REJECTED" });
    }

    // ACCEPT — người nhận phải thuộc đúng phòng ban nhận
    if (body.assigneeId) {
      const assignee = await prisma.user.findUnique({
        where: { id: body.assigneeId },
      });
      if (!assignee || assignee.departmentId !== request.targetDeptId) {
        throw new BusinessError(
          ERR.CROSS_DEPT_ASSIGNMENT_FORBIDDEN,
          "Người được phân công phải thuộc phòng ban tiếp nhận yêu cầu.",
          403
        );
      }
    }

    const riskCtx = await riskContextFor(null, body.assigneeId ?? null);
    const risk = scoreTaskRisk({
      status: "TO_DO",
      priority: request.priority,
      progress: 0,
      startDate: new Date(),
      dueDate: request.dueDate,
      blockedSince: null,
      assigneeId: body.assigneeId ?? null,
      ...riskCtx,
    });

    const task = await prisma.task.create({
      data: {
        code: await nextTaskCode(),
        title: request.title,
        description: `[Yêu cầu từ ${request.requester.fullName}] ${
          request.description ?? ""
        }`.trim(),
        departmentId: request.targetDeptId,
        assigneeId: body.assigneeId ?? null,
        creatorId: user.id,
        startDate: new Date(),
        dueDate: request.dueDate,
        priority: request.priority,
        status: "TO_DO",
        riskScore: risk.score,
        riskReason: risk.reason || null,
        riskScannedAt: new Date(),
      },
    });

    await prisma.crossDeptRequest.update({
      where: { id },
      data: {
        status: "ACCEPTED",
        approverId: user.id,
        createdTaskId: task.id,
        resolvedAt: new Date(),
      },
    });

    await writeAudit({
      actor: user,
      action: "CROSS_DEPT_REQUEST_ACCEPT",
      entityName: "cross_dept_requests",
      entityId: id,
      after: { taskId: task.id, assigneeId: body.assigneeId ?? null },
      ...clientMeta(req),
    });

    await notify({
      userId: request.requesterId,
      title: `Yêu cầu đã được tiếp nhận: ${request.title}`,
      body: `${user.fullName} (phòng ${request.targetDept.name}) đã nhận và tạo công việc ${task.code}.`,
      level: "INFO",
      linkUrl: `/tasks/${task.id}`,
    });

    if (body.assigneeId) {
      await notify({
        userId: body.assigneeId,
        title: `Bạn được giao việc mới: ${task.title}`,
        body: `Việc đến từ yêu cầu của phòng khác. Hạn ${new Date(
          task.dueDate
        ).toLocaleString("vi-VN")}`,
        level: "INFO",
        linkUrl: `/tasks/${task.id}`,
      });
    }

    return ok({ status: "ACCEPTED", taskId: task.id });
  });
}
