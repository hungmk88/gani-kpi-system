import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { assertPermission, BusinessError } from "@/lib/rbac";
import { clientMeta, writeAudit } from "@/lib/audit";
import { ERR } from "@/lib/constants";

export const runtime = "nodejs";

/** Danh sách "6 chỉ tiêu" tính thưởng ca sản xuất — chỉ đọc, không thêm/xoá mã. */
export async function GET() {
  return handle(async () => {
    await requireUser();
    const configs = await prisma.kpiConfig.findMany({
      where: { department: "PRODUCTION" },
      orderBy: { code: "asc" },
    });
    return ok({ configs });
  });
}

const patchSchema = z.object({
  weightPercent: z.number().min(0).max(100).optional(),
  targetValue: z.number().nullable().optional(),
  baselineValue: z.number().nullable().optional(),
  unit: z.string().min(1).max(30).optional(),
  isHigherBetter: z.boolean().optional(),
  dataSource: z.enum(["MANUAL", "IPOS", "QA_CHECK", "SYSTEM_CALC"]).optional(),
  description: z.string().max(500).nullable().optional(),
  reason: z.string().max(500).optional(),
});

/**
 * Sửa một trong 6 chỉ tiêu. Đây là bộ số `lib/kpi-calculator.ts` đọc trực
 * tiếp mỗi lần tính điểm ca sản xuất — sửa ở đây là đổi cách tính thưởng thật,
 * không phải màn hình trưng bày.
 *
 * Không có POST/DELETE: 6 mã KPI_OUTPUT/WASTE/QUALITY/SPEC/SAFETY/DEADLINE cố
 * định trong công thức tính điểm, thêm mã thứ 7 qua đây sẽ không được engine
 * đọc tới — chỉ sửa số của 6 dòng đã có.
 */
export async function PATCH(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    assertPermission(user, "production.kpiconfig.manage");

    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
      throw new BusinessError(ERR.VALIDATION_FAILED, "Thiếu id chỉ tiêu.", 400);
    }

    const body = patchSchema.parse(await req.json());

    const before = await prisma.kpiConfig.findUnique({ where: { id } });
    if (!before) {
      throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy chỉ tiêu.", 404);
    }

    // Sửa trọng số hoặc chỉ tiêu giao là đổi thước chấm thưởng thật cho cả
    // xưởng — bắt buộc ghi lý do, giống luật đổi chuẩn SKU.
    const changesScoring =
      (body.weightPercent !== undefined &&
        body.weightPercent !== before.weightPercent) ||
      (body.targetValue !== undefined && body.targetValue !== before.targetValue);
    if (changesScoring && !body.reason?.trim()) {
      throw new BusinessError(
        ERR.REASON_REQUIRED,
        "Sửa trọng số hoặc chỉ tiêu giao thì bắt buộc ghi lý do — con số này quyết định thưởng thật của cả ca sản xuất.",
        400
      );
    }

    // Tổng trọng số 6 chỉ tiêu phải luôn bằng 100% — công thức tính điểm cộng
    // thẳng 6 weighted score lại rồi chặn trần 100, sai tổng là sai cả thang điểm.
    if (body.weightPercent !== undefined) {
      const siblings = await prisma.kpiConfig.findMany({
        where: {
          department: before.department,
          isActive: true,
          id: { not: id },
        },
        select: { weightPercent: true },
      });
      const total =
        siblings.reduce((s, c) => s + c.weightPercent, 0) + body.weightPercent;
      if (Math.abs(total - 100) > 0.01) {
        throw new BusinessError(
          ERR.WEIGHT_SUM_INVALID,
          `Tổng trọng số 6 chỉ tiêu phải bằng 100%, đang là ${total.toFixed(2)}%. Sửa trọng số chỉ tiêu khác trước cho cân lại.`,
          400
        );
      }
    }

    const { reason, ...data } = body;
    const config = await prisma.kpiConfig.update({ where: { id }, data });

    await writeAudit({
      actor: user,
      action: changesScoring ? "KPI_CONFIG_SCORING_CHANGE" : "KPI_CONFIG_UPDATE",
      entityName: "kpi_configs",
      entityId: id,
      before: {
        weightPercent: before.weightPercent,
        targetValue: before.targetValue,
        isActive: before.isActive,
      },
      after: data,
      reason: reason ?? null,
      ...clientMeta(req),
    });

    return ok({ config });
  });
}
