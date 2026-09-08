// File: app/api/kpi/dashboard/summary/route.ts

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { startOfDay, startOfWeek, startOfMonth, parseISO } from "date-fns";

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

    let dateFilter;
    const now = new Date();

    switch (period) {
      case "today":
        dateFilter = {
          shiftDate: {
            gte: startOfDay(now),
            lt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          },
        };
        break;
      case "week":
        dateFilter = {
          shiftDate: {
            gte: startOfWeek(now),
            lt: new Date(startOfWeek(now).getTime() + 7 * 24 * 60 * 60 * 1000),
          },
        };
        break;
      case "month":
        dateFilter = {
          shiftDate: {
            gte: startOfMonth(now),
            lt: new Date(
              now.getFullYear(),
              now.getMonth() + 1,
              1
            ),
          },
        };
        break;
      default:
        dateFilter = {
          shiftDate: {
            gte: startOfDay(now),
            lt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          },
        };
    }

    // Query data
    const scores = await prisma.shiftKpiScore.findMany({
      where: {
        shiftLog: dateFilter,
      },
      include: {
        shiftLog: true,
      },
    });

    // Calculate metrics
    const totalShifts = scores.length;
    const avgScore =
      totalShifts > 0
        ? scores.reduce((sum, s) => sum + s.totalScore, 0) / totalShifts
        : 0;
    const totalBonus = scores.reduce((sum, s) => sum + s.bonusAmount, 0);
    const avgBonus = totalShifts > 0 ? totalBonus / totalShifts : 0;

    const statusCounts = {
      CALCULATED: scores.filter((s) => s.status === "CALCULATED").length,
      APPROVED: scores.filter((s) => s.status === "APPROVED").length,
      DRAFT: scores.filter((s) => s.status === "DRAFT").length,
    };

    const shiftTypes = {
      MORNING: scores.filter((s) => s.shiftLog.shiftType === "MORNING").length,
      AFTERNOON: scores.filter(
        (s) => s.shiftLog.shiftType === "AFTERNOON"
      ).length,
      NIGHT: scores.filter((s) => s.shiftLog.shiftType === "NIGHT").length,
    };

    // Response
    return NextResponse.json({
      success: true,
      data: {
        period,
        timestamp: new Date(),
        summary: {
          totalShifts,
          avgScore: parseFloat(avgScore.toFixed(2)),
          totalBonus: Math.round(totalBonus),
          avgBonus: Math.round(avgBonus),
          percentApproved: totalShifts > 0
            ? Math.round(
                (statusCounts.APPROVED / totalShifts) * 100
              )
            : 0,
        },
        statusCounts,
        shiftTypes,
        topScores: scores
          .sort((a, b) => b.totalScore - a.totalScore)
          .slice(0, 5)
          .map((s) => ({
            shiftDate: s.shiftLog.shiftDate,
            shiftType: s.shiftLog.shiftType,
            totalScore: s.totalScore,
            bonusAmount: s.bonusAmount,
            status: s.status,
          })),
      },
    });
  } catch (error) {
    console.error("Error fetching dashboard summary:", error);
    return NextResponse.json(
      { error: "Failed to fetch summary" },
      { status: 500 }
    );
  }
}
