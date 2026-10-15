// File: app/api/kpi/targets/[period]/route.ts

import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { BusinessError } from "@/lib/rbac";
import { ERR } from "@/lib/constants";
import {
  PRODUCTION_KPI_SCOPE,
  assertCanManageProductionKpi,
  getKpiDefinitions,
} from "@/lib/kpi-calculator";

export const runtime = "nodejs";

/**
 * GET /api/kpi/targets/[periodId] — mục tiêu KPI Phòng SX của 1 kỳ.
 * Quyền: CEO, ADMIN, Trưởng phòng Sản xuất.
 * Trọng số 6 chỉ tiêu đọc từ KpiConfig (thiếu thì dùng số gốc).
 */
export async function GET(
  _req: Request,
  context: { params: Promise<{ period: string }> }
) {
  return handle(async () => {
    const user = await requireUser();
    await assertCanManageProductionKpi(user, "Bạn không có quyền xem mục tiêu KPI Phòng SX.");
    const { period: periodId } = await context.params;

    const period = await prisma.kpiPeriod.findUnique({ where: { id: periodId } });
    if (!period) {
      throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy kỳ KPI.", 404);
    }

    const [periodTarget, defs] = await Promise.all([
      prisma.kpiPeriodTarget.findUnique({
        where: { periodId },
        include: {
          createdBy: { select: { id: true, fullName: true } },
          lastEditedBy: { select: { id: true, fullName: true } },
          shiftTargets: {
            orderBy: [{ shiftDate: "asc" }, { shiftType: "asc" }],
          },
        },
      }),
      getKpiDefinitions(),
    ]);

    const periodLocked = period.status === "FINALIZED" || period.isLocked;
    const isCeo = user.role === "CEO";

    return ok({
      period: {
        id: period.id,
        month: period.month,
        year: period.year,
        name: period.name,
        status: period.status,
      },
      periodTarget: periodTarget ?? {
        id: null,
        status: "NOT_CREATED",
        department: PRODUCTION_KPI_SCOPE,
        output_target: null,
        waste_target: null,
        quality_target: null,
        spec_target: null,
        safety_target: null,
        deadline_target: null,
      },
      shiftTargets: periodTarget?.shiftTargets ?? [],
      kpiDefinitions: defs.map((d) => ({
        code: d.code,
        name: d.name,
        unit: d.unit,
        weight: d.weight,
        isHigherBetter: d.isHigherBetter,
      })),
      permissions: {
        canApprove: isCeo && !periodLocked,
        canEdit:
          !periodLocked &&
          (isCeo ||
            (period.status !== "MANAGER_LOCKED" &&
              periodTarget?.status !== "LOCKED")),
      },
    });
  });
}
