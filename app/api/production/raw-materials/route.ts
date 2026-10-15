import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { BusinessError } from "@/lib/rbac";
import { clientMeta, writeAudit } from "@/lib/audit";
import { ERR } from "@/lib/constants";
import { withProductionRole } from "@/lib/services/production-service";

export const runtime = "nodejs";

const schema = z.object({
  code: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[A-Z0-9-]+$/, "Mã NVL chỉ gồm chữ IN HOA, số và dấu gạch ngang."),
  name: z.string().min(2).max(255),
  unit: z.string().min(1).max(20).default("kg"),
  initialStockKg: z.number().min(0).default(0),
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
      "Chỉ Ban Giám đốc, Giám đốc Sản xuất và quản trị hệ thống mới quản lý được kho NVL.",
      403
    );
  }
  return u;
}

/** Danh mục NVL, kèm 10 giao dịch gần nhất của mỗi mã để xem nhanh không cần bấm vào. */
export async function GET() {
  return handle(async () => {
    await requireUser();
    const materials = await prisma.rawMaterial.findMany({
      orderBy: [{ isActive: "desc" }, { code: "asc" }],
      include: {
        transactions: {
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { createdBy: { select: { fullName: true } } },
        },
      },
    });
    return ok({ materials });
  });
}

/** Tạo mã NVL mới, kèm tồn kho khởi tạo (ghi thành một dòng NHẬP KHO đầu tiên). */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await assertManager(await requireUser());
    const body = schema.parse(await req.json());

    const exists = await prisma.rawMaterial.findUnique({
      where: { code: body.code },
    });
    if (exists) {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        `Mã NVL "${body.code}" đã tồn tại.`,
        409
      );
    }

    // Tạo mã + dòng NHẬP KHO khởi tạo trong cùng transaction.
    const material = await prisma.$transaction(async (tx) => {
      const material = await tx.rawMaterial.create({
        data: {
          code: body.code,
          name: body.name,
          unit: body.unit,
          currentStockKg: body.initialStockKg,
        },
      });
      if (body.initialStockKg > 0) {
        await tx.rawMaterialTransaction.create({
          data: {
            rawMaterialId: material.id,
            type: "STOCK_IN",
            quantityKg: body.initialStockKg,
            balanceAfterKg: body.initialStockKg,
            createdById: user.id,
            note: "Tồn kho khởi tạo lúc tạo mã NVL",
          },
        });
      }
      return material;
    });

    await writeAudit({
      actor: user,
      action: "RAW_MATERIAL_CREATE",
      entityName: "raw_materials",
      entityId: material.id,
      after: body,
      ...clientMeta(req),
    });

    return ok({ material }, 201);
  });
}
