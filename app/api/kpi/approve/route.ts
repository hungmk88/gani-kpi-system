import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { assertPermission } from "@/lib/rbac";
import { clientMeta, writeAudit } from "@/lib/audit";
import { ceoApprove } from "@/lib/services/kpi-service";

const schema = z.object({
  /** Duyệt từng dòng cụ thể... */
  resultIds: z.array(z.string()).optional(),
  /** ...hoặc duyệt cả kỳ (Approve All). */
  periodId: z.string().optional(),
  /** Giới hạn theo 1 nhân sự khi duyệt cả kỳ. */
  employeeId: z.string().optional(),
  ceoNote: z.string().max(2000).optional(),
  /** Khoá luôn toàn kỳ sau khi duyệt xong. */
  finalizePeriod: z.boolean().default(false),
});

/** Ban Giám đốc duyệt và khoá vĩnh viễn — bước cuối của luồng 2-4-5. */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    assertPermission(user, "kpi.ceo_approve");
    const body = schema.parse(await req.json());
    const meta = clientMeta(req);

    let ids = body.resultIds ?? [];

    if (ids.length === 0 && body.periodId) {
      const rows = await prisma.kpiResult.findMany({
        where: {
          periodId: body.periodId,
          status: { not: "FINALIZED" },
          ...(body.employeeId ? { employeeId: body.employeeId } : {}),
        },
        select: { id: true },
      });
      ids = rows.map((r) => r.id);
    }

    const res = await ceoApprove(user, ids, { ceoNote: body.ceoNote }, meta);

    let periodFinalized = false;
    if (body.finalizePeriod && body.periodId) {
      const remaining = await prisma.kpiResult.count({
        where: { periodId: body.periodId, status: { not: "FINALIZED" } },
      });
      if (remaining === 0) {
        await prisma.kpiPeriod.update({
          where: { id: body.periodId },
          data: {
            status: "FINALIZED",
            isLocked: true,
            finalizedAt: new Date(),
          },
        });
        periodFinalized = true;
        await writeAudit({
          actor: user,
          action: "KPI_PERIOD_FINALIZE",
          entityName: "kpi_periods",
          entityId: body.periodId,
          after: { status: "FINALIZED" },
          ...meta,
        });
      }
    }

    return ok({ ...res, periodFinalized });
  });
}
