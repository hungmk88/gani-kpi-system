// File: app/api/kpi/dashboard/distribution/route.ts

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getDashboardDistribution } from "@/lib/services/kpi-dashboard";

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

    const data = await getDashboardDistribution();

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Error fetching distribution:", error);
    return NextResponse.json(
      { error: "Failed to fetch distribution" },
      { status: 500 }
    );
  }
}
