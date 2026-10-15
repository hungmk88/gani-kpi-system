import { prisma } from "../db";
import { assertCanAssignTask, BusinessError } from "../rbac";
import { ERR, type TaskPriority, type TaskStatus } from "../constants";
import { nextTaskCode, retryOnCodeClash } from "../codes";
import { writeAudit } from "../audit";
import { notify, sendCeoAlert } from "../telegram";
import { scoreTaskRisk } from "../risk";
import { riskContextFor } from "./risk-service";
import type { SessionUser } from "../auth";
import { formatVnDateTime } from "../vn-time";

/**
 * Trường của User được phép trả ra API khi kèm theo task/bình luận/yêu cầu.
 * KHÔNG dùng `include: { assignee: true }` — sẽ lộ số điện thoại,
 * telegramChatId... của người khác.
 */
export const PUBLIC_USER_SELECT = {
  id: true,
  fullName: true,
  email: true,
  departmentId: true,
  jobTitle: true,
} as const;

/** Trạng thái được phép khi mới tạo việc — không tạo thẳng việc đã xong/đã huỷ. */
const INITIAL_STATUSES: readonly TaskStatus[] = [
  "BACKLOG",
  "TO_DO",
  "IN_PROGRESS",
];

export type CreateTaskInput = {
  title: string;
  description?: string | null;
  departmentId: string;
  assigneeId?: string | null;
  projectId?: string | null;
  kpiDefinitionId?: string | null;
  startDate?: Date | null;
  dueDate: Date;
  priority: TaskPriority;
  status?: TaskStatus;
  /** Đánh dấu việc này sinh ra từ đề xuất của máy, kèm mức tự tin lúc đó. */
  isAiGenerated?: boolean;
  aiConfidence?: number | null;
};

type Meta = { ip?: string | null; userAgent?: string | null };

/**
 * NƠI DUY NHẤT tạo ra một công việc.
 *
 * Cả đường tạo tay lẫn đường máy đọc câu lệnh đều phải đi qua đây, nên luật cấm
 * giao việc vượt cấp không có cửa nào lách được. Thêm một lối tạo task mới mà
 * quên gọi hàm này là thủng luật — nên đừng thêm.
 */
export async function createTask(
  actor: SessionUser,
  input: CreateTaskInput,
  meta: Meta = {}
) {
  let assigneeDeptId: string | null = null;
  if (input.assigneeId) {
    const assignee = await prisma.user.findUnique({
      where: { id: input.assigneeId },
      select: { isActive: true, departmentId: true },
    });
    if (!assignee || !assignee.isActive) {
      throw new BusinessError(
        ERR.NOT_FOUND,
        "Người được giao việc không tồn tại hoặc đã bị khoá.",
        404
      );
    }
    assigneeDeptId = assignee.departmentId;
  }

  // Chốt chặn của Ban Giám đốc
  assertCanAssignTask(actor, input.departmentId, assigneeDeptId);

  const dueDate = new Date(input.dueDate);
  const startDate = input.startDate ? new Date(input.startDate) : new Date();
  // Việc mới tạo luôn bắt đầu ở trạng thái "đang mở" — chặn tạo thẳng DONE
  // (né khâu nghiệm thu) hoặc CANCELLED.
  const status: TaskStatus =
    input.status && INITIAL_STATUSES.includes(input.status)
      ? input.status
      : "TO_DO";

  const ctx = await riskContextFor(null, input.assigneeId ?? null);
  const risk = scoreTaskRisk({
    status,
    priority: input.priority,
    progress: 0,
    startDate,
    dueDate,
    blockedSince: null,
    assigneeId: input.assigneeId ?? null,
    ...ctx,
  });

  const task = await retryOnCodeClash(async () =>
    prisma.task.create({
    data: {
      code: await nextTaskCode(),
      title: input.title,
      description: input.description ?? null,
      departmentId: input.departmentId,
      assigneeId: input.assigneeId ?? null,
      creatorId: actor.id,
      projectId: input.projectId ?? null,
      kpiDefinitionId: input.kpiDefinitionId ?? null,
      startDate,
      dueDate,
      priority: input.priority,
      status,
      riskScore: risk.score,
      riskReason: risk.reason || null,
      riskScannedAt: new Date(),
      isAiGenerated: input.isAiGenerated ?? false,
      aiConfidence: input.aiConfidence ?? null,
    },
    include: {
      assignee: { select: PUBLIC_USER_SELECT },
      department: true,
    },
  }));

  await writeAudit({
    actor,
    action: input.isAiGenerated ? "TASK_CREATE_FROM_AI" : "TASK_CREATE",
    entityName: "tasks",
    entityId: task.id,
    after: {
      code: task.code,
      title: task.title,
      assigneeId: task.assigneeId,
      aiConfidence: input.aiConfidence ?? null,
    },
    ...meta,
  });

  if (task.assigneeId && task.assigneeId !== actor.id) {
    await notify({
      userId: task.assigneeId,
      title: `Bạn được giao việc mới: ${task.title}`,
      body: `Người giao: ${actor.fullName} · Hạn chót: ${formatVnDateTime(dueDate)} · Mức ưu tiên: ${input.priority}`,
      level: input.priority === "CRITICAL" ? "CRITICAL" : "INFO",
      linkUrl: `/tasks/${task.id}`,
    });
  }

  if (input.priority === "CRITICAL") {
    await sendCeoAlert({
      title: `Việc khẩn cấp vừa được tạo: ${task.title}`,
      details: `Phòng ${task.department.name} · Giao cho ${
        task.assignee?.fullName ?? "CHƯA GIAO"
      } · Hạn ${formatVnDateTime(dueDate)} · Người tạo ${actor.fullName}`,
      actionPath: `/tasks/${task.id}`,
    });
  }

  return task;
}
