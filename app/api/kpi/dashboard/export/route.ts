// File: app/api/kpi/dashboard/export/route.ts

import { NextRequest } from "next/server";
import { handle, requireUser } from "@/lib/api";
import {
  assertDashboardAccess,
  getDashboardSummary,
  getDashboardDistribution,
  getDashboardTrends,
  normalizePeriod,
  redactDashboardMoney,
} from "@/lib/services/kpi-dashboard";
import { buildDashboardReport } from "@/lib/excel";
import { vnDateKey } from "@/lib/vn-time";

export const runtime = "nodejs";

/** Xuất Excel cho Dashboard KPI sản xuất — cùng số với 3 API vẽ biểu đồ. */
export async function GET(request: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const { includeMoney } = await assertDashboardAccess(user);

    const params = request.nextUrl.searchParams;
    const period = normalizePeriod(params.get("period"));
    const numDays = Math.min(90, Math.max(1, parseInt(params.get("days") ?? "7", 10) || 7));

    const [summary, distribution, trends] = await Promise.all([
      getDashboardSummary(period),
      getDashboardDistribution(),
      getDashboardTrends(numDays),
    ]);

    const buffer = await buildDashboardReport({
      period,
      summary: includeMoney ? summary : redactDashboardMoney(summary),
      distribution,
      trends: includeMoney ? trends : redactDashboardMoney(trends),
    });

    return new Response(buffer as ArrayBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="GANI_Dashboard_KPI_${period}_${vnDateKey()}.xlsx"`,
      },
    });
  });
}
