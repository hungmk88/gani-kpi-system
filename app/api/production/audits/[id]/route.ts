import { z } from "zod";
import { handle, ok, requireUser } from "@/lib/api";
import { clientMeta } from "@/lib/audit";
import {
  reviewAudit,
  submitExplanation,
  withProductionRole,
} from "@/lib/services/production-service";

export const runtime = "nodejs";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("EXPLAIN"),
    explanationText: z
      .string()
      .min(20, "Giải trình phải nói rõ nguyên nhân, tối thiểu 20 ký tự."),
  }),
  z.object({
    action: z.literal("REVIEW"),
    approved: z.boolean(),
    reviewNote: z
      .string()
      .min(10, "Ghi rõ ý kiến của bạn, tối thiểu 10 ký tự."),
  }),
]);

/**
 * Xử lý một cảnh báo chạy chỉ tiêu.
 *
 *   EXPLAIN — quản đốc / tổ trưởng nói vì sao số liệu ra như vậy
 *   REVIEW  — Ban Giám đốc chấp nhận (mở khoá thưởng) hoặc từ chối (giữ khoá)
 *
 * Thưởng chỉ mở khi ca đó KHÔNG còn cảnh báo nào treo và không có cảnh báo nào
 * bị từ chối. Duyệt một cái mà còn hai cái đang chờ thì vẫn khoá.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await withProductionRole(await requireUser());
    const body = schema.parse(await req.json());
    const meta = clientMeta(req);

    if (body.action === "EXPLAIN") {
      const audit = await submitExplanation(
        user,
        id,
        body.explanationText,
        meta
      );
      return ok({ audit });
    }

    const res = await reviewAudit(
      user,
      id,
      { approved: body.approved, reviewNote: body.reviewNote },
      meta
    );
    return ok(res);
  });
}
