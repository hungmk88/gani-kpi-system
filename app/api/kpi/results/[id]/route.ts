import { z } from "zod";
import { handle, ok, requireUser } from "@/lib/api";
import { assertPermission, BusinessError } from "@/lib/rbac";
import { clientMeta } from "@/lib/audit";
import {
  editAfterLock,
  managerReview,
  submitSelfReview,
} from "@/lib/services/kpi-service";
import { ERR } from "@/lib/constants";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("SELF_REVIEW"),
    actualSelf: z.number().finite(),
    selfNote: z.string().max(2000).optional(),
    evidenceUrl: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal("MANAGER_REVIEW"),
    actualFinal: z.number().finite(),
    managerNote: z.string().max(2000).optional(),
    reason: z.string().max(2000).optional(),
  }),
  z.object({
    action: z.literal("EDIT_LOCKED"),
    actualFinal: z.number().finite(),
    reason: z.string().min(10, "Lý do phải rõ ràng, tối thiểu 10 ký tự."),
  }),
]);

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await requireUser();
    const body = schema.parse(await req.json());
    const meta = clientMeta(req);

    switch (body.action) {
      case "SELF_REVIEW": {
        assertPermission(user, "kpi.self_review");
        const r = await submitSelfReview(user, id, body, meta);
        return ok({ result: r });
      }
      case "MANAGER_REVIEW": {
        assertPermission(user, "kpi.manager_review");
        const r = await managerReview(user, id, body, meta);
        return ok({ result: r });
      }
      case "EDIT_LOCKED": {
        assertPermission(user, "kpi.edit_after_lock");
        const r = await editAfterLock(user, id, body, meta);
        return ok({ result: r });
      }
      default:
        throw new BusinessError(
          ERR.VALIDATION_FAILED,
          "Hành động không hợp lệ.",
          400
        );
    }
  });
}
