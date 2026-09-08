// File: app/api/kpi/calculate/route.ts

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { calculateShiftKpiScore } from "@/lib/kpi-calculator";
import { getSession } from "@/lib/auth";

/**
 * POST /api/kpi/calculate
 * Tính điểm KPI cho 1 ca
 *
 * Request body:
 * {
 *   shiftLogId: string,
 *   periodTargetId: string,
 *   kpiResults: {
 *     output_actual?: number,
 *     waste_actual?: number,
 *     quality_actual?: number,
 *     spec_actual?: number,
 *     safety_actual?: number,
 *     deadline_actual?: number,
 *   }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: session.id },
      include: { department: true },
    });

    if (!user || !user.isActive) {
      return NextResponse.json(
        { error: "User not found or inactive" },
        { status: 404 }
      );
    }

    // Permission: CEO hoặc Giám Đốc SX
    const hasPermission =
      user.role === "CEO" ||
      user.role === "ADMIN" ||
      (user.role === "MANAGER" && user.department?.code === "PRODUCTION");

    if (!hasPermission) {
      return NextResponse.json(
        { error: "Bạn không có quyền tính điểm KPI" },
        { status: 403 }
      );
    }

    // Parse request
    const body = await request.json();
    const { shiftLogId, periodTargetId, kpiResults } = body;

    // Validate
    if (!shiftLogId || !periodTargetId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Verify shiftLog exists
    const shiftLog = await prisma.productionShiftLog.findUnique({
      where: { id: shiftLogId },
    });

    if (!shiftLog) {
      return NextResponse.json(
        { error: "Shift log not found" },
        { status: 404 }
      );
    }

    // Verify periodTarget exists
    const periodTarget = await prisma.kpiPeriodTarget.findUnique({
      where: { id: periodTargetId },
    });

    if (!periodTarget) {
      return NextResponse.json(
        { error: "Period target not found" },
        { status: 404 }
      );
    }

    // Calculate
    console.log(`🔄 Calculating KPI for shift: ${shiftLogId}`);
    const shiftKpiScore = await calculateShiftKpiScore(
      shiftLogId,
      periodTargetId,
      kpiResults || {}
    );

    console.log(`✅ Calculated score: ${shiftKpiScore.totalScore}`);

    // Response
    return NextResponse.json({
      success: true,
      data: {
        id: shiftKpiScore.id,
        shiftLogId: shiftKpiScore.shiftLogId,
        totalScore: shiftKpiScore.totalScore,
        bonusMultiplier: shiftKpiScore.bonusMultiplier,
        bonusAmount: shiftKpiScore.bonusAmount,
        status: shiftKpiScore.status,
        breakdown: shiftKpiScore.breakdownJson
          ? JSON.parse(shiftKpiScore.breakdownJson)
          : null,
      },
      message: "✅ Tính điểm KPI thành công",
    });
  } catch (error) {
    console.error("Error calculating KPI:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to calculate",
      },
      { status: 500 }
    );
  }
}

