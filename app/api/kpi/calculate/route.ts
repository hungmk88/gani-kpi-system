// File: app/api/kpi/calculate/route.ts

import { z } from "zod";
import { handle, ok, requireUser } from "@/lib/api";
import { clientMeta } from "@/lib/audit";
import {
  assertCanManageProductionKpi,
  calculateShiftKpiScore,
  parseBreakdown,
} from "@/lib/kpi-calculator";
import {
  canSeeMoney,
  withProductionRole,
} from "@/lib/services/production-service";

export const runtime = "nodejs";

/**
 * Chỉ nhận mã ca. Số thực tế, kỳ KPI, mục tiêu — server tự lấy từ ca đã khoá.
 * Các trường khác client gửi kèm (periodTargetId, kpiResults... của bản cũ)
 * bị zod bỏ qua, KHÔNG BAO GIỜ được dùng để chấm điểm.
 */
const bodySchema = z.object({
  shiftLogId: z.string().trim().min(1).max(64),
});

/**
 * POST /api/kpi/calculate — tính (lại) điểm 6 chỉ tiêu cho 1 ca đã khoá.
 * Quyền: CEO, ADMIN, Trưởng phòng Sản xuất.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    await assertCanManageProductionKpi(
      user,
      "Bạn không có quyền tính điểm KPI ca sản xuất."
    );
    const { shiftLogId } = bodySchema.parse(await req.json());

    const score = await calculateShiftKpiScore(user, shiftLogId, clientMeta(req));
    const money = canSeeMoney(await withProductionRole(user));

    return ok({
      success: true,
      data: {
        id: score.id,
        shiftLogId: score.shiftLogId,
        totalScore: score.totalScore,
        bonusMultiplier: score.bonusMultiplier,
        bonusAmount: money ? score.bonusAmount : null,
        status: score.status,
        breakdown: parseBreakdown(score.breakdownJson, money),
      },
      message: "Tính điểm KPI thành công.",
    });
  });
}
