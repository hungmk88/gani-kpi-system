import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { assertCanAssignTask, BusinessError } from "@/lib/rbac";
import { clientMeta, writeAudit } from "@/lib/audit";
import { notify, sendCeoAlert } from "@/lib/telegram";
import { scoreTaskRisk } from "@/lib/risk";
import { riskContextFor } from "@/lib/services/risk-service";
import { PUBLIC_USER_SELECT } from "@/lib/services/task-service";
import { formatVnDateTime } from "@/lib/vn-time";
import { ERR, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/constants";

const patchSchema = z.object({
  title: z.string().min(3).max(255).optional(),
  description: z.string().max(5000).nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  dueDate: z.string().datetime().optional(),
  assigneeId: z.string().nullable().optional(),
  note: z.string().max(1000).optional(),
});

/** Nhân viên chỉ được đụng vào việc của mình; trưởng phòng đụng trong phòng. */
async function loadAndAuthorize(taskId: string, user: Awaited<ReturnType<typeof requireUser>>) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      assignee: { select: PUBLIC_USER_SELECT },
      creator: { select: PUBLIC_USER_SELECT },
      department: true,
    },
  });
  if (!task) {
    throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy công việc.", 404);
  }

  const isOwner = task.assigneeId === user.id || task.creatorId === user.id;
  const sameDept = task.departmentId === user.departmentId;

  if (user.role === "CEO") return task;
  if (user.role === "MANAGER" && (sameDept || isOwner)) return task;
  if (user.role === "EMPLOYEE" && isOwner) return task;

  throw new BusinessError(
    ERR.FORBIDDEN,
    "Bạn không có quyền xem hoặc sửa công việc này.",
    403
  );
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await requireUser();
    const task = await loadAndAuthorize(id, user);
    const comments = await prisma.taskComment.findMany({
      where: { taskId: id },
      include: { user: { select: PUBLIC_USER_SELECT } },
      orderBy: { createdAt: "asc" },
    });
    return ok({ task, comments });
  });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await requireUser();
    const task = await loadAndAuthorize(id, user);
    const body = patchSchema.parse(await req.json());

    // Người "quản" việc: BGĐ, người giao việc, hoặc trưởng phòng của chính
    // phòng sở hữu task. Người chỉ là assignee (kể cả trưởng phòng phòng khác
    // đang làm hộ) KHÔNG nằm trong nhóm này.
    const isManagerOfTask =
      user.role === "CEO" ||
      task.creatorId === user.id ||
      (user.role === "MANAGER" && task.departmentId === user.departmentId);

    // Đổi người phụ trách: phải qua đúng chốt chặn giao việc như lúc tạo,
    // tính theo phòng ban CỦA TASK và phòng ban của người nhận mới.
    if (body.assigneeId !== undefined && body.assigneeId !== task.assigneeId) {
      if (!isManagerOfTask) {
        throw new BusinessError(
          ERR.FORBIDDEN,
          "Chỉ người giao việc, trưởng phòng phụ trách hoặc Ban Giám đốc mới được đổi người phụ trách.",
          403
        );
      }
      let newAssigneeDeptId: string | null = null;
      if (body.assigneeId) {
        const newAssignee = await prisma.user.findUnique({
          where: { id: body.assigneeId },
          select: { isActive: true, departmentId: true },
        });
        if (!newAssignee || !newAssignee.isActive) {
          throw new BusinessError(
            ERR.NOT_FOUND,
            "Không tìm thấy nhân sự hoặc tài khoản đã bị khoá.",
            404
          );
        }
        newAssigneeDeptId = newAssignee.departmentId;
      }
      assertCanAssignTask(user, task.departmentId, newAssigneeDeptId);
    }

    // Hạn chót và mức ưu tiên do người giao việc quyết, người làm không tự dời.
    const dueChanged =
      body.dueDate !== undefined &&
      new Date(body.dueDate).getTime() !== new Date(task.dueDate).getTime();
    if (dueChanged && !isManagerOfTask) {
      throw new BusinessError(
        ERR.FORBIDDEN,
        "Bạn không được tự đổi hạn chót. Hãy ghi chú xin gia hạn để người giao việc quyết định.",
        403
      );
    }
    if (
      body.priority !== undefined &&
      body.priority !== task.priority &&
      !isManagerOfTask
    ) {
      throw new BusinessError(
        ERR.FORBIDDEN,
        "Chỉ người giao việc hoặc trưởng phòng phụ trách mới được đổi mức ưu tiên.",
        403
      );
    }

    if (body.status !== undefined && body.status !== task.status) {
      // Chỉ trưởng phòng / BGĐ / người giao mới được nghiệm thu (chuyển sang DONE)
      if (body.status === "DONE" && !isManagerOfTask) {
        throw new BusinessError(
          ERR.FORBIDDEN,
          "Người làm chuyển việc sang 'Chờ duyệt', người giao việc / trưởng phòng mới là người nghiệm thu 'Hoàn thành'.",
          403
        );
      }
      if (body.status === "CANCELLED" && !isManagerOfTask) {
        throw new BusinessError(
          ERR.FORBIDDEN,
          "Chỉ người giao việc, trưởng phòng phụ trách hoặc Ban Giám đốc mới được huỷ việc.",
          403
        );
      }
      // Mở lại việc đã nghiệm thu / đã huỷ cũng là quyền của người quản việc
      if (
        (task.status === "DONE" || task.status === "CANCELLED") &&
        !isManagerOfTask
      ) {
        throw new BusinessError(
          ERR.FORBIDDEN,
          task.status === "DONE"
            ? "Việc đã nghiệm thu — chỉ người giao việc hoặc trưởng phòng mới được mở lại."
            : "Việc đã huỷ — chỉ người giao việc hoặc trưởng phòng mới được mở lại.",
          403
        );
      }
    }

    const before = {
      status: task.status,
      priority: task.priority,
      progress: task.progress,
      assigneeId: task.assigneeId,
      dueDate: task.dueDate,
    };

    const data: Record<string, unknown> = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.description !== undefined) data.description = body.description;
    if (body.priority !== undefined) data.priority = body.priority;
    if (body.progress !== undefined) data.progress = body.progress;
    if (body.dueDate !== undefined) data.dueDate = new Date(body.dueDate);
    if (body.assigneeId !== undefined) data.assigneeId = body.assigneeId;

    if (body.status !== undefined) {
      data.status = body.status;
      if (body.status === "BLOCKED" && task.status !== "BLOCKED") {
        data.blockedSince = new Date();
      }
      if (body.status !== "BLOCKED") data.blockedSince = null;
      if (body.status === "DONE") {
        // Gửi lại DONE cho việc đã DONE thì giữ nguyên thời điểm hoàn thành cũ
        if (task.status !== "DONE" || !task.completedAt) {
          data.completedAt = new Date();
        }
        data.progress = 100;
      } else if (task.status === "DONE") {
        data.completedAt = null;
      }
    }

    const merged = {
      status: (data.status as string) ?? task.status,
      priority: (data.priority as string) ?? task.priority,
      progress: (data.progress as number) ?? task.progress,
      startDate: task.startDate,
      dueDate: (data.dueDate as Date) ?? task.dueDate,
      blockedSince:
        data.blockedSince !== undefined
          ? (data.blockedSince as Date | null)
          : task.blockedSince,
      assigneeId:
        data.assigneeId !== undefined
          ? (data.assigneeId as string | null)
          : task.assigneeId,
    };
    const riskCtx = await riskContextFor(id, merged.assigneeId);
    const risk = scoreTaskRisk({ ...merged, ...riskCtx });
    data.riskScore = risk.score;
    data.riskReason = risk.reason || null;
    data.riskScannedAt = new Date();

    const updated = await prisma.task.update({
      where: { id },
      data,
      include: {
        assignee: { select: PUBLIC_USER_SELECT },
        department: true,
      },
    });

    // Ghi vết đổi trạng thái vào dòng thời gian của task
    if (body.status && body.status !== task.status) {
      await prisma.taskComment.create({
        data: {
          taskId: id,
          userId: user.id,
          kind: "STATUS_CHANGE",
          body: `Chuyển trạng thái: ${task.status} → ${body.status}${
            body.note ? ` · ${body.note}` : ""
          }`,
        },
      });
    }

    await writeAudit({
      actor: user,
      action: "TASK_UPDATE",
      entityName: "tasks",
      entityId: id,
      before,
      after: {
        status: updated.status,
        priority: updated.priority,
        progress: updated.progress,
        assigneeId: updated.assigneeId,
        dueDate: updated.dueDate,
      },
      reason: body.note ?? null,
      ...clientMeta(req),
    });

    // Báo người mới nhận việc
    if (
      body.assigneeId &&
      body.assigneeId !== task.assigneeId &&
      body.assigneeId !== user.id
    ) {
      await notify({
        userId: body.assigneeId,
        title: `Bạn được chuyển giao việc: ${updated.title}`,
        body: `Người chuyển: ${user.fullName} · Hạn ${formatVnDateTime(
          updated.dueDate
        )}`,
        level: "INFO",
        linkUrl: `/tasks/${id}`,
      });
    }

    // Việc bị chặn -> báo trưởng phòng của phòng đó
    if (body.status === "BLOCKED" && task.status !== "BLOCKED") {
      const managers = await prisma.user.findMany({
        where: {
          departmentId: updated.departmentId,
          role: "MANAGER",
          isActive: true,
        },
        select: { id: true },
      });
      for (const m of managers) {
        if (m.id === user.id) continue;
        await notify({
          userId: m.id,
          title: `Việc bị chặn: ${updated.title}`,
          body: `${user.fullName} báo việc đang tắc.${
            body.note ? ` Lý do: ${body.note}` : ""
          }`,
          level: "WARNING",
          linkUrl: `/tasks/${id}`,
        });
      }
    }

    // Việc vọt lên báo động đỏ -> Ban Giám đốc
    if (risk.score >= 80 && task.riskScore < 80) {
      await sendCeoAlert({
        title: `Việc báo động đỏ: ${updated.title}`,
        details: `Phòng ${updated.department.name} · ${
          updated.assignee?.fullName ?? "Chưa giao"
        } · Điểm rủi ro ${risk.score}/100 · ${risk.reason}`,
        actionPath: `/tasks/${id}`,
      });
    }

    return ok({ task: updated, risk });
  });
}
