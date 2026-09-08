import { z } from "zod";
import { handle, ok, requireUser } from "@/lib/api";
import { clientMeta } from "@/lib/audit";
import { resolveReconciliation } from "@/lib/services/reconciliation-service";

export const runtime = "nodejs";

const schema = z.object({
  value: z.number().finite(),
  sourceCode: z.string().min(1, "Chưa chọn nguồn số liệu."),
  reason: z
    .string()
    .min(10, "Lý do phải rõ ràng, tối thiểu 10 ký tự."),
});

/**
 * Chốt số cho một ô KPI đang có các nguồn đá nhau.
 *
 * Đây là chỗ duy nhất phá được thế treo. Hệ thống cố tình không tự chọn nguồn:
 * ai chốt, chốt số nào, vì lý do gì — đều phải có tên người ký vào.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await requireUser();
    const body = schema.parse(await req.json());

    const result = await resolveReconciliation(user, id, body, clientMeta(req));

    return ok({
      resolved: true,
      kpiResult: {
        id: result.id,
        actualSystem: result.actualSystem,
        achievementPercent: result.achievementPercent,
        weightedScore: result.weightedScore,
        hasMismatch: result.hasMismatch,
      },
    });
  });
}
