// File: app/api/kpi/dashboard/distribution/route.ts

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { startOfDay, startOfMonth, subDays } from "date-fns";

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

    // Get all KPI scores for last 30 days
    const thirtyDaysAgo = subDays(new Date(), 30);
    const scores = await prisma.shiftKpiScore.findMany({
      where: {
        shiftLog: {
          shiftDate: {
            gte: thirtyDaysAgo,
          },
        },
      },
      select: {
        totalScore: true,
        shiftLog: {
          select: {
            shiftDate: true,
          },
        },
      },
      orderBy: {
        shiftLog: {
          shiftDate: "asc",
        },
      },
    });

    // Create distribution buckets
    const distribution = {
      "0-50": 0,
      "50-75": 0,
      "75-90": 0,
      "90-100": 0,
      "100-120": 0,
      "120+": 0,
    };

    scores.forEach((score) => {
      const s = score.totalScore;
      if (s < 50) distribution["0-50"]++;
      else if (s < 75) distribution["50-75"]++;
      else if (s < 90) distribution["75-90"]++;
      else if (s < 100) distribution["90-100"]++;
      else if (s < 120) distribution["100-120"]++;
      else distribution["120+"]++;
    });

    // Calculate statistics
    const validScores = scores.map((s) => s.totalScore);
    const avg =
      validScores.length > 0
        ? validScores.reduce((a, b) => a + b, 0) / validScores.length
        : 0;
    const sorted = [...validScores].sort((a, b) => a - b);
    const median =
      sorted.length % 2 === 0
        ? (sorted[Math.floor(sorted.length / 2) - 1] +
            sorted[Math.floor(sorted.length / 2)]) /
          2
        : sorted[Math.floor(sorted.length / 2)];
    const stdDev =
      validScores.length > 0
        ? Math.sqrt(
            validScores.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) /
              validScores.length
          )
        : 0;

    return NextResponse.json({
      success: true,
      data: {
        period: "last_30_days",
        distribution,
        statistics: {
          count: validScores.length,
          average: parseFloat(avg.toFixed(2)),
          median: parseFloat(median.toFixed(2)),
          stdDev: parseFloat(stdDev.toFixed(2)),
          min: validScores.length > 0 ? Math.min(...validScores) : 0,
          max: validScores.length > 0 ? Math.max(...validScores) : 0,
        },
        chartData: [
          { range: "0-50", count: distribution["0-50"], percentage: 0 },
          { range: "50-75", count: distribution["50-75"], percentage: 0 },
          { range: "75-90", count: distribution["75-90"], percentage: 0 },
          { range: "90-100", count: distribution["90-100"], percentage: 0 },
          { range: "100-120", count: distribution["100-120"], percentage: 0 },
          { range: "120+", count: distribution["120+"], percentage: 0 },
        ].map((item) => ({
          ...item,
          percentage:
            validScores.length > 0
              ? Math.round((item.count / validScores.length) * 100)
              : 0,
        })),
      },
    });
  } catch (error) {
    console.error("Error fetching distribution:", error);
    return NextResponse.json(
      { error: "Failed to fetch distribution" },
      { status: 500 }
    );
  }
}
