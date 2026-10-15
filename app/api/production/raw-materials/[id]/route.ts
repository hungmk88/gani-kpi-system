import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { BusinessError } from "@/lib/rbac";
import { clientMeta, writeAudit } from "@/lib/audit";
import { ERR } from "@/lib/constants";
import { withProductionRole } from "@/lib/services/production-service";

export const runtime = "nodejs";

async function assertManager(user: Awaited<ReturnType<typeof requireUser>>) {
  const u = await withProductionRole(user);
  const allowed =
    u.role === "CEO" ||
    u.role === "ADMIN" ||
    u.productionRole === "PRODUCTION_DIRECTOR";
  if (!allowed) {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Chỉ Ban Giám đốc, Giám đốc Sản xuất và quản trị hệ thống mới quản lý được kho NVL.",
      403
    );
  }
  return u;
}

const patchSchema = z.object({
  name: z.string().min(2).max(255).optional(),
  unit: z.string().min(1).max(20).optional(),
  isActive: z.boolean().optional(),
});

/** Sửa tên/đơn vị/bật-tắt — không sửa tồn kho ở đây, đi qua route stock-in hoặc adjust. */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await assertManager(await requireUser());
    const body = patchSchema.parse(await req.json());

    const before = await prisma.rawMaterial.findUnique({ where: { id } });
    if (!before) {
      throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy NVL.", 404);
    }

    const material = await prisma.rawMaterial.update({ where: { id }, data: body });

    await writeAudit({
      actor: user,
      action: "RAW_MATERIAL_UPDATE",
      entityName: "raw_materials",
      entityId: id,
      before: { name: before.name, unit: before.unit, isActive: before.isActive },
      after: body,
      ...clientMeta(req),
    });

    return ok({ material });
  });
}

const txSchema = z.object({
  action: z.enum(["STOCK_IN", "ADJUSTMENT"]),
  quantityKg: z.number().finite(),
  note: z.string().max(500).optional(),
});

/**
 * Nhập kho (STOCK_IN, số dương) hoặc chỉnh tay số dư (ADJUSTMENT, dương/âm
 * đều được — dùng khi kiểm kê thực tế lệch với sổ). Luôn ghi một dòng vào sổ
 * giao dịch, không sửa thẳng số dư mà không để lại vết.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await assertManager(await requireUser());
    const body = txSchema.parse(await req.json());

    if (body.action === "STOCK_IN" && body.quantityKg <= 0) {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        "Nhập kho thì số lượng phải lớn hơn 0.",
        400
      );
    }
    if (body.action === "ADJUSTMENT" && !body.note?.trim()) {
      throw new BusinessError(
        ERR.REASON_REQUIRED,
        "Chỉnh tay số dư kho thì bắt buộc ghi lý do (vd: kiểm kê thực tế lệch sổ).",
        400
      );
    }

    if (Math.round(body.quantityKg * 100) === 0) {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        "Số lượng phải khác 0 (chỉnh tay: dương để cộng, âm để trừ).",
        400
      );
    }

    const exists = await prisma.rawMaterial.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy NVL.", 404);
    }

    // Cộng/trừ NGUYÊN TỬ bằng increment ở DB — không ghi đè số dư tính từ
    // một lần đọc cũ (hai người nhập kho cùng lúc, hoặc nhập kho đúng lúc một
    // ca đang khoá và trừ kho, sẽ làm mất lượt của nhau). Số dư sau giao dịch
    // đọc lại từ kết quả update, cùng transaction với dòng sổ giao dịch.
    const delta = Math.round(body.quantityKg * 100) / 100;
    const { material, transaction, balanceAfter } = await prisma.$transaction(
      async (tx) => {
        const material = await tx.rawMaterial.update({
          where: { id },
          data: { currentStockKg: { increment: delta } },
        });
        const balanceAfter = Math.round(material.currentStockKg * 100) / 100;
        const transaction = await tx.rawMaterialTransaction.create({
          data: {
            rawMaterialId: id,
            type: body.action,
            quantityKg: delta,
            balanceAfterKg: balanceAfter,
            createdById: user.id,
            note: body.note ?? null,
          },
        });
        return { material, transaction, balanceAfter };
      }
    );

    await writeAudit({
      actor: user,
      action: `RAW_MATERIAL_${body.action}`,
      entityName: "raw_materials",
      entityId: id,
      before: { currentStockKg: Math.round((balanceAfter - delta) * 100) / 100 },
      after: { currentStockKg: balanceAfter, delta, transactionId: transaction.id },
      reason: body.note ?? null,
      ...clientMeta(req),
    });

    return ok({ material, transaction }, 201);
  });
}
