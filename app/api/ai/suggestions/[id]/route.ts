import { z } from "zod";
import { handle, ok, requireUser } from "@/lib/api";
import { clientMeta } from "@/lib/audit";
import {
  acceptTaskSuggestion,
  rejectSuggestion,
} from "@/lib/services/ai-service";
import { TASK_PRIORITIES } from "@/lib/constants";

export const runtime = "nodejs";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("ACCEPT"),
    title: z.string().min(3).max(255),
    description: z.string().max(5000).nullable().optional(),
    departmentId: z.string().min(1),
    assigneeId: z.string().nullable().optional(),
    projectId: z.string().nullable().optional(),
    dueDate: z.string().datetime("Hạn chót không hợp lệ."),
    priority: z.enum(TASK_PRIORITIES),
  }),
  z.object({
    action: z.literal("REJECT"),
    reason: z.string().max(1000).optional(),
  }),
]);

/** Người dùng quyết định số phận của một đề xuất do máy sinh ra. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await requireUser();
    const body = schema.parse(await req.json());
    const meta = clientMeta(req);

    if (body.action === "REJECT") {
      const res = await rejectSuggestion(user, id, body.reason ?? null, meta);
      return ok(res);
    }

    const task = await acceptTaskSuggestion(
      user,
      id,
      {
        title: body.title,
        description: body.description ?? null,
        departmentId: body.departmentId,
        assigneeId: body.assigneeId ?? null,
        projectId: body.projectId ?? null,
        dueDate: new Date(body.dueDate),
        priority: body.priority,
      },
      meta
    );

    return ok({ task }, 201);
  });
}
