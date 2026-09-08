import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { clientMeta } from "@/lib/audit";
import {
  submitShiftDraft,
  withProductionRole,
} from "@/lib/services/production-service";
import { PRODUCTION_STAGES, SHIFT_TYPES } from "@/lib/production/constants";

export const runtime = "nodejs";

const schema = z.object({
  shiftDate: z.string().datetime("Ngày ca không hợp lệ."),
  shiftType: z.enum(SHIFT_TYPES),
  skuId: z.string().min(1),
  rawOutputKg: z.number().min(0),
  totalLaborHours: z.number().min(0),
  downtimeHours: z.number().min(0).default(0),
  rawMaterialInputKg: z.number().min(0),
  draftNote: z.string().max(2000).optional(),
  participants: z
    .array(
      z.object({
        userId: z.string().min(1),
        stage: z.enum(PRODUCTION_STAGES),
        hoursWorked: z.number().min(0),
        scheduledHours: z.number().min(0).default(0),
      })
    )
    .min(1, "Phải khai ít nhất một người làm ca này."),
});

export async function GET(req: Request) {
  return handle(async () => {
    const user = await withProductionRole(await requireUser());
    const url = new URL(req.url);
    const status = url.searchParams.get("status");

    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    // Công nhân chỉ thấy ca mình có tham gia hoặc ca mình khai.
    // Quản đốc, KCS, Giám đốc SX và Ban Giám đốc thấy hết.
    const isWide =
      user.role === "CEO" ||
      user.role === "ADMIN" ||
      ["SUPERVISOR", "QC_OFFICER", "PRODUCTION_DIRECTOR"].includes(
        user.productionRole ?? ""
      );
    if (!isWide) {
      where.OR = [
        { createdById: user.id },
        { participants: { some: { userId: user.id } } },
      ];
    }

    const shifts = await prisma.productionShiftLog.findMany({
      where,
      include: {
        sku: true,
        createdBy: true,
        qcOfficer: true,
        lockedBy: true,
        participants: { include: { user: true } },
        _count: { select: { audits: true } },
      },
      orderBy: [{ shiftDate: "desc" }, { shiftType: "asc" }],
      take: 100,
    });

    return ok({ shifts, count: shifts.length });
  });
}

/** BƯỚC 1 — sản xuất khai ca. */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await withProductionRole(await requireUser());
    const body = schema.parse(await req.json());

    const log = await submitShiftDraft(
      user,
      { ...body, shiftDate: new Date(body.shiftDate) },
      clientMeta(req)
    );

    return ok({ shift: log }, 201);
  });
}
