// File: app/api/kpi/dashboard/summary/route.ts

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  getDashboardSummary,
  type DashboardPeriod,
} from "@/lib/services/kpi-dashboard";

export async function GET(request: NextRequest) {
  try {
    // Auth check
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Permission check
    const user = await prisma.user.findUnique({
      where: { id: session.id },
    });

    if (!user || !["CEO", "ADMIN"].includes(user.role)) {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 }
      );
    }

    // Get period from query
    const { period = "today" } = Object.fromEntries(
      request.nextUrl.searchParams
    );

    const data = await getDashboardSummary(period as DashboardPeriod);

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Error fetching dashboard summary:", error);
    return NextResponse.json(
      { error: "Failed to fetch summary" },
      { status: 500 }
    );
  }
}
