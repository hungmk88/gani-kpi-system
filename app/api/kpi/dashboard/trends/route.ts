// File: app/api/kpi/dashboard/trends/route.ts

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getDashboardTrends } from "@/lib/services/kpi-dashboard";

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

    // Get days parameter (7, 30, or 90)
    const { days = "7" } = Object.fromEntries(request.nextUrl.searchParams);
    const numDays = parseInt(days) || 7;

    const data = await getDashboardTrends(numDays);

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Error fetching trends:", error);
    return NextResponse.json(
      { error: "Failed to fetch trends" },
      { status: 500 }
    );
  }
}
