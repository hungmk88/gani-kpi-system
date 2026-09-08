// File: app/api/kpi/targets/route.ts

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

// Kiểm tra quyền (CEO hoặc Giám Đốc SX)
async function checkPermission(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) return false;

  // CEO hoặc ADMIN
  if (user.role === "CEO" || user.role === "ADMIN") return true;

  // Giám Đốc Phòng SX (role = MANAGER & department = PRODUCTION)
  if (user.role === "MANAGER" && user.departmentId) {
    const dept = await prisma.department.findUnique({
      where: { id: user.departmentId },
    });
    if (dept?.code === "PRODUCTION") return true;
  }

  return false;
}

export async function POST(request: NextRequest) {
  try {
    // Check auth
    const session = await getSession();
    if (!session?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: session.id },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Check permission
    const hasPermission = await checkPermission(user.id);
    if (!hasPermission) {
      return NextResponse.json(
        { error: "Bạn không có quyền nhập mục tiêu KPI" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      periodId,
      department,
      output_target,
      waste_target,
      quality_target,
      spec_target,
      safety_target,
      deadline_target,
    } = body;

    // Validate
    if (!periodId || !department) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Create or update period target
    const periodTarget = await prisma.kpiPeriodTarget.upsert({
      where: { periodId_department: { periodId, department } },
      create: {
        periodId,
        department,
        output_target: output_target ? parseFloat(output_target) : null,
        waste_target: waste_target ? parseFloat(waste_target) : null,
        quality_target: quality_target ? parseFloat(quality_target) : null,
        spec_target: spec_target ? parseFloat(spec_target) : null,
        safety_target: safety_target ? parseFloat(safety_target) : null,
        deadline_target: deadline_target ? parseFloat(deadline_target) : null,
        createdById: user.id,
        status: "DRAFT",
      },
      update: {
        output_target: output_target ? parseFloat(output_target) : null,
        waste_target: waste_target ? parseFloat(waste_target) : null,
        quality_target: quality_target ? parseFloat(quality_target) : null,
        spec_target: spec_target ? parseFloat(spec_target) : null,
        safety_target: safety_target ? parseFloat(safety_target) : null,
        deadline_target: deadline_target ? parseFloat(deadline_target) : null,
        lastEditedById: user.id,
        updatedAt: new Date(),
      },
      include: {
        createdBy: { select: { id: true, fullName: true } },
        lastEditedBy: { select: { id: true, fullName: true } },
      },
    });

    return NextResponse.json({
      success: true,
      data: periodTarget,
      message: "Mục tiêu KPI đã được lưu thành công",
    });
  } catch (error) {
    console.error("Error saving targets:", error);
    return NextResponse.json(
      { error: "Failed to save targets" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Check auth
    const session = await getSession();
    if (!session?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: session.id },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Check permission
    const hasPermission = await checkPermission(user.id);
    if (!hasPermission) {
      return NextResponse.json(
        { error: "Bạn không có quyền cập nhật mục tiêu KPI" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      periodTargetId,
      output_target,
      waste_target,
      quality_target,
      spec_target,
      safety_target,
      deadline_target,
      status,
      approvalNote,
    } = body;

    // Validate
    if (!periodTargetId) {
      return NextResponse.json(
        { error: "Missing periodTargetId" },
        { status: 400 }
      );
    }

    // Update period target
    const periodTarget = await prisma.kpiPeriodTarget.update({
      where: { id: periodTargetId },
      data: {
        output_target: output_target ? parseFloat(output_target) : null,
        waste_target: waste_target ? parseFloat(waste_target) : null,
        quality_target: quality_target ? parseFloat(quality_target) : null,
        spec_target: spec_target ? parseFloat(spec_target) : null,
        safety_target: safety_target ? parseFloat(safety_target) : null,
        deadline_target: deadline_target ? parseFloat(deadline_target) : null,
        status: status || "DRAFT",
        approvalNote: approvalNote || null,
        lastEditedById: user.id,
        updatedAt: new Date(),
      },
      include: {
        createdBy: { select: { id: true, fullName: true } },
        lastEditedBy: { select: { id: true, fullName: true } },
      },
    });

    return NextResponse.json({
      success: true,
      data: periodTarget,
      message: "Mục tiêu KPI đã được cập nhật thành công",
    });
  } catch (error) {
    console.error("Error updating targets:", error);
    return NextResponse.json(
      { error: "Failed to update targets" },
      { status: 500 }
    );
  }
}
