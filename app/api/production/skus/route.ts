import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { BusinessError } from "@/lib/rbac";
import { clientMeta, writeAudit } from "@/lib/audit";
import { ERR } from "@/lib/constants";
import {
  canSeeMoney,
  withProductionRole,
} from "@/lib/services/production-service";

export const runtime = "nodejs";

const schema = z.object({
  skuCode: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[A-Z0-9-]+$/, "Mã SKU chỉ gồm chữ IN HOA, số và dấu gạch ngang."),
  skuName: z.string().min(2).max(255),
  targetOutputKg: z.number().positive("Sản lượng chuẩn phải lớn hơn 0."),
  stdMaterialLossRate: z
    .number()
    .min(0)
    .max(100, "Tỷ lệ hao hụt định mức không thể vượt 100%."),
  stdKgPerLaborHour: z.number().min(0).default(0),
  // Đơn giá lưu số nguyên VND (cột Int, tối đa ~2,1 tỷ)
  unitPriceVnd: z
    .number()
    .int("Đơn giá phải là số đồng nguyên.")
    .min(0)
    .max(2_000_000_000)
    .default(0),
  rawMaterialId: z.string().nullable().optional(),
});

async function assertManager(user: Awaited<ReturnType<typeof requireUser>>) {
  const u = await withProductionRole(user);
  const allowed =
    u.role === "CEO" ||
    u.role === "ADMIN" ||
    u.productionRole === "PRODUCTION_DIRECTOR";
  if (!allowed) {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Chỉ Ban Giám đốc, Giám đốc Sản xuất và quản trị hệ thống mới quản lý được danh mục SKU.",
      403
    );
  }
  return u;
}

export async function GET() {
  return handle(async () => {
    const user = await withProductionRole(await requireUser());
    // Đơn giá (unitPriceVnd) là số tiền — chỉ CEO / Giám đốc SX được thấy.
    const money = canSeeMoney(user);
    const rows = await prisma.productSku.findMany({
      orderBy: [{ isActive: "desc" }, { skuCode: "asc" }],
    });
    const skus = money
      ? rows
      : rows.map((r) => {
          const { unitPriceVnd: _hidden, ...rest } = r;
          void _hidden;
          return rest;
        });
    return ok({ skus, includeMoney: money });
  });
}

/**
 * Tạo mã sản phẩm kèm CHUẨN của nó.
 *
 * Chuẩn phải đặt TRƯỚC khi chạy ca. Đây là mốc để đối chiếu khi Ban Giám đốc
 * đặt chỉ tiêu lúc khoá số — không có mốc thì đặt chỉ tiêu sau khi biết kết quả
 * thành ra muốn bao nhiêu cũng được.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await assertManager(await requireUser());
    const body = schema.parse(await req.json());
    // Quản trị được quản lý danh mục SKU nhưng KHÔNG được xem/đặt đơn giá
    if (!canSeeMoney(user)) body.unitPriceVnd = 0;

    const exists = await prisma.productSku.findUnique({
      where: { skuCode: body.skuCode },
    });
    if (exists) {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        `Mã SKU "${body.skuCode}" đã tồn tại.`,
        409
      );
    }

    const sku = await prisma.productSku.create({ data: body });

    await writeAudit({
      actor: user,
      action: "PRODUCTION_SKU_CREATE",
      entityName: "product_skus",
      entityId: sku.id,
      after: body,
      ...clientMeta(req),
    });

    return ok({ sku }, 201);
  });
}

const patchSchema = schema.partial().extend({
  isActive: z.boolean().optional(),
  reason: z.string().max(500).optional(),
});

export async function PATCH(req: Request) {
  return handle(async () => {
    const user = await assertManager(await requireUser());
    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
      throw new BusinessError(ERR.VALIDATION_FAILED, "Thiếu id SKU.", 400);
    }
    const body = patchSchema.parse(await req.json());
    if (!canSeeMoney(user)) delete body.unitPriceVnd;

    const before = await prisma.productSku.findUnique({ where: { id } });
    if (!before) {
      throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy SKU.", 404);
    }

    // Đổi chuẩn của SKU là đổi thước đo — phải ghi lý do, vì mọi ca sau đó
    // đều được chấm bằng thước mới.
    const changesStandard =
      (body.targetOutputKg !== undefined &&
        body.targetOutputKg !== before.targetOutputKg) ||
      (body.stdMaterialLossRate !== undefined &&
        body.stdMaterialLossRate !== before.stdMaterialLossRate);
    if (changesStandard && !body.reason?.trim()) {
      throw new BusinessError(
        ERR.REASON_REQUIRED,
        "Sửa chuẩn sản lượng hoặc định mức hao hụt thì bắt buộc ghi lý do — đây là thước đo chấm điểm cho cả xưởng.",
        400
      );
    }

    const { reason, ...data } = body;
    const sku = await prisma.productSku.update({ where: { id }, data });

    await writeAudit({
      actor: user,
      action: changesStandard
        ? "PRODUCTION_SKU_STANDARD_CHANGE"
        : "PRODUCTION_SKU_UPDATE",
      entityName: "product_skus",
      entityId: id,
      before: {
        targetOutputKg: before.targetOutputKg,
        stdMaterialLossRate: before.stdMaterialLossRate,
        unitPriceVnd: before.unitPriceVnd,
        isActive: before.isActive,
      },
      after: data,
      reason: reason ?? null,
      ...clientMeta(req),
    });

    return ok({ sku });
  });
}
