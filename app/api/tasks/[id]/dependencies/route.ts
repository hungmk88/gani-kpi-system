import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { BusinessError } from "@/lib/rbac";
import { clientMeta, writeAudit } from "@/lib/audit";
import { wouldCreateCycle } from "@/lib/gantt";
import { ERR } from "@/lib/constants";

const schema = z.object({
  dependsOnId: z.string().min(1, "Chưa chọn việc cần chờ."),
});

/** Chỉ trưởng phòng của phòng đó và Ban Giám đốc mới nối được quan hệ phụ thuộc. */
async function authorize(
  taskId: string,
  user: Awaited<ReturnType<typeof requireUser>>
) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) {
    throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy công việc.", 404);
  }
  if (user.role === "CEO") return task;
  if (user.role === "MANAGER" && task.departmentId === user.departmentId) {
    return task;
  }
  throw new BusinessError(
    ERR.FORBIDDEN,
    "Chỉ trưởng phòng phụ trách và Ban Giám đốc mới sửa được quan hệ phụ thuộc.",
    403
  );
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await requireUser();
    const task = await authorize(id, user);
    const body = schema.parse(await req.json());

    if (body.dependsOnId === id) {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        "Một công việc không thể chờ chính nó.",
        400
      );
    }

    const blocker = await prisma.task.findUnique({
      where: { id: body.dependsOnId },
    });
    if (!blocker) {
      throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy việc cần chờ.", 404);
    }

    // Trưởng phòng chỉ nối được trong phạm vi phòng mình
    if (user.role === "MANAGER" && blocker.departmentId !== user.departmentId) {
      throw new BusinessError(
        ERR.FORBIDDEN,
        "Việc cần chờ thuộc phòng ban khác. Nhờ Ban Giám đốc nối giúp, hoặc dùng Yêu cầu liên phòng ban.",
        403
      );
    }

    // Chặn vòng lặp ngay từ lúc thêm
    const edges = await prisma.taskDependency.findMany({
      select: { taskId: true, dependsOnId: true },
    });
    if (wouldCreateCycle(edges, id, body.dependsOnId)) {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        `Nối như vậy sẽ tạo ra vòng lặp: "${task.title}" rốt cuộc lại phải chờ chính nó.`,
        400
      );
    }

    const dep = await prisma.taskDependency.upsert({
      where: {
        taskId_dependsOnId: { taskId: id, dependsOnId: body.dependsOnId },
      },
      update: {},
      create: { taskId: id, dependsOnId: body.dependsOnId },
    });

    await writeAudit({
      actor: user,
      action: "TASK_DEPENDENCY_ADD",
      entityName: "task_dependencies",
      entityId: dep.id,
      after: { task: task.title, phaiCho: blocker.title },
      ...clientMeta(req),
    });

    return ok({ dependency: dep }, 201);
  });
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await requireUser();
    await authorize(id, user);

    const dependsOnId = new URL(req.url).searchParams.get("dependsOnId");
    if (!dependsOnId) {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        "Thiếu tham số dependsOnId.",
        400
      );
    }

    await prisma.taskDependency.deleteMany({
      where: { taskId: id, dependsOnId },
    });

    await writeAudit({
      actor: user,
      action: "TASK_DEPENDENCY_REMOVE",
      entityName: "task_dependencies",
      entityId: `${id}:${dependsOnId}`,
      ...clientMeta(req),
    });

    return ok({ deleted: true });
  });
}
