import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { assertPermission, BusinessError } from "@/lib/rbac";
import { clientMeta, writeAudit } from "@/lib/audit";
import { ERR } from "@/lib/constants";

const schema = z.object({
  periodId: z.string().min(1),
  updates: z
    .array(
      z.object({
        resultId: z.string().min(1),
        targetValue: z.number().finite().nonnegative(),
      })
    )
    .min(1)
    .max(200),
});

/**
 * Đặt hàng loạt mục tiêu (targetValue) cho các dòng KpiResult của một kỳ.
 * Dùng cho phòng ban KHÔNG có mục tiêu chung toàn phòng như Sản Xuất
 * (xem KpiPeriodTarget) mà mỗi nhân sự có mục tiêu riêng — vd Sales.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    assertPermission(user, "kpi.target.assign");
    const body = schema.parse(await req.json());

    const period = await prisma.kpiPeriod.findUnique({
      where: { id: body.periodId },
    });
    if (!period) {
      throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy kỳ KPI.", 404);
    }
    if (period.status === "FINALIZED") {
      throw new BusinessError(
        ERR.KPI_FINALIZED,
        "Kỳ này đã chốt vĩnh viễn, không thể sửa mục tiêu.",
        409
      );
    }

    const ids = body.updates.map((u) => u.resultId);
    const rows = await prisma.kpiResult.findMany({
      where: { id: { in: ids } },
      include: { employee: true },
    });
    if (rows.length !== ids.length) {
      throw new BusinessError(
        ERR.NOT_FOUND,
        "Có dòng KPI không tồn tại — tải lại trang và thử lại.",
        404
      );
    }
    for (const r of rows) {
      if (r.periodId !== body.periodId) {
        throw new BusinessError(
          ERR.VALIDATION_FAILED,
          "Có dòng KPI không thuộc kỳ này.",
          400
        );
      }
      if (
        user.role === "MANAGER" &&
        r.employee.departmentId !== user.departmentId
      ) {
        throw new BusinessError(
          ERR.FORBIDDEN,
          "Trưởng phòng chỉ đặt mục tiêu cho nhân sự phòng mình.",
          403
        );
      }
    }

    const byId = new Map(body.updates.map((u) => [u.resultId, u.targetValue]));
    await prisma.$transaction(
      rows.map((r) =>
        prisma.kpiResult.update({
          where: { id: r.id },
          data: { targetValue: byId.get(r.id)! },
        })
      )
    );

    await writeAudit({
      actor: user,
      action: "KPI_TARGET_BULK_SET",
      entityName: "kpi_results",
      entityId: body.periodId,
      after: { count: rows.length, updates: body.updates },
      ...clientMeta(req),
    });

    return ok({ updated: rows.length });
  });
}
