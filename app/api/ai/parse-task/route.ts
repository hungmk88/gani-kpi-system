import { z } from "zod";
import { handle, ok, requireUser } from "@/lib/api";
import { clientMeta } from "@/lib/audit";
import { suggestTaskFromText } from "@/lib/services/ai-service";
import { MAX_INPUT_CHARS } from "@/lib/ai/provider";

export const runtime = "nodejs";
// Gọi Gemini có thể mất tới ~25-30s ở dòng model "thinking" — trần mặc định
// của Vercel không đủ, xem lib/ai/provider.ts.
export const maxDuration = 60;

const schema = z.object({
  text: z
    .string()
    .min(5, "Câu lệnh quá ngắn, chưa đủ để hiểu là việc gì.")
    .max(MAX_INPUT_CHARS),
});

/**
 * Đọc câu lệnh tự do thành công việc có cấu trúc.
 *
 * KHÔNG tạo công việc. Chỉ trả về bản nháp kèm mức tự tin và danh sách thông tin
 * còn thiếu. Muốn thành việc thật thì gọi tiếp POST /api/ai/suggestions/:id.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = schema.parse(await req.json());

    const { suggestion, parsed } = await suggestTaskFromText(
      user,
      body.text,
      clientMeta(req)
    );

    return ok({
      suggestionId: suggestion.id,
      draft: {
        title: parsed.title,
        description: parsed.description,
        assigneeId: parsed.assigneeId,
        assigneeName: parsed.assigneeName,
        dueDate: parsed.dueDate,
        priority: parsed.priority,
      },
      confidencePercent: parsed.confidencePercent,
      rationale: parsed.rationale,
      missingInfo: parsed.missingInfo,
      engine: parsed.engine,
      modelName: parsed.modelName,
      latencyMs: parsed.latencyMs,
      sanitizeFlagged: parsed.sanitizeFlags.length > 0,
      engineError: parsed.engineError,
      // Nói thẳng cho giao diện biết: đây mới là đề xuất
      isDraft: true,
    });
  });
}
