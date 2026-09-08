// File: app/api/kpi/calculate/[shiftId]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

/**
 * GET /api/kpi/calculate/[shiftId]
 * Lấy kết quả tính điểm cho 1 ca
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ shiftId: string }> }
) {
  try {
    // Auth check
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const params = await context.params;
    const shiftId = params.shiftId;

    // Get KPI score
    const score = await prisma.shiftKpiScore.findUnique({
      where: { shiftLogId: shiftId },
      include: {
        calculatedBy: { select: { id: true, fullName: true } },
        approvedBy: { select: { id: true, fullName: true } },
      },
    });

    if (!score) {
      return NextResponse.json(
        { error: "KPI score not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        id: score.id,
        shiftLogId: score.shiftLogId,
        status: score.status,
        totalScore: score.totalScore,
        bonusMultiplier: score.bonusMultiplier,
        bonusAmount: score.bonusAmount,
        breakdown: score.breakdownJson
          ? JSON.parse(score.breakdownJson)
          : null,
        calculatedAt: score.calculatedAt,
        calculatedBy: score.calculatedBy,
        approvedAt: score.approvedAt,
        approvedBy: score.approvedBy,
      },
    });
  } catch (error) {
    console.error("Error fetching KPI score:", error);
    return NextResponse.json(
      { error: "Failed to fetch score" },
      { status: 500 }
    );
  }
}
