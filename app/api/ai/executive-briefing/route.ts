import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { BusinessError } from "@/lib/rbac";
import { ERR } from "@/lib/constants";
import { clientMeta, writeAudit } from "@/lib/audit";
import {
  buildHealthSnapshot,
  getPredictionAccuracy,
  runPredictiveScan,
} from "@/lib/services/analytics-service";
import { buildExecutiveBriefing } from "@/lib/ai/executive-advisor";
import { round2, summarizeResults } from "@/lib/kpi";

export const runtime = "nodejs";

/**
 * Báo cáo điều hành cho Ban Giám đốc.
 *
 * Điểm sức khoẻ do hệ thống tính bằng công thức cố định; AI chỉ viết phần diễn
 * giải. Kết quả được lưu vào bảng ai_suggestions như mọi thứ AI sinh ra ở Phase
 * 2 — có thể tra lại sau, và không có đường nào để nó tự thay đổi dữ liệu.
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

    const [snapshot, scan, accuracy] = await Promise.all([
      buildHealthSnapshot(),
      runPredictiveScan({ persist: false }),
      getPredictionAccuracy(),
    ]);

    /* --- Phòng ban yếu nhất theo điểm KPI --- */
    const period = await prisma.kpiPeriod.findFirst({
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });
    const weakest: { name: string; avgScore: number }[] = [];
    if (period) {
      const depts = await prisma.department.findMany();
      for (const d of depts) {
        const rows = await prisma.kpiResult.findMany({
          where: { periodId: period.id, employee: { departmentId: d.id } },
          select: { employeeId: true, weightPercent: true, weightedScore: true, achievementPercent: true },
        });
        if (rows.length === 0) continue;
        const byEmp = new Map<string, typeof rows>();
        for (const r of rows) {
          byEmp.set(r.employeeId, [...(byEmp.get(r.employeeId) ?? []), r]);
        }
        const scores = [...byEmp.values()].map(
          (list) => summarizeResults(list).totalScore
        );
        if (scores.length === 0) continue;
        weakest.push({
          name: d.name,
          avgScore: round2(scores.reduce((a, b) => a + b, 0) / scores.length),
        });
      }
      weakest.sort((a, b) => a.avgScore - b.avgScore);
    }

    const mostLoaded = snapshot.capacity.reports
      .filter((r) => r.workloadStatus === "OVERLOADED")
      .slice(0, 3)
      .map((r) => ({
        name: r.fullName,
        utilizationPercent: r.utilizationPercent,
      }));

    const briefing = await buildExecutiveBriefing(snapshot.health, {
      periodName: snapshot.facts.periodName,
      openTasks: snapshot.facts.openTasks,
      overdueTasks: snapshot.facts.overdueTasks,
      criticalRiskTasks: snapshot.facts.criticalRiskTasks,
      overloadedPeople: snapshot.facts.overloadedPeople,
      underutilizedPeople: snapshot.facts.underutilizedPeople,
      totalPeople: snapshot.facts.totalPeople,
      mismatchCells: snapshot.facts.mismatchCells,
      totalKpiCells: snapshot.facts.totalKpiCells,
      openAnomalies: snapshot.facts.openAnomalies,
      predictedHighRisk: scan.highRisk,
      predictedModerate: scan.moderateRisk,
      predictionAccuracy: accuracy.accuracyPercent,
      predictionSampleSize: accuracy.total,
      weakestDepartments: weakest.slice(0, 3),
      mostLoaded,
    });

    const saved = await prisma.aiSuggestion.create({
      data: {
        kind: "EXEC_BRIEFING",
        engine: briefing.engine,
        modelName: briefing.modelName ?? "unknown",
        entityName: "system",
        entityId: "executive-briefing",
        inputText: `Sức khoẻ ${briefing.healthScore}/100 · ${snapshot.facts.openTasks} việc mở · ${snapshot.facts.periodName ?? "chưa có kỳ KPI"}`,
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
      healthBreakdown: snapshot.health.parts,
      accuracy,
      disclaimer:
        "Điểm sức khoẻ do hệ thống tính bằng công thức cố định trên dữ liệu thật. Phần diễn giải và khuyến nghị là gợi ý — quyết định vẫn là của Ban Giám đốc.",
    });
  });
}
