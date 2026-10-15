// File: app/api/kpi/targets/route.ts

import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { BusinessError } from "@/lib/rbac";
import { clientMeta, writeAudit } from "@/lib/audit";
import { ERR } from "@/lib/constants";
import type { SessionUser } from "@/lib/auth";
import {
  PRODUCTION_KPI_SCOPE,
  assertCanManageProductionKpi,
} from "@/lib/kpi-calculator";

export const runtime = "nodejs";

/**
 * MỤC TIÊU KPI PHÒNG SẢN XUẤT CHO 1 KỲ ("Năm Quyết Định").
 *
 * Luồng trạng thái KpiPeriodTarget: DRAFT → APPROVED → LOCKED
 *   - Trưởng phòng SX / ADMIN: chỉ lưu nháp (DRAFT). Sửa mục tiêu đã duyệt thì
 *     tự quay về DRAFT, phải xin CEO duyệt lại — không ai tự đặt đích rồi tự
 *     duyệt để ăn thưởng.
 *   - CEO: duyệt (APPROVED) hoặc khoá (LOCKED). Chỉ CEO sửa được mục tiêu LOCKED.
 *   - Kỳ KPI đã FINALIZED / isLocked: không ai sửa. Kỳ MANAGER_LOCKED: chỉ CEO.
 * Mục tiêu chỉ dùng để chấm thưởng khi đã APPROVED/LOCKED (lib/kpi-calculator).
 */

/** Ô số: bỏ trống = null; 0 vẫn là 0 (bản cũ `x ? parseFloat(x) : null` biến 0 thành null). */
const targetNumber = (max: number) =>
  z.preprocess(
    (v) => (v === "" ? null : typeof v === "string" ? Number(v) : v),
    z
      .number({ invalid_type_error: "Phải là số." })
      .finite("Phải là số hữu hạn.")
      .min(0, "Không được âm.")
      .max(max, `Không được vượt ${max}.`)
      .nullable()
      .optional()
  );

const targetFields = {
  output_target: targetNumber(1_000_000),
  waste_target: targetNumber(100),
  quality_target: targetNumber(100),
  spec_target: targetNumber(100),
  safety_target: targetNumber(100),
  deadline_target: targetNumber(100),
  status: z.enum(["DRAFT", "APPROVED", "LOCKED"]).optional(),
  approvalNote: z.string().trim().max(500).nullable().optional(),
};

const postSchema = z.object({
  periodId: z.string().min(1).max(64),
  ...targetFields,
});

const putSchema = z.object({
  periodTargetId: z.string().min(1).max(64),
  ...targetFields,
});

type TargetInput = z.infer<typeof postSchema>;

const NUMERIC_KEYS = [
  "output_target",
  "waste_target",
  "quality_target",
  "spec_target",
  "safety_target",
  "deadline_target",
] as const;

async function saveTarget(
  user: SessionUser,
  periodId: string,
  input: Omit<TargetInput, "periodId">,
  req: Request
) {
  const isCeo = user.role === "CEO";

  const period = await prisma.kpiPeriod.findUnique({ where: { id: periodId } });
  if (!period) {
    throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy kỳ KPI.", 404);
  }
  if (period.status === "FINALIZED" || period.isLocked) {
    throw new BusinessError(
      ERR.KPI_FINALIZED,
      `Kỳ ${period.name} đã chốt — không sửa mục tiêu được nữa.`,
      409
    );
  }
  if (period.status === "MANAGER_LOCKED" && !isCeo) {
    throw new BusinessError(
      ERR.SLA_LOCKED,
      `Kỳ ${period.name} đã khoá quyền trưởng phòng — chỉ Ban Giám đốc sửa được mục tiêu.`,
      403
    );
  }

  const before = await prisma.kpiPeriodTarget.findUnique({ where: { periodId } });
  if (before?.status === "LOCKED" && !isCeo) {
    throw new BusinessError(
      ERR.KPI_FINALIZED,
      "Mục tiêu kỳ này đã được Ban Giám đốc khoá.",
      409
    );
  }

  // Trạng thái: chỉ CEO được đặt APPROVED/LOCKED. Người khác lưu = DRAFT.
  if (input.status && input.status !== "DRAFT" && !isCeo) {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Chỉ Ban Giám đốc mới phê duyệt hoặc khoá mục tiêu KPI.",
      403
    );
  }
  const status = isCeo ? input.status ?? before?.status ?? "DRAFT" : "DRAFT";

  // undefined = giữ nguyên số cũ; null = xoá chỉ tiêu; số (kể cả 0) = đặt số.
  const numbers: Partial<Record<(typeof NUMERIC_KEYS)[number], number | null>> = {};
  for (const k of NUMERIC_KEYS) {
    if (input[k] !== undefined) numbers[k] = input[k] as number | null;
  }

  const approvalNote = isCeo ? input.approvalNote : undefined;

  const include = {
    createdBy: { select: { id: true, fullName: true } },
    lastEditedBy: { select: { id: true, fullName: true } },
  } as const;

  const saved = before
    ? await prisma.kpiPeriodTarget.update({
        where: { id: before.id },
        data: {
          ...numbers,
          department: PRODUCTION_KPI_SCOPE,
          status,
          ...(approvalNote !== undefined && { approvalNote }),
          lastEditedById: user.id,
        },
        include,
      })
    : await prisma.kpiPeriodTarget.create({
        data: {
          periodId,
          department: PRODUCTION_KPI_SCOPE,
          ...numbers,
          status,
          approvalNote: approvalNote ?? null,
          createdById: user.id,
        },
        include,
      });

  const snapshot = (t: typeof before) =>
    t
      ? {
          status: t.status,
          output_target: t.output_target,
          waste_target: t.waste_target,
          quality_target: t.quality_target,
          spec_target: t.spec_target,
          safety_target: t.safety_target,
          deadline_target: t.deadline_target,
          approvalNote: t.approvalNote,
        }
      : undefined;

  await writeAudit({
    actor: user,
    action:
      status !== before?.status && status !== "DRAFT"
        ? `KPI_PERIOD_TARGET_${status}`
        : before
          ? "KPI_PERIOD_TARGET_UPDATE"
          : "KPI_PERIOD_TARGET_CREATE",
    entityName: "kpi_period_targets",
    entityId: saved.id,
    before: snapshot(before),
    after: snapshot(saved),
    reason: approvalNote ?? null,
    ...clientMeta(req),
  });

  return saved;
}

/** POST — tạo hoặc cập nhật mục tiêu của kỳ (theo periodId). */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    await assertCanManageProductionKpi(user, "Bạn không có quyền nhập mục tiêu KPI Phòng SX.");
    const { periodId, ...input } = postSchema.parse(await req.json());

    const data = await saveTarget(user, periodId, input, req);
    return ok({ success: true, data, message: "Đã lưu mục tiêu KPI." });
  });
}

/** PUT — cập nhật mục tiêu theo periodTargetId. */
export async function PUT(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    await assertCanManageProductionKpi(user, "Bạn không có quyền cập nhật mục tiêu KPI Phòng SX.");
    const { periodTargetId, ...input } = putSchema.parse(await req.json());

    const existing = await prisma.kpiPeriodTarget.findUnique({
      where: { id: periodTargetId },
      select: { periodId: true },
    });
    if (!existing) {
      throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy mục tiêu KPI.", 404);
    }

    const data = await saveTarget(user, existing.periodId, input, req);
    return ok({ success: true, data, message: "Đã cập nhật mục tiêu KPI." });
  });
}
