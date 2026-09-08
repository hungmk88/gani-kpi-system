import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { assertPermission, BusinessError } from "@/lib/rbac";
import { clientMeta, writeAudit } from "@/lib/audit";
import { parseImportFile } from "@/lib/excel";
import { recalcResult } from "@/lib/services/kpi-service";
import { sendCeoAlert } from "@/lib/telegram";
import { ERR } from "@/lib/constants";

export const runtime = "nodejs";

/**
 * Nạp số thực tế từ file Excel vào cột "Số hệ thống" (actualSystem).
 * Số này KHÔNG ghi đè số nhân viên tự khai — hai cột nằm cạnh nhau để đối soát.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    assertPermission(user, "kpi.import");

    const form = await req.formData();
    const file = form.get("file");
    const periodId = String(form.get("periodId") ?? "");

    if (!(file instanceof File)) {
      throw new BusinessError(ERR.VALIDATION_FAILED, "Chưa chọn file Excel.", 400);
    }
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

    const { rows, errors } = await parseImportFile(await file.arrayBuffer());

    const importBatch = await prisma.dataImport.create({
      data: {
        fileName: file.name,
        source: "EXCEL",
        uploadedById: user.id,
        rowsTotal: rows.length + errors.length,
      },
    });

    let okCount = 0;
    const rowErrors = [...errors];
    let mismatchCount = 0;

    for (const r of rows) {
      if (r.month !== period.month || r.year !== period.year) {
        rowErrors.push(
          `Dòng ${r.rowNumber}: kỳ ${r.month}/${r.year} không khớp kỳ đang nạp (${period.month}/${period.year}).`
        );
        continue;
      }

      const [def, employee] = await Promise.all([
        prisma.kpiDefinition.findUnique({ where: { code: r.code } }),
        prisma.user.findUnique({ where: { email: r.email } }),
      ]);
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

      const existing = await prisma.kpiResult.findUnique({
        where: {
          periodId_employeeId_kpiDefinitionId: {
            periodId,
            employeeId: employee.id,
            kpiDefinitionId: def.id,
          },
        },
      });
      if (existing?.status === "FINALIZED") {
        rowErrors.push(
          `Dòng ${r.rowNumber}: dòng KPI này đã chốt, không ghi đè được.`
        );
        continue;
      }

      const saved = await prisma.kpiResult.upsert({
        where: {
          periodId_employeeId_kpiDefinitionId: {
            periodId,
            employeeId: employee.id,
            kpiDefinitionId: def.id,
          },
        },
        update: { actualSystem: r.value },
        create: {
          periodId,
          employeeId: employee.id,
          kpiDefinitionId: def.id,
          weightPercent: def.defaultWeight,
          targetValue: 0,
          actualSystem: r.value,
          status: "DRAFT",
        },
      });

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

      const updated = await recalcResult(saved.id);
      if (updated.hasMismatch) mismatchCount++;
      okCount++;
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
      },
      ...clientMeta(req),
    });

    if (mismatchCount > 0) {
      await sendCeoAlert({
        title: "Phát hiện lệch số liệu sau khi nạp Excel",
        details: `${mismatchCount} dòng KPI có số nhân viên tự khai lệch quá 5% so với số vừa nạp từ file "${file.name}".`,
        actionPath: `/kpi/${periodId}`,
      });
    }

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
