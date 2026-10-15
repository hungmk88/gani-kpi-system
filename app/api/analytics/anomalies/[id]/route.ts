import { z } from "zod";
import { handle, ok, requireUser } from "@/lib/api";
import { clientMeta } from "@/lib/audit";
import {
  explainAnomaly,
  reviewAnomaly,
} from "@/lib/services/analytics-service";

export const runtime = "nodejs";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("EXPLAIN"),
    explanationText: z
      .string()
      .min(20, "Giải trình phải nói rõ nguyên nhân, tối thiểu 20 ký tự.")
      .max(2000, "Giải trình tối đa 2000 ký tự."),
  }),
  z.object({
    action: z.literal("REVIEW"),
    accepted: z.boolean(),
    reviewNote: z
      .string()
      .min(10, "Ghi rõ kết luận của bạn, tối thiểu 10 ký tự.")
      .max(2000, "Kết luận tối đa 2000 ký tự."),
  }),
]);

/**
 * Xử lý một cảnh báo khai báo KPI bất thường.
 *
 *   EXPLAIN — chính người bị nêu tên giải thích vì sao số kỳ này khác hẳn
 *   REVIEW  — trưởng phòng hoặc Ban Giám đốc chấp nhận hoặc bỏ qua
 *
 * Cảnh báo ở đây KHÔNG tự động trừ điểm hay khoá gì cả. Nó chỉ là dấu hiệu thống
 * kê: số kỳ này lệch hẳn lịch sử của chính người đó. Lệch có thể vì gian, mà
 * cũng có thể vì tháng đó có đơn hàng lớn thật.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await requireUser();
    const body = schema.parse(await req.json());
    const meta = clientMeta(req);

    if (body.action === "EXPLAIN") {
      const a = await explainAnomaly(user, id, body.explanationText, meta);
      return ok({ anomaly: a });
    }

    const a = await reviewAnomaly(
      user,
      id,
      { accepted: body.accepted, reviewNote: body.reviewNote },
      meta
    );
    return ok({ anomaly: a });
  });
}
