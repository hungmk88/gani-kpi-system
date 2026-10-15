import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { clientMeta } from "@/lib/audit";
import {
  submitShiftDraft,
  withProductionRole,
  redactShiftForViewer,
} from "@/lib/services/production-service";
import { shiftDraftSchema } from "@/lib/production/draft-schema";
import { BusinessError } from "@/lib/rbac";
import { ERR } from "@/lib/constants";
import { parseVnDate } from "@/lib/vn-time";

export const runtime = "nodejs";

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
    const body = shiftDraftSchema.parse(await req.json());

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
