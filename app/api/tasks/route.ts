import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { taskScopeWhere } from "@/lib/rbac";
import { clientMeta } from "@/lib/audit";
import { createTask, PUBLIC_USER_SELECT } from "@/lib/services/task-service";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/constants";

const createSchema = z.object({
  title: z.string().min(3, "Tiêu đề quá ngắn.").max(255),
  description: z.string().max(5000).optional(),
  departmentId: z.string().min(1, "Thiếu phòng ban."),
  assigneeId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  kpiDefinitionId: z.string().nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  dueDate: z.string().datetime("Hạn chót không hợp lệ."),
  priority: z.enum(TASK_PRIORITIES).default("MEDIUM"),
  // Việc mới chỉ được mở ở trạng thái chưa xong — không tạo thẳng DONE/CANCELLED.
  status: z
    .enum(["BACKLOG", "TO_DO", "IN_PROGRESS"], {
      message: "Việc mới chỉ được tạo ở trạng thái Chờ xếp / Cần làm / Đang làm.",
    })
    .default("TO_DO"),
});

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const url = new URL(req.url);

    const status = url.searchParams.get("status");
    const priority = url.searchParams.get("priority");
    const assigneeId = url.searchParams.get("assigneeId");
    const departmentId = url.searchParams.get("departmentId");
    const q = url.searchParams.get("q");
    const filter = url.searchParams.get("filter");

    const where: Record<string, unknown> = { ...taskScopeWhere(user) };
    if (status && (TASK_STATUSES as readonly string[]).includes(status))
      where.status = status;
    if (priority && (TASK_PRIORITIES as readonly string[]).includes(priority))
      where.priority = priority;
    if (assigneeId) where.assigneeId = assigneeId;
    if (departmentId && (user.role === "CEO" || user.role === "ADMIN"))
      where.departmentId = departmentId;
    if (q) where.title = { contains: q };
    if (filter === "overdue") {
      where.dueDate = { lt: new Date() };
      where.status = { notIn: ["DONE", "CANCELLED"] };
    }

    const tasks = await prisma.task.findMany({
      where,
      include: {
        assignee: { select: PUBLIC_USER_SELECT },
        department: true,
        project: true,
      },
      orderBy: [{ riskScore: "desc" }, { dueDate: "asc" }],
      take: 300,
    });

    return ok({ tasks, count: tasks.length });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = createSchema.parse(await req.json());

    // Toàn bộ nghiệp vụ nằm trong createTask — kể cả chốt chặn giao việc vượt cấp
    const task = await createTask(
      user,
      {
        title: body.title,
        description: body.description ?? null,
        departmentId: body.departmentId,
        assigneeId: body.assigneeId ?? null,
        projectId: body.projectId ?? null,
        kpiDefinitionId: body.kpiDefinitionId ?? null,
        startDate: body.startDate ? new Date(body.startDate) : null,
        dueDate: new Date(body.dueDate),
        priority: body.priority,
        status: body.status,
      },
      clientMeta(req)
    );

    return ok({ task }, 201);
  });
}
