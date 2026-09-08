// File: app/api/kpi/dashboard/trends/route.ts

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { subDays, format, eachDayOfInterval, startOfDay } from "date-fns";

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
    const { days = "7" } = Object.fromEntries(
      request.nextUrl.searchParams
    );
    const numDays = parseInt(days) || 7;

    const endDate = new Date();
    const startDate = subDays(endDate, numDays);

    // Get scores for period
    const scores = await prisma.shiftKpiScore.findMany({
      where: {
        shiftLog: {
          shiftDate: {
            gte: startDate,
            lte: endDate,
          },
        },
      },
      include: {
        shiftLog: {
          select: {
            shiftDate: true,
          },
        },
      },
    });

    // Group by date
    const groupedByDate = new Map<string, any[]>();
    scores.forEach((score) => {
      const dateKey = format(score.shiftLog.shiftDate, "yyyy-MM-dd");
      if (!groupedByDate.has(dateKey)) {
        groupedByDate.set(dateKey, []);
      }
      groupedByDate.get(dateKey)!.push(score);
    });

    // Create trend data
    const trendData = eachDayOfInterval({
      start: startDate,
      end: endDate,
    }).map((date) => {
      const dateKey = format(date, "yyyy-MM-dd");
      const dayScores = groupedByDate.get(dateKey) || [];

      const avgScore =
        dayScores.length > 0
          ? dayScores.reduce((sum, s) => sum + s.totalScore, 0) /
            dayScores.length
          : null;

      const avgOutput =
        dayScores.length > 0
          ? dayScores.reduce((sum, s) => sum + s.output_achievement, 0) /
            dayScores.length
          : null;

      const avgWaste =
        dayScores.length > 0
          ? dayScores.reduce((sum, s) => sum + s.waste_achievement, 0) /
            dayScores.length
          : null;

      return {
        date: dateKey,
        displayDate: format(date, "MMM dd"),
        shiftCount: dayScores.length,
        avgScore: avgScore ? parseFloat(avgScore.toFixed(2)) : null,
        avgOutput: avgOutput ? parseFloat(avgOutput.toFixed(2)) : null,
        avgWaste: avgWaste ? parseFloat(avgWaste.toFixed(2)) : null,
        totalBonus:
          dayScores.length > 0
            ? Math.round(
                dayScores.reduce((sum, s) => sum + s.bonusAmount, 0)
              )
            : 0,
      };
    });

    // Calculate moving averages
    const movingAvg = trendData.map((_, idx) => {
      const window = Math.min(3, idx + 1); // 3-day MA, but start with available data
      const sum = trendData
        .slice(Math.max(0, idx - window + 1), idx + 1)
        .reduce((s, d) => s + (d.avgScore || 0), 0);
      return sum / window;
    });

    return NextResponse.json({
      success: true,
      data: {
        period: `${numDays}_days`,
        trendData: trendData.map((d, idx) => ({
          ...d,
          movingAvg: parseFloat(movingAvg[idx].toFixed(2)),
        })),
        statistics: {
          daysWithData: trendData.filter((d) => d.shiftCount > 0).length,
          totalShifts: scores.length,
          avgDailyScore:
            scores.length > 0
              ? parseFloat(
                  (
                    scores.reduce((sum, s) => sum + s.totalScore, 0) /
                    scores.length
                  ).toFixed(2)
                )
              : 0,
          totalBonusDistributed: Math.round(
            trendData.reduce((sum, d) => sum + d.totalBonus, 0)
          ),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching trends:", error);
    return NextResponse.json(
      { error: "Failed to fetch trends" },
      { status: 500 }
    );
  }
}
