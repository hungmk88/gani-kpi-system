import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { assertPermission, BusinessError } from "@/lib/rbac";
import { clientMeta, writeAudit } from "@/lib/audit";
import { ERR } from "@/lib/constants";
import { kpiOversightDenial } from "@/lib/kpi";
import { recalcResult } from "@/lib/services/kpi-service";

const schema = z.object({
  periodId: z.string().min(1),
  updates: z
    .array(
      z.object({
        resultId: z.string().min(1),
        targetValue: z.number().finite().nonnegative(),
      })
    )
    .min(1, "Không có dòng nào để lưu.")
    // Giao diện tự chia thành nhiều đợt ≤ 200 dòng (xem target-editor.tsx)
    .max(200, "Tối đa 200 dòng mỗi lần lưu."),
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
    // Trưởng phòng chỉ đặt mục tiêu khi kỳ còn mở; sau mốc khoá thì chỉ Ban
    // Giám đốc chỉnh (và mọi lần chỉnh đều vào nhật ký).
    if (user.role === "MANAGER" && period.status !== "OPEN") {
      throw new BusinessError(
        ERR.SLA_LOCKED,
        "Kỳ đã qua mốc khoá — trưởng phòng không sửa mục tiêu được nữa. Liên hệ Ban Giám đốc.",
        409
      );
    }

    // Bỏ trùng resultId, nếu không số dòng tìm được sẽ lệch và báo nhầm "không tồn tại"
    const ids = [...new Set(body.updates.map((u) => u.resultId))];
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
    const isCeo = user.role === "CEO";
    for (const r of rows) {
      if (r.status === "FINALIZED") {
        throw new BusinessError(
          ERR.KPI_FINALIZED,
          `Dòng KPI của ${r.employee.fullName} đã chốt — không sửa mục tiêu được.`,
          409
        );
      }
      if (r.periodId !== body.periodId) {
        throw new BusinessError(
          ERR.VALIDATION_FAILED,
          "Có dòng KPI không thuộc kỳ này.",
          400
        );
      }
      // Trưởng phòng: chỉ nhân viên thường cùng phòng. Mục tiêu của chính
      // mình và của trưởng phòng khác (kể cả cùng phòng) do Ban Giám đốc đặt.
      const denial = kpiOversightDenial(user, r.employee, "target");
      if (denial) {
        throw new BusinessError(
          ERR.FORBIDDEN,
          `${denial} (${r.employee.fullName})`,
          403
        );
      }
      // Đổi mục tiêu của dòng trưởng phòng ĐÃ DUYỆT là đổi điểm sau lưng
      // người duyệt — chỉ Ban Giám đốc (mọi lần đổi đều vào nhật ký).
      if (!isCeo && r.status === "MANAGER_REVIEWED") {
        throw new BusinessError(
          ERR.SLA_LOCKED,
          `Dòng KPI của ${r.employee.fullName} đã được duyệt — muốn đổi mục tiêu thì liên hệ Ban Giám đốc.`,
          409
        );
      }
    }

    // Ghi CÓ ĐIỀU KIỆN theo trạng thái: kiểm ở trên là đọc trong bộ nhớ, Ban
    // Giám đốc có thể khoá (hoặc trưởng phòng duyệt) đúng lúc này. Gom theo
    // giá trị mục tiêu để mỗi giá trị một lệnh; thiếu dòng nào thì huỷ cả lượt.
    const allowedStatuses = isCeo
      ? ["DRAFT", "SELF_REVIEWED", "MANAGER_REVIEWED"]
      : ["DRAFT", "SELF_REVIEWED"];
    const idsByValue = new Map<number, string[]>();
    for (const u of body.updates) {
      if (!ids.includes(u.resultId)) continue;
      // Trùng resultId: lần cuối thắng — bỏ id khỏi nhóm cũ
      for (const list of idsByValue.values()) {
        const i = list.indexOf(u.resultId);
        if (i >= 0) list.splice(i, 1);
      }
      idsByValue.set(u.targetValue, [...(idsByValue.get(u.targetValue) ?? []), u.resultId]);
    }
    await prisma.$transaction(async (tx) => {
      let written = 0;
      for (const [targetValue, group] of idsByValue) {
        if (group.length === 0) continue;
        const res = await tx.kpiResult.updateMany({
          where: {
            id: { in: group },
            periodId: body.periodId,
            status: { in: allowedStatuses },
          },
          data: { targetValue },
        });
        written += res.count;
      }
      if (written !== rows.length) {
        throw new BusinessError(
          ERR.KPI_FINALIZED,
          "Có dòng KPI vừa được duyệt hoặc chốt trong lúc lưu — chưa lưu dòng nào. Tải lại trang và thử lại.",
          409
        );
      }
    });

    // Mục tiêu đổi thì điểm phải tính lại ngay, không để điểm và mục tiêu lệch nhau
    for (const r of rows) await recalcResult(r.id);

    await writeAudit({
      actor: user,
      action: "KPI_TARGET_BULK_SET",
      entityName: "kpi_results",
      entityId: body.periodId,
      before: rows.map((r) => ({ resultId: r.id, targetValue: r.targetValue })),
      after: { count: rows.length, updates: body.updates },
      ...clientMeta(req),
    });

    return ok({ updated: rows.length });
  });
}
