import { z } from "zod";
import { handle, ok, requireUser } from "@/lib/api";
import { clientMeta } from "@/lib/audit";
import { suggestKpiAdvisory } from "@/lib/services/ai-service";

export const runtime = "nodejs";

const schema = z.object({ kpiResultId: z.string().min(1) });

/**
 * Sinh bản phân tích tham khảo cho một dòng KPI.
 *
 * KHÔNG ghi điểm. Không đụng vào kpi_results. Người duyệt đọc xong vẫn phải tự
 * gõ số của mình vào ô "Số chốt" như bình thường.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = schema.parse(await req.json());

    const { advisory, suggestionId } = await suggestKpiAdvisory(
      user,
      body.kpiResultId,
      clientMeta(req)
    );

    return ok({
      suggestionId,
      ...advisory,
      disclaimer:
        "Đây là phân tích tham khảo. Điểm chính thức do trưởng phòng và Ban Giám đốc quyết định.",
    });
  });
}
