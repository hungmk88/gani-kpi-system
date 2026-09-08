import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { BusinessError } from "@/lib/rbac";
import { ERR } from "@/lib/constants";
import { clientMeta, writeAudit } from "@/lib/audit";
import { gatherExecutiveBriefingFacts } from "@/lib/services/analytics-service";
import { buildExecutiveBriefing } from "@/lib/ai/executive-advisor";

export const runtime = "nodejs";

/**
 * Báo cáo điều hành cho Ban Giám đốc — bấm tay.
 *
 * Điểm sức khoẻ do hệ thống tính bằng công thức cố định; AI chỉ viết phần diễn
 * giải. Kết quả được lưu vào bảng ai_suggestions như mọi thứ AI sinh ra ở Phase
 * 2 — có thể tra lại sau, và không có đường nào để nó tự thay đổi dữ liệu.
 *
 * Đường tự động (đúng ngày chốt kỳ, không cần bấm) nằm ở
 * `runMonthlyExecutiveBriefingIfDue` trong `lib/services/analytics-service.ts`,
 * gọi từ bộ máy chạy nền — cả hai đường dùng chung `gatherExecutiveBriefingFacts`
 * nên không lệch số liệu.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    if (user.role !== "CEO") {
      throw new BusinessError(
        ERR.FORBIDDEN,
        "Báo cáo điều hành dành riêng cho Ban Giám đốc.",
        403
      );
    }

    const { health, facts, accuracy } = await gatherExecutiveBriefingFacts();
    const briefing = await buildExecutiveBriefing(health, facts);

    const saved = await prisma.aiSuggestion.create({
      data: {
        kind: "EXEC_BRIEFING",
        engine: briefing.engine,
        modelName: briefing.modelName ?? "unknown",
        entityName: "system",
        entityId: "executive-briefing",
        inputText: `Sức khoẻ ${briefing.healthScore}/100 · ${facts.openTasks} việc mở · ${facts.periodName ?? "chưa có kỳ KPI"}`,
        payload: JSON.stringify(briefing),
        confidencePercent: accuracy.accuracyPercent ?? 0,
        rationale: briefing.executiveSummary,
        missingInfo: accuracy.total === 0 ? briefing.dataBasis : null,
        status: "PENDING",
        latencyMs: briefing.latencyMs,
        requestedById: user.id,
      },
    });

    await writeAudit({
      actor: user,
      action: "AI_EXECUTIVE_BRIEFING",
      entityName: "ai_suggestions",
      entityId: saved.id,
      after: {
        engine: briefing.engine,
        diemSucKhoe: briefing.healthScore,
        soRuiRo: briefing.keyRisks.length,
      },
      ...clientMeta(req),
    });

    return ok({
      briefingId: saved.id,
      ...briefing,
      healthBreakdown: health.parts,
      accuracy,
      disclaimer:
        "Điểm sức khoẻ do hệ thống tính bằng công thức cố định trên dữ liệu thật. Phần diễn giải và khuyến nghị là gợi ý — quyết định vẫn là của Ban Giám đốc.",
    });
  });
}
