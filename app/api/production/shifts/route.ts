import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { clientMeta } from "@/lib/audit";
import {
  submitShiftDraft,
  withProductionRole,
  redactShiftForViewer,
} from "@/lib/services/production-service";
import { PRODUCTION_STAGES, SHIFT_TYPES } from "@/lib/production/constants";
import { BusinessError } from "@/lib/rbac";
import { ERR } from "@/lib/constants";
import { parseVnDate } from "@/lib/vn-time";

export const runtime = "nodejs";

// Trần an toàn cho số nhập tay (xem app/api/production/shifts/[id]/route.ts)
const MAX_KG = 100_000;
const kg = (label: string) =>
  z
    .number({ invalid_type_error: `${label} phải là số.` })
    .finite(`${label} không hợp lệ.`)
    .min(0, `${label} không được âm.`)
    .max(MAX_KG, `${label} vượt trần ${MAX_KG.toLocaleString("vi-VN")} kg.`);
const hours = (max: number) => z.number().finite().min(0).max(max);

const schema = z.object({
  // Ngày ca là NGÀY: nhận "YYYY-MM-DD", vẫn nhận ISO đầy đủ cho client cũ.
  shiftDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày ca không hợp lệ.")
    .or(z.string().datetime("Ngày ca không hợp lệ.")),
  shiftType: z.enum(SHIFT_TYPES),
  skuId: z.string().min(1),
  rawOutputKg: kg("Sản lượng thô"),
  totalLaborHours: hours(100_000),
  downtimeHours: hours(100_000).default(0),
  rawMaterialInputKg: kg("Nguyên liệu cấp vào"),
  draftNote: z.string().max(2000).optional(),
  participants: z
    .array(
      z.object({
        userId: z.string().min(1),
        stage: z.enum(PRODUCTION_STAGES),
        hoursWorked: hours(24),
        scheduledHours: hours(24).default(0),
      })
    )
    .min(1, "Phải khai ít nhất một người làm ca này."),
});

export async function GET(req: Request) {
  return handle(async () => {
    const user = await withProductionRole(await requireUser());
    const url = new URL(req.url);
    const status = url.searchParams.get("status");

    const where: Prisma.ProductionShiftLogWhereInput = {};
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
        createdBy: { select: { id: true, fullName: true } },
        qcOfficer: { select: { id: true, fullName: true } },
        lockedBy: { select: { id: true, fullName: true } },
        participants: {
          include: {
            user: {
              select: { id: true, fullName: true, productionRole: true, employmentType: true },
            },
          },
        },
        _count: { select: { audits: true } },
      },
      orderBy: [{ shiftDate: "desc" }, { shiftType: "asc" }],
      take: 100,
    });

    return ok({
      shifts: shifts.map((s) => redactShiftForViewer(s, user)),
      count: shifts.length,
    });
  });
}

/** BƯỚC 1 — sản xuất khai ca. */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await withProductionRole(await requireUser());
    const body = schema.parse(await req.json());

    let shiftDate: Date;
    try {
      shiftDate = parseVnDate(body.shiftDate);
    } catch {
      throw new BusinessError(ERR.VALIDATION_FAILED, "Ngày ca không hợp lệ.", 400);
    }

    const log = await submitShiftDraft(
      user,
      { ...body, shiftDate },
      clientMeta(req)
    );

    return ok({ shift: redactShiftForViewer(log, user) }, 201);
  });
}
