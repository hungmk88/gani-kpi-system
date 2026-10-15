import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { BusinessError } from "@/lib/rbac";
import { clientMeta } from "@/lib/audit";
import {
  approveByQc,
  canSeeMoney,
  redactShiftForViewer,
  lockAndTriggerKpi,
  reopenShift,
  withProductionRole,
} from "@/lib/services/production-service";
import { computeShiftMetrics } from "@/lib/production/kpi-engine";
import { ERR } from "@/lib/constants";

export const runtime = "nodejs";

// Trần an toàn cho mọi số kg nhập tay: một ca thực tế không tới 100 tấn. Số
// vô lý (gõ thừa chữ số, Infinity) làm tràn cột tiền Int khi tính tổn thất.
const MAX_KG = 100_000;
const kg = (label: string) =>
  z
    .number({ invalid_type_error: `${label} phải là số.` })
    .finite(`${label} không hợp lệ.`)
    .min(0, `${label} không được âm.`)
    .max(MAX_KG, `${label} vượt trần ${MAX_KG.toLocaleString("vi-VN")} kg.`);
const count = z.number().int().min(0).max(10_000);

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("QC_APPROVE"),
    qcPassedKg: kg("Sản lượng đạt"),
    reworkKg: kg("Khối lượng làm lại"),
    scrapKg: kg("Khối lượng phế"),
    haccpViolationCount: count,
    qcNote: z.string().max(2000).optional(),
    participantDefects: z
      .array(
        z.object({
          userId: z.string().min(1),
          personalDefectKg: kg("Lỗi cá nhân"),
          violationCount: count,
          note: z.string().max(500).optional(),
        })
      )
      .optional(),
  }),
  z.object({
    action: z.literal("CEO_LOCK"),
    targetOutputKg: kg("Chỉ tiêu sản lượng").positive("Chỉ tiêu sản lượng phải lớn hơn 0."),
    rawMaterialInputKg: kg("Nguyên liệu cấp vào").optional(),
    targetOverrideReason: z.string().max(1000).optional(),
    materialOverrideReason: z.string().max(1000).optional(),
    ceoNote: z.string().max(2000).optional(),
  }),
  z.object({
    action: z.literal("REOPEN"),
    reason: z.string().min(10, "Mở lại ca đã khoá bắt buộc ghi lý do."),
  }),
]);

/**
 * Xem chi tiết một ca.
 *
 * BẢO MẬT CẤP ĐỘ TRƯỜNG DỮ LIỆU: chỉ Ban Giám đốc và Giám đốc Sản xuất mới thấy
 * phần quy ra tiền (tổn thất VNĐ, đơn giá) và chi tiết cảnh báo chống chạy chỉ
 * tiêu. Công nhân xem được số liệu ca và điểm của mình, không xem được tiền.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await withProductionRole(await requireUser());

    const log = await prisma.productionShiftLog.findUnique({
      where: { id },
      include: {
        sku: true,
        createdBy: { select: { id: true, fullName: true } },
        qcOfficer: { select: { id: true, fullName: true } },
        lockedBy: { select: { id: true, fullName: true } },
        participants: { select: { userId: true } },
        kpiResults: { include: { user: { select: { id: true, fullName: true } } } },
        audits: {
          include: {
            explainedBy: { select: { id: true, fullName: true } },
            reviewedBy: { select: { id: true, fullName: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!log) {
      throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy ca sản xuất.", 404);
    }

    const isParticipant = log.participants.some((p) => p.userId === user.id);
    const isWide =
      user.role === "CEO" ||
      user.role === "ADMIN" ||
      ["SUPERVISOR", "QC_OFFICER", "PRODUCTION_DIRECTOR"].includes(
        user.productionRole ?? ""
      );
    if (!isWide && !isParticipant && log.createdById !== user.id) {
      throw new BusinessError(
        ERR.FORBIDDEN,
        "Bạn không tham gia ca này.",
        403
      );
    }

    const metrics = computeShiftMetrics({
      rawOutputKg: log.rawOutputKg,
      qcPassedKg: log.qcPassedKg,
      reworkKg: log.reworkKg,
      scrapKg: log.scrapKg,
      haccpViolationCount: log.haccpViolationCount,
      totalLaborHours: log.totalLaborHours,
      downtimeHours: log.downtimeHours,
      targetOutputKg: log.targetOutputKg,
      rawMaterialInputKg: log.rawMaterialInputKg,
      stdMaterialNormKg: log.stdMaterialNormKg,
    });

    /* --- Phần ai cũng xem được --- */
    const response: Record<string, unknown> = {
      shift: {
        id: log.id,
        shiftDate: log.shiftDate,
        shiftType: log.shiftType,
        status: log.status,
        skuCode: log.sku.skuCode,
        skuName: log.sku.skuName,
        rawOutputKg: log.rawOutputKg,
        qcPassedKg: log.qcPassedKg,
        reworkKg: log.reworkKg,
        scrapKg: log.scrapKg,
        haccpViolationCount: log.haccpViolationCount,
        totalLaborHours: log.totalLaborHours,
        downtimeHours: log.downtimeHours,
        targetOutputKg: log.targetOutputKg,
        rawMaterialInputKg: log.rawMaterialInputKg,
        stdMaterialNormKg: log.stdMaterialNormKg,
        createdBy: log.createdBy.fullName,
        qcOfficer: log.qcOfficer?.fullName ?? null,
        lockedBy: log.lockedBy?.fullName ?? null,
        qcApprovedAt: log.qcApprovedAt,
        lockedAt: log.lockedAt,
      },
      metrics,
      // Công nhân chỉ thấy điểm của chính mình; cấp quản lý thấy cả ca
      kpiScores: log.kpiResults
        .filter((r) => isWide || r.userId === user.id)
        .map((r) => ({
          userId: r.userId,
          fullName: r.user.fullName,
          tier1Score: r.tier1Score,
          tier2Score: r.tier2Score,
          finalWeightedScore: r.finalWeightedScore,
          isBonusLocked: r.isBonusLocked,
          breakdown: r.breakdownJson ? JSON.parse(r.breakdownJson) : null,
        })),
      auditCount: log.audits.length,
    };

    /* --- Phần chỉ Ban Giám đốc và Giám đốc Sản xuất xem được --- */
    if (canSeeMoney(user)) {
      response.financialData = {
        qualityLossVnd: log.qualityLossVnd,
        unitPriceVnd: log.sku.unitPriceVnd,
        materialCostImpact:
          (log.rawMaterialInputKg - log.stdMaterialNormKg) *
          log.sku.unitPriceVnd,
      };
      response.antiGamingAudits = log.audits;
      response.overrides = {
        targetOverrideReason: log.targetOverrideReason,
        materialOverrideReason: log.materialOverrideReason,
        skuStandardTargetKg: log.sku.targetOutputKg,
      };
    }

    return ok(response);
  });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await withProductionRole(await requireUser());
    const body = actionSchema.parse(await req.json());
    const meta = clientMeta(req);

    switch (body.action) {
      case "QC_APPROVE": {
        const r = await approveByQc(user, id, body, meta);
        return ok({ shift: redactShiftForViewer(r, user) });
      }
      case "CEO_LOCK": {
        const r = await lockAndTriggerKpi(user, id, body, meta);
        return ok({
          shift: r.log,
          tier2Score: r.tier2.score,
          scored: r.results.length,
          findings: r.findings,
          bonusLocked: r.bonusLocked,
          metrics: r.metrics,
        });
      }
      case "REOPEN": {
        const r = await reopenShift(user, id, body.reason, meta);
        return ok({ shift: r });
      }
    }
  });
}
