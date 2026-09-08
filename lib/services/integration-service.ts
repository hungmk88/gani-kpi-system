import { z } from "zod";
import { prisma } from "../db";
import { verifyWebhookSignature } from "../integrations/signature";
import { writeAudit } from "../audit";
import { reconcileCell } from "./reconciliation-service";

/**
 * CỔNG NHẬN DỮ LIỆU TỪ HỆ THỐNG BÊN NGOÀI.
 *
 * Một cửa duy nhất cho iPOS, CRM, ERP, Google Sheets. Mỗi nguồn có khoá bí mật
 * riêng, ký HMAC SHA256 trên thân tin — lộ khoá của một nguồn không kéo theo
 * nguồn khác.
 *
 * Đường đi của dữ liệu:
 *   webhook → xác minh chữ ký → ghi kpi_actual_feeds (nhật ký thô, không mất)
 *           → đối soát với các nguồn khác
 *           → khớp thì đồng bộ vào KPI, lệch thì treo lại chờ người quyết
 *
 * Dữ liệu thô LUÔN được lưu, kể cả khi kỳ chưa mở hoặc dòng KPI đã chốt. Sau này
 * cần tra lại "hôm đó iPOS báo bao nhiêu" thì vẫn còn.
 */

const itemSchema = z.object({
  kpiCode: z.string().min(1),
  employeeEmail: z.string().email(),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2100),
  value: z.number().finite(),
});

const bodySchema = z.union([itemSchema, z.array(itemSchema).max(500)]);

export type IngestResult = {
  httpStatus: number;
  signatureOk: boolean;
  received: number;
  applied: number;
  rejected: number;
  mismatches: number;
  errors: string[];
  message?: string;
};

/** Ánh xạ loại nguồn sang giá trị lưu trong cột `source` của kpi_actual_feeds. */
function feedSourceKind(kind: string) {
  switch (kind) {
    case "IPOS":
      return "IPOS_API";
    case "CRM":
      return "CRM_API";
    case "ERP":
      return "ERP_API";
    case "SHEETS":
      return "SHEETS";
    default:
      return "EXTERNAL_API";
  }
}

export async function ingestFromSource(opts: {
  sourceCode: string;
  rawBody: string;
  headers: Headers;
  ip?: string | null;
  /**
   * Khoá dùng chung kiểu cũ (header X-Webhook-Secret). Giữ lại để đường tích hợp
   * iPOS làm từ Phase 1 không gãy khi nâng cấp.
   */
  legacySecret?: string | null;
}): Promise<IngestResult> {
  const code = opts.sourceCode.toLowerCase();
  const endpoint = `/api/integrations/${code}/webhook`;

  const log = async (r: IngestResult, sourceId?: string | null) => {
    await prisma.webhookLog.create({
      data: {
        sourceCode: code,
        sourceId: sourceId ?? null,
        endpoint,
        signatureOk: r.signatureOk,
        httpStatus: r.httpStatus,
        itemsReceived: r.received,
        itemsApplied: r.applied,
        itemsRejected: r.rejected,
        error: r.errors.length ? r.errors.slice(0, 10).join(" | ") : null,
        payloadSample: opts.rawBody.slice(0, 2000),
        ipAddress: opts.ip ?? null,
      },
    });
    return r;
  };

  /* -------------------------------------------------- 1. XÁC MINH NGUỒN */

  const source = await prisma.integrationSource.findUnique({ where: { code } });

  if (!source && !opts.legacySecret) {
    return log({
      httpStatus: 404,
      signatureOk: false,
      received: 0,
      applied: 0,
      rejected: 0,
      mismatches: 0,
      errors: [],
      message: `Chưa đăng ký nguồn tích hợp có mã "${code}". Vào Quản trị → Tích hợp để tạo.`,
    });
  }

  if (source && !source.isActive) {
    return log(
      {
        httpStatus: 403,
        signatureOk: false,
        received: 0,
        applied: 0,
        rejected: 0,
        mismatches: 0,
        errors: [],
        message: `Nguồn "${source.name}" đang bị tạm ngưng.`,
      },
      source.id
    );
  }

  /* -------------------------------------------------- 2. XÁC MINH CHỮ KÝ */

  let signatureOk = false;
  let authError = "";

  if (source) {
    const check = verifyWebhookSignature({
      rawBody: opts.rawBody,
      signatureHeader: opts.headers.get("x-signature"),
      timestampHeader: opts.headers.get("x-timestamp"),
      secret: source.secret,
    });
    signatureOk = check.ok;
    authError = check.reason ?? "";
  }

  // Đường cũ: khoá dùng chung trong header, không có chống phát lại.
  // Yếu hơn HMAC nhưng vẫn phải đúng khoá mới qua được.
  if (!signatureOk && opts.legacySecret) {
    const provided = opts.headers.get("x-webhook-secret");
    if (provided && provided === opts.legacySecret) {
      signatureOk = true;
      authError = "";
    } else if (!authError) {
      authError = "Sai khoá bí mật webhook.";
    }
  }

  if (!signatureOk) {
    return log(
      {
        httpStatus: 401,
        signatureOk: false,
        received: 0,
        applied: 0,
        rejected: 0,
        mismatches: 0,
        errors: [],
        message: `Xác thực thất bại: ${authError}`,
      },
      source?.id
    );
  }

  /* -------------------------------------------------- 3. ĐỌC DỮ LIỆU */

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(JSON.parse(opts.rawBody));
  } catch (e) {
    return log(
      {
        httpStatus: 422,
        signatureOk: true,
        received: 0,
        applied: 0,
        rejected: 0,
        mismatches: 0,
        errors: [e instanceof Error ? e.message.slice(0, 300) : String(e)],
        message: "Dữ liệu gửi lên sai định dạng.",
      },
      source?.id
    );
  }

  const items = Array.isArray(parsed) ? parsed : [parsed];
  const kind = source ? feedSourceKind(source.kind) : "IPOS_API";

  let applied = 0;
  let mismatches = 0;
  const errors: string[] = [];

  /* -------------------------------------------------- 4. NẠP VÀ ĐỐI SOÁT */

  for (const item of items) {
    const [def, employee, period] = await Promise.all([
      prisma.kpiDefinition.findUnique({ where: { code: item.kpiCode } }),
      prisma.user.findUnique({ where: { email: item.employeeEmail } }),
      prisma.kpiPeriod.findUnique({
        where: { month_year: { month: item.month, year: item.year } },
      }),
    ]);

    if (!def) {
      errors.push(`Không có mã KPI "${item.kpiCode}".`);
      continue;
    }
    if (!employee) {
      errors.push(`Không có nhân sự "${item.employeeEmail}".`);
      continue;
    }

    // Nhật ký thô luôn được ghi, bất kể phần sau có dùng được hay không
    await prisma.kpiActualFeed.create({
      data: {
        kpiDefinitionId: def.id,
        employeeEmail: item.employeeEmail,
        periodMonth: item.month,
        periodYear: item.year,
        value: item.value,
        source: kind,
        sourceCode: code,
        rawPayload: JSON.stringify(item),
      },
    });

    if (!period) {
      errors.push(
        `Kỳ ${item.month}/${item.year} chưa mở — đã lưu dữ liệu thô để dùng sau.`
      );
      continue;
    }
    if (period.status === "FINALIZED") {
      errors.push(`Kỳ ${period.name} đã chốt — bỏ qua bản ghi này.`);
      continue;
    }

    const existing = await prisma.kpiResult.findUnique({
      where: {
        periodId_employeeId_kpiDefinitionId: {
          periodId: period.id,
          employeeId: employee.id,
          kpiDefinitionId: def.id,
        },
      },
    });

    // An toàn khoá dữ liệu: dòng đã chốt thì webhook không đụng vào được
    if (existing?.status === "FINALIZED") {
      errors.push(
        `Dòng KPI ${def.code} của ${employee.email} đã chốt — bỏ qua.`
      );
      continue;
    }

    const row =
      existing ??
      (await prisma.kpiResult.create({
        data: {
          periodId: period.id,
          employeeId: employee.id,
          kpiDefinitionId: def.id,
          weightPercent: def.defaultWeight,
          targetValue: 0,
          status: "DRAFT",
        },
      }));

    // Đối soát quyết định có ghi số vào KPI hay không — không ghi thẳng ở đây
    const rec = await reconcileCell(row.id);
    if (!rec.skipped && !rec.matched) mismatches++;
    applied++;
  }

  if (source) {
    await prisma.integrationSource.update({
      where: { id: source.id },
      data: {
        lastSeenAt: new Date(),
        lastStatus:
          errors.length === 0
            ? `OK · ${applied}/${items.length} bản ghi`
            : `${applied}/${items.length} bản ghi, ${errors.length} lỗi`,
      },
    });
  }

  await writeAudit({
    actor: null,
    action: "INTEGRATION_INGEST",
    entityName: "integration_sources",
    entityId: source?.id ?? code,
    after: {
      nguon: code,
      nhanDuoc: items.length,
      apDung: applied,
      lechSo: mismatches,
      loi: errors.length,
    },
    ip: opts.ip ?? null,
  });

  return log(
    {
      httpStatus: 200,
      signatureOk: true,
      received: items.length,
      applied,
      rejected: items.length - applied,
      mismatches,
      errors: errors.slice(0, 50),
    },
    source?.id
  );
}
