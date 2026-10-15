import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { assertPermission, BusinessError } from "@/lib/rbac";
import { clientMeta, writeAudit } from "@/lib/audit";
import {
  assertImportFile,
  assertImportRequestSize,
  parseImportFile,
} from "@/lib/excel";
import { reconcileCell } from "@/lib/services/reconciliation-service";
import { ERR, PERIOD_STATUS_LABEL } from "@/lib/constants";

export const runtime = "nodejs";

/**
 * Kỳ còn nhận số từ Excel: đang mở (nhân viên tự khai) và đã khoá NV (trưởng
 * phòng đang duyệt — cần số hệ thống để đối chiếu). Từ lúc khoá TP trở đi số
 * đã qua tay người duyệt, nạp thêm là đổi số sau lưng họ.
 */
const IMPORTABLE_PERIOD_STATUSES = ["OPEN", "SELF_LOCKED"];
/** Dòng KPI đã qua bước trưởng phòng duyệt / đã chốt thì không nhận số mới. */
const LOCKED_ROW_STATUSES = ["MANAGER_REVIEWED", "FINALIZED"];

/**
 * Nạp số thực tế từ file Excel.
 *
 * File Excel là MỘT NGUỒN số liệu như mọi nguồn tích hợp khác: mỗi dòng được
 * ghi vào kpi_actual_feeds (source EXCEL) rồi đi qua bộ đối soát
 * (reconcileCell) — các nguồn khớp nhau thì mới đồng bộ vào "Số hệ thống",
 * lệch quá ngưỡng thì treo lại chờ người quyết. KHÔNG ghi thẳng actualSystem.
 * Số này cũng KHÔNG ghi đè số nhân viên tự khai.
 *
 * Chỉ nạp cho ô KPI ĐÃ ĐƯỢC GIAO (đã có dòng kpi_results) — không tự đẻ chỉ
 * tiêu mới cho nhân viên.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    assertPermission(user, "kpi.import");

    assertImportRequestSize(req);
    const form = await req.formData();
    const file = assertImportFile(form.get("file"));
    const periodId = String(form.get("periodId") ?? "");

    const period = await prisma.kpiPeriod.findUnique({ where: { id: periodId } });
    if (!period) {
      throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy kỳ KPI.", 404);
    }
    if (period.status === "FINALIZED") {
      throw new BusinessError(
        ERR.KPI_FINALIZED,
        "Kỳ đã chốt, không nạp thêm dữ liệu được.",
        409
      );
    }
    if (!IMPORTABLE_PERIOD_STATUSES.includes(period.status)) {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        `Kỳ ${period.name} đang ở trạng thái "${
          PERIOD_STATUS_LABEL[period.status] ?? period.status
        }" — chỉ nạp số khi kỳ còn mở hoặc đang ở bước trưởng phòng duyệt.`,
        409
      );
    }

    const { rows, errors } = await parseImportFile(await file.arrayBuffer());

    const importBatch = await prisma.dataImport.create({
      data: {
        fileName: file.name,
        source: "EXCEL",
        uploadedById: user.id,
        rowsTotal: rows.length + errors.length,
      },
    });

    // Tra cứu một lần cho cả file thay vì mỗi dòng vài query
    const [defs, employees, assigned] = await Promise.all([
      prisma.kpiDefinition.findMany({
        where: { code: { in: [...new Set(rows.map((r) => r.code))] } },
        select: { id: true, code: true },
      }),
      prisma.user.findMany({
        where: { email: { in: [...new Set(rows.map((r) => r.email))] } },
        select: { id: true, email: true, departmentId: true },
      }),
      prisma.kpiResult.findMany({
        where: { periodId },
        select: {
          id: true,
          employeeId: true,
          kpiDefinitionId: true,
          status: true,
        },
      }),
    ]);
    const defByCode = new Map(defs.map((d) => [d.code, d]));
    const employeeByEmail = new Map(employees.map((e) => [e.email, e]));
    const resultByKey = new Map(
      assigned.map((r) => [`${r.employeeId}|${r.kpiDefinitionId}`, r])
    );

    let okCount = 0;
    const rowErrors = [...errors];
    let mismatchCount = 0;
    const touched = new Set<string>();

    for (const r of rows) {
      if (r.month !== period.month || r.year !== period.year) {
        rowErrors.push(
          `Dòng ${r.rowNumber}: kỳ ${r.month}/${r.year} không khớp kỳ đang nạp (${period.month}/${period.year}).`
        );
        continue;
      }

      const def = defByCode.get(r.code);
      const employee = employeeByEmail.get(r.email);
      if (!def) {
        rowErrors.push(`Dòng ${r.rowNumber}: không có mã KPI "${r.code}".`);
        continue;
      }
      if (!employee) {
        rowErrors.push(`Dòng ${r.rowNumber}: không có nhân sự "${r.email}".`);
        continue;
      }
      if (
        user.role === "MANAGER" &&
        employee.departmentId !== user.departmentId
      ) {
        rowErrors.push(
          `Dòng ${r.rowNumber}: ${r.email} không thuộc phòng ban của bạn.`
        );
        continue;
      }

      const existing = resultByKey.get(`${employee.id}|${def.id}`);
      if (!existing) {
        rowErrors.push(
          `Dòng ${r.rowNumber}: Chưa giao chỉ tiêu này cho nhân viên (${r.code} · ${r.email}).`
        );
        continue;
      }
      if (LOCKED_ROW_STATUSES.includes(existing.status)) {
        rowErrors.push(
          `Dòng ${r.rowNumber}: dòng KPI này đã ${
            existing.status === "FINALIZED" ? "chốt" : "được trưởng phòng duyệt"
          }, không nhận số mới.`
        );
        continue;
      }

      await prisma.kpiActualFeed.create({
        data: {
          kpiDefinitionId: def.id,
          employeeEmail: r.email,
          periodMonth: r.month,
          periodYear: r.year,
          value: r.value,
          source: "EXCEL",
          importId: importBatch.id,
        },
      });
      touched.add(existing.id);
      okCount++;
    }

    // Đối soát mỗi ô một lần (file có thể lặp cùng một ô nhiều dòng — dòng
    // sau cùng là số mới nhất của nguồn EXCEL).
    for (const kpiResultId of touched) {
      const rec = await reconcileCell(kpiResultId);
      if (!rec.skipped && !rec.matched) mismatchCount++;
    }

    await prisma.dataImport.update({
      where: { id: importBatch.id },
      data: {
        rowsOk: okCount,
        rowsError: rowErrors.length,
        errorLog: rowErrors.length ? rowErrors.join("\n") : null,
      },
    });

    await writeAudit({
      actor: user,
      action: "KPI_IMPORT_EXCEL",
      entityName: "data_imports",
      entityId: importBatch.id,
      after: {
        fileName: file.name,
        rowsOk: okCount,
        rowsError: rowErrors.length,
        lechSo: mismatchCount,
      },
      ...clientMeta(req),
    });

    return ok({
      importId: importBatch.id,
      rowsTotal: rows.length + errors.length,
      rowsOk: okCount,
      rowsError: rowErrors.length,
      mismatchCount,
      errors: rowErrors.slice(0, 50),
    });
  });
}
