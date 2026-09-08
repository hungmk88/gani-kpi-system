// File: app/api/kpi/dashboard/export/route.ts

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  getDashboardSummary,
  getDashboardDistribution,
  getDashboardTrends,
  type DashboardPeriod,
} from "@/lib/services/kpi-dashboard";
import { buildDashboardReport } from "@/lib/excel";

export const runtime = "nodejs";

/** Xuất Excel cho Dashboard KPI sản xuất — cùng số với 3 API vẽ biểu đồ. */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({ where: { id: session.id } });
    if (!user || !["CEO", "ADMIN"].includes(user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { period = "today", days = "7" } = Object.fromEntries(
      request.nextUrl.searchParams
    );
    const numDays = Math.min(90, Math.max(1, parseInt(days) || 7));

    const [summary, distribution, trends] = await Promise.all([
      getDashboardSummary(period as DashboardPeriod),
      getDashboardDistribution(),
      getDashboardTrends(numDays),
    ]);

    const buffer = await buildDashboardReport({
      period,
      summary,
      distribution,
      trends,
    });

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(buffer as ArrayBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="GANI_Dashboard_KPI_${period}_${stamp}.xlsx"`,
      },
    });
  } catch (error) {
    console.error("Error exporting dashboard report:", error);
    return NextResponse.json(
      { error: "Failed to export report" },
      { status: 500 }
    );
  }
}
