import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { assertPermission, BusinessError } from "@/lib/rbac";
import { clientMeta, writeAudit } from "@/lib/audit";
import { ERR } from "@/lib/constants";

const schema = z.object({
  code: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[A-Z0-9_]+$/, "Mã chỉ gồm chữ IN HOA, số và dấu gạch dưới."),
  name: z.string().min(2).max(255),
});

export async function POST(req: Request) {
  return handle(async () => {
    const actor = await requireUser();
    assertPermission(actor, "admin.departments");
    const body = schema.parse(await req.json());

    const exists = await prisma.department.findUnique({
      where: { code: body.code },
    });
    if (exists) {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        `Mã phòng ban "${body.code}" đã tồn tại.`,
        409
      );
    }

    const dept = await prisma.department.create({ data: body });

    await writeAudit({
      actor,
      action: "DEPARTMENT_CREATE",
      entityName: "departments",
      entityId: dept.id,
      after: body,
      ...clientMeta(req),
    });

    return ok({ department: dept }, 201);
  });
}
