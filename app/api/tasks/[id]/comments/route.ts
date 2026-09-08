import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { BusinessError } from "@/lib/rbac";
import { notify } from "@/lib/telegram";
import { ERR } from "@/lib/constants";

const schema = z.object({
  body: z.string().min(1, "Chưa nhập nội dung.").max(2000),
  kind: z.enum(["COMMENT", "EVIDENCE"]).default("COMMENT"),
  fileUrl: z.string().max(1000).nullable().optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await requireUser();
    const input = schema.parse(await req.json());

    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) {
      throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy công việc.", 404);
    }

    const sameDept = task.departmentId === user.departmentId;
    const isOwner = task.assigneeId === user.id || task.creatorId === user.id;
    if (user.role === "EMPLOYEE" && !isOwner) {
      throw new BusinessError(
        ERR.FORBIDDEN,
        "Bạn không tham gia công việc này.",
        403
      );
    }
    if (user.role === "MANAGER" && !sameDept && !isOwner) {
      throw new BusinessError(
        ERR.FORBIDDEN,
        "Công việc không thuộc phòng ban của bạn.",
        403
      );
    }

    const comment = await prisma.taskComment.create({
      data: {
        taskId: id,
        userId: user.id,
        body: input.body,
        kind: input.kind,
        fileUrl: input.fileUrl ?? null,
      },
      include: { user: true },
    });

    // Báo cho những người liên quan còn lại
    const targets = new Set(
      [task.assigneeId, task.creatorId].filter(
        (x): x is string => !!x && x !== user.id
      )
    );
    for (const t of targets) {
      await notify({
        userId: t,
        title: `Trao đổi mới trong việc: ${task.title}`,
        body: `${user.fullName}: ${input.body.slice(0, 180)}`,
        level: "INFO",
        linkUrl: `/tasks/${id}`,
      });
    }

    return ok({ comment }, 201);
  });
}
