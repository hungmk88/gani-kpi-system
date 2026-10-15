// File: app/api/kpi/calculate/[shiftId]/route.ts

import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { BusinessError } from "@/lib/rbac";
import { ERR } from "@/lib/constants";
import { canManageProductionKpi, parseBreakdown } from "@/lib/kpi-calculator";
import {
  canSeeMoney,
  withProductionRole,
} from "@/lib/services/production-service";

export const runtime = "nodejs";

/** Vai trò trong xưởng được xem điểm mọi ca — khớp trang /production/[id]. */
const WIDE_PRODUCTION_ROLES = ["SUPERVISOR", "QC_OFFICER", "PRODUCTION_DIRECTOR"];

/**
 * GET /api/kpi/calculate/[shiftId] — kết quả điểm 6 chỉ tiêu của 1 ca.
 * Người xem: Ban Giám đốc / quản trị / TP Sản xuất / quản lý xưởng, hoặc người
 * khai, người tham gia ca. Tiền thưởng chỉ trả về cho người được xem tiền.
 */
export async function GET(
  _req: Request,
  context: { params: Promise<{ shiftId: string }> }
) {
  return handle(async () => {
    const user = await withProductionRole(await requireUser());
    const { shiftId } = await context.params;

    const shift = await prisma.productionShiftLog.findUnique({
      where: { id: shiftId },
      select: {
        createdById: true,
        participants: { where: { userId: user.id }, select: { userId: true } },
      },
    });
    if (!shift) {
      throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy ca sản xuất.", 404);
    }

    const allowed =
      WIDE_PRODUCTION_ROLES.includes(user.productionRole ?? "") ||
      shift.createdById === user.id ||
      shift.participants.length > 0 ||
      (await canManageProductionKpi(user));
    if (!allowed) {
      throw new BusinessError(ERR.FORBIDDEN, "Bạn không có quyền xem điểm ca này.", 403);
    }

    const score = await prisma.shiftKpiScore.findUnique({
      where: { shiftLogId: shiftId },
      include: {
        calculatedBy: { select: { id: true, fullName: true } },
        approvedBy: { select: { id: true, fullName: true } },
      },
    });
    if (!score) {
      throw new BusinessError(ERR.NOT_FOUND, "Ca này chưa được tính điểm KPI.", 404);
    }

    const money = canSeeMoney(user);
    return ok({
      success: true,
      data: {
        id: score.id,
        shiftLogId: score.shiftLogId,
        status: score.status,
        totalScore: score.totalScore,
        bonusMultiplier: score.bonusMultiplier,
        bonusAmount: money ? score.bonusAmount : null,
        baseSalary: money ? score.baseSalary : null,
        breakdown: parseBreakdown(score.breakdownJson, money),
        calculatedAt: score.calculatedAt,
        calculatedBy: score.calculatedBy,
        approvedAt: score.approvedAt,
        approvedBy: score.approvedBy,
      },
    });
  });
}
