import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { BusinessError } from "@/lib/rbac";
import { notify } from "@/lib/telegram";
import { PUBLIC_USER_SELECT } from "@/lib/services/task-service";
import { ERR } from "@/lib/constants";
import { canCommentTask, taskAccessFor } from "@/lib/task-access";
import { isHttpUrl } from "@/lib/http-url";

const schema = z.object({
  body: z.string().min(1, "Chưa nhập nội dung.").max(2000),
  kind: z.enum(["COMMENT", "EVIDENCE"]).default("COMMENT"),
  fileUrl: z
    .string()
    .trim()
    .max(1000, "Đường dẫn tệp quá dài.")
    .refine(isHttpUrl, "Đường dẫn tệp phải bắt đầu bằng http:// hoặc https://.")
    .nullable()
    .optional(),
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

    // Cùng luật với GET/PATCH /api/tasks/[id] (lib/task-access.ts): người tham
    // gia việc + người gửi Yêu cầu liên phòng ban được trao đổi. Quản trị hệ
    // thống chỉ XEM — trước đây route này cho ADMIN bình luận vào mọi việc
    // trong khi chính trang chi tiết qua API lại chặn ADMIN.
    const access = await taskAccessFor(task, user);
    if (!canCommentTask(access)) {
      throw new BusinessError(
        ERR.FORBIDDEN,
        access === "VIEW"
          ? "Quản trị hệ thống chỉ xem được công việc, không tham gia trao đổi."
          : "Bạn không tham gia công việc này.",
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
      include: { user: { select: PUBLIC_USER_SELECT } },
    });

    // Báo cho những người liên quan còn lại — kể cả người gửi Yêu cầu liên
    // phòng ban (họ theo dõi việc mình nhờ). Gửi hỏng không làm hỏng bình luận.
    const requesters = await prisma.crossDeptRequest.findMany({
      where: { createdTaskId: id },
      select: { requesterId: true },
    });
    const targets = new Set(
      [task.assigneeId, task.creatorId, ...requesters.map((r) => r.requesterId)].filter(
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
      }).catch((e) => console.error("[COMMENT] Gửi thông báo lỗi:", e));
    }

    return ok({ comment }, 201);
  });
}
