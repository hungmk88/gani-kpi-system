import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { assertPermission, BusinessError } from "@/lib/rbac";
import { clientMeta, writeAudit } from "@/lib/audit";
import { DATA_SOURCES, ERR } from "@/lib/constants";

const schema = z.object({
  code: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[A-Z0-9_]+$/, "Mã chỉ gồm chữ IN HOA, số và dấu gạch dưới."),
  name: z.string().min(3).max(255),
  description: z.string().max(2000).optional(),
  departmentId: z.string().nullable().optional(),
  unit: z.string().min(1).max(50),
  isHigherBetter: z.boolean().default(true),
  dataSource: z.enum(DATA_SOURCES).default("MANUAL"),
  defaultWeight: z.number().positive().max(100).default(20),
});

export async function POST(req: Request) {
  return handle(async () => {
    const actor = await requireUser();
    assertPermission(actor, "kpi.definition.manage");
    const body = schema.parse(await req.json());

    const exists = await prisma.kpiDefinition.findUnique({
      where: { code: body.code },
    });
    if (exists) {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        `Mã chỉ tiêu "${body.code}" đã tồn tại.`,
        409
      );
    }

    const def = await prisma.kpiDefinition.create({
      data: {
        code: body.code,
        name: body.name,
        description: body.description ?? null,
        departmentId: body.departmentId ?? null,
        unit: body.unit,
        isHigherBetter: body.isHigherBetter,
        dataSource: body.dataSource,
        defaultWeight: body.defaultWeight,
      },
    });

    await writeAudit({
      actor,
      action: "KPI_DEFINITION_CREATE",
      entityName: "kpi_definitions",
      entityId: def.id,
      after: body,
      ...clientMeta(req),
    });

    return ok({ definition: def }, 201);
  });
}

const patchSchema = schema.partial().extend({ isActive: z.boolean().optional() });

export async function PATCH(req: Request) {
  return handle(async () => {
    const actor = await requireUser();
    assertPermission(actor, "kpi.definition.manage");
    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
      throw new BusinessError(ERR.VALIDATION_FAILED, "Thiếu id chỉ tiêu.", 400);
    }
    const body = patchSchema.parse(await req.json());

    const before = await prisma.kpiDefinition.findUnique({ where: { id } });
    if (!before) {
      throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy chỉ tiêu.", 404);
    }

    const def = await prisma.kpiDefinition.update({
      where: { id },
      data: body,
    });

    await writeAudit({
      actor,
      action: "KPI_DEFINITION_UPDATE",
      entityName: "kpi_definitions",
      entityId: id,
      before: { name: before.name, isActive: before.isActive },
      after: body,
      ...clientMeta(req),
    });

    return ok({ definition: def });
  });
}
