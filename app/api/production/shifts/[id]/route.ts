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
  resubmitShiftDraft,
  returnShiftToProduction,
  withProductionRole,
} from "@/lib/services/production-service";
import { computeShiftMetrics } from "@/lib/production/kpi-engine";
// Cùng trần an toàn kg với form khai ca (lib/production/draft-schema.ts)
import { kgField as kg, shiftDraftSchema } from "@/lib/production/draft-schema";
import { SHIFT_RETURN_MIN_REASON } from "@/lib/production/shift-flow";
import { parseVnDate } from "@/lib/vn-time";
import { ERR } from "@/lib/constants";

export const runtime = "nodejs";

const count = z.number().int().min(0).max(10_000);

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("QC_APPROVE"),
    qcPassedKg: kg("Sản lượng đạt"),
    reworkKg: kg("Khối lượng làm lại"),
    scrapKg: kg("Khối lượng phế"),
    haccpViolationCount: count,
    qcNote: z.string().max(2000).optional(),
    /** Ban Giám đốc xác nhận thay KCS (vượt quyền) — bắt buộc ghi lý do */
    ceoOverrideReason: z.string().max(500).optional(),
    /** Lý do lệch cân đối — máy chủ bắt buộc khi lệch quá 5 kg */
    massBalanceReason: z.string().max(500).optional(),
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
    action: z.literal("RETURN"),
    reason: z
      .string()
      .trim()
      .min(SHIFT_RETURN_MIN_REASON, "Trả ca về sản xuất phải ghi rõ cần sửa gì.")
      .max(1000),
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
      case "RETURN": {
        const r = await returnShiftToProduction(user, id, body.reason, meta);
        return ok({ shift: r });
      }
      case "REOPEN": {
        const r = await reopenShift(user, id, body.reason, meta);
        return ok({ shift: r });
      }
    }
  });
}

/** Người khai sửa ca bị KCS trả về rồi gửi lại (bước 1 ↺). */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await withProductionRole(await requireUser());
    const body = shiftDraftSchema.parse(await req.json());

    let shiftDate: Date;
    try {
      shiftDate = parseVnDate(body.shiftDate);
    } catch {
      throw new BusinessError(ERR.VALIDATION_FAILED, "Ngày ca không hợp lệ.", 400);
    }

    const r = await resubmitShiftDraft(user, id, { ...body, shiftDate }, clientMeta(req));
    return ok({ shift: r });
  });
}
