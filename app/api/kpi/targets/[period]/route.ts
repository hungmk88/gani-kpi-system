// File: app/api/kpi/targets/[period]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ period: string }> }
) {
  try {
    const params = await context.params;
    const periodId = params.period;

    // Lấy KpiPeriod
    const period = await prisma.kpiPeriod.findUnique({
      where: { id: periodId },
    });

    if (!period) {
      return NextResponse.json(
        { error: "Period not found" },
        { status: 404 }
      );
    }

    // Lấy Period Target (mục tiêu chung cả phòng)
    const periodTarget = await prisma.kpiPeriodTarget.findUnique({
      where: { periodId: periodId },
      include: {
        createdBy: { select: { id: true, fullName: true } },
        lastEditedBy: { select: { id: true, fullName: true } },
        shiftTargets: {
          orderBy: [{ shiftDate: "asc" }, { shiftType: "asc" }],
        },
      },
    });

    // Format response
    const response = {
      period: {
        id: period.id,
        month: period.month,
        year: period.year,
        name: period.name,
        status: period.status,
      },
      periodTarget: periodTarget || {
        id: null,
        status: "NOT_CREATED",
        department: "PRODUCTION",
        output_target: null,
        waste_target: null,
        quality_target: null,
        spec_target: null,
        safety_target: null,
        deadline_target: null,
      },
      shiftTargets: periodTarget?.shiftTargets || [],
      kpiDefinitions: [
        {
          code: "PROD_OUTPUT",
          name: "Sản Lượng Thực Tế",
          unit: "kg/ca",
          weight: 25,
        },
        {
          code: "PROD_WASTE",
          name: "Tỷ Lệ Hao Hụt",
          unit: "%",
          weight: 25,
        },
        {
          code: "PROD_QUALITY",
          name: "Tỷ Lệ Chất Lượng (OK)",
          unit: "%",
          weight: 20,
        },
        {
          code: "PROD_SPEC",
          name: "Tỷ Lệ Sản Phẩm Đúng Spec",
          unit: "%",
          weight: 15,
        },
        {
          code: "PROD_SAFETY",
          name: "An Toàn Lao Động",
          unit: "điểm",
          weight: 10,
        },
        {
          code: "PROD_DEADLINE",
          name: "Đúng Deadline Batch",
          unit: "%",
          weight: 5,
        },
      ],
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching targets:", error);
    return NextResponse.json(
      { error: "Failed to fetch targets" },
      { status: 500 }
    );
  }
}
