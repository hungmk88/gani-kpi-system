import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { safeEqual } from "../secrets";
import { z } from "zod";
import { prisma } from "../db";
import {
  SIGNATURE_TOLERANCE_SECONDS,
  verifyWebhookSignature,
} from "../integrations/signature";
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

/** Trần số dòng webhook_logs cho lượt xác thực hỏng, mỗi nguồn mỗi cửa sổ. */
const FAILED_AUTH_LOG_LIMIT = 20;
const FAILED_AUTH_LOG_WINDOW_MS = 10 * 60_000;

const SIGNATURE_SEEN_ACTION = "INTEGRATION_SIGNATURE_SEEN";

/**
 * Giữ chỗ cho một chữ ký webhook. Trả `fresh: false` nếu chữ ký này đã được
 * dùng trong cửa sổ chống phát lại. Nhìn lùi 2× dung sai (+1 phút): dấu thời
 * gian được lệch ±dung sai nên một gói hợp lệ sống tối đa 2× dung sai.
 */
async function claimSignature(code: string, signature: string, ip?: string | null) {
  const digest = crypto.createHash("sha256").update(signature.trim()).digest("hex");
  const entityId = `${code}:${digest}`;
  const since = new Date(Date.now() - (2 * SIGNATURE_TOLERANCE_SECONDS + 60) * 1000);
  const fresh = await prisma.$transaction(async (tx) => {
    // Khoá theo đúng chữ ký, tự nhả khi transaction kết thúc (an toàn với
    // pgbouncer chế độ transaction vì cả khối chạy trên một connection).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"webhook-sig:" + entityId}))`;
    const seen = await tx.auditLog.findFirst({
      where: {
        action: SIGNATURE_SEEN_ACTION,
        entityName: "integration_sources",
        entityId,
        createdAt: { gte: since },
      },
      select: { id: true },
    });
    if (seen) return false;
    await tx.auditLog.create({
      data: {
        action: SIGNATURE_SEEN_ACTION,
        entityName: "integration_sources",
        entityId,
        ipAddress: ip ?? null,
      },
    });
    return true;
  });
  return { fresh };
}

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
    // Lượt bị chặn ở khâu xác thực (401 sai chữ ký / 403 nguồn tạm ngưng):
    // ai biết mã nguồn cũng bắn được, nên (1) KHÔNG lưu payload — thân tin của
    // kẻ lạ không đáng giữ và có thể là rác cỡ lớn; (2) chỉ ghi tối đa
    // FAILED_AUTH_LOG_LIMIT dòng mỗi nguồn trong FAILED_AUTH_LOG_WINDOW_MS —
    // đủ để quản trị thấy "đang có người gõ cửa", không để bị spam đầy bảng.
    // (Đếm rồi ghi không khoá: bắn song song có thể vượt ngưỡng vài dòng —
    // chấp nhận, mục tiêu chỉ là chặn tăng không giới hạn.)
    const failedAuth = r.httpStatus === 401 || r.httpStatus === 403;
    if (failedAuth) {
      const recent = await prisma.webhookLog.count({
        where: {
          sourceCode: code,
          httpStatus: { in: [401, 403] },
          createdAt: { gte: new Date(Date.now() - FAILED_AUTH_LOG_WINDOW_MS) },
        },
      });
      if (recent >= FAILED_AUTH_LOG_LIMIT) return r;
    }
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
        error: r.errors.length
          ? r.errors.slice(0, 10).join(" | ")
          : failedAuth
            ? (r.message?.slice(0, 300) ?? null)
            : null,
        payloadSample: failedAuth ? null : opts.rawBody.slice(0, 2000),
        ipAddress: opts.ip ?? null,
      },
    });
    return r;
  };

  /* -------------------------------------------------- 1. XÁC MINH NGUỒN */

  const source = await prisma.integrationSource.findUnique({ where: { code } });

  // Nguồn lạ: trả 404 nhưng KHÔNG ghi webhook_logs — nếu không, ai cũng spam
  // được bảng log bằng request rác mà chẳng cần khoá gì.
  if (!source && !opts.legacySecret) {
    return {
      httpStatus: 404,
      signatureOk: false,
      received: 0,
      applied: 0,
      rejected: 0,
      mismatches: 0,
      errors: [],
      message: `Chưa đăng ký nguồn tích hợp có mã "${code}". Vào Quản trị → Tích hợp để tạo.`,
    };
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
  // Chỉ dùng khi CHƯA đăng ký nguồn HMAC — đã có HMAC thì bắt buộc HMAC,
  // không để đường yếu hơn làm cửa sau.
  if (!signatureOk && !source && opts.legacySecret) {
    const provided = opts.headers.get("x-webhook-secret");
    if (safeEqual(provided, opts.legacySecret)) {
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

  /* -------------------------------------------- 2b. CHỐNG PHÁT LẠI */

  // Chữ ký hợp lệ trong cửa sổ ±SIGNATURE_TOLERANCE_SECONDS: kẻ bắt được gói
  // tin vẫn bắn lại được NGAY trong cửa sổ đó (ghi feed trùng, đối soát lại).
  // Mỗi chữ ký chỉ được dùng một lần: lưu dấu (băm của chữ ký) vào audit_logs
  // — không cần bảng mới — dưới khoá advisory để hai lượt song song không cùng
  // lọt. Đường khoá cũ (legacy, không có chữ ký) không áp dụng được.
  if (source) {
    const replay = await claimSignature(code, opts.headers.get("x-signature") ?? "", opts.ip);
    if (!replay.fresh) {
      return log(
        {
          httpStatus: 409,
          signatureOk: true,
          received: 0,
          applied: 0,
          rejected: 0,
          mismatches: 0,
          errors: [],
          message: "Gói tin này đã được nhận (trùng chữ ký) — bỏ qua để tránh ghi trùng.",
        },
        source.id
      );
    }
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

  // Nạp trước MỘT lần cho cả lô: chỉ tiêu, nhân sự, kỳ, dòng KPI. Trước đây
  // mỗi bản ghi ~10 query (lô 500 dòng = 5.000 vòng tới pooler) — vượt trần
  // thời gian của hàm serverless.
  const codes = [...new Set(items.map((i) => i.kpiCode))];
  const emails = [...new Set(items.map((i) => i.employeeEmail))];
  const monthYears = [
    ...new Map(items.map((i) => [`${i.year}-${i.month}`, { month: i.month, year: i.year }])).values(),
  ];
  const [defs, users, periods] = await Promise.all([
    prisma.kpiDefinition.findMany({ where: { code: { in: codes } } }),
    prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } }),
    prisma.kpiPeriod.findMany({ where: { OR: monthYears } }),
  ]);
  const defByCode = new Map(defs.map((d) => [d.code, d]));
  const userByEmail = new Map(users.map((u) => [u.email, u]));
  const periodByKey = new Map(periods.map((p) => [`${p.year}-${p.month}`, p]));

  const usablePeriodIds = periods.filter((p) => p.status !== "FINALIZED").map((p) => p.id);
  const resultRows =
    usablePeriodIds.length && users.length && defs.length
      ? await prisma.kpiResult.findMany({
          where: {
            periodId: { in: usablePeriodIds },
            employeeId: { in: users.map((u) => u.id) },
            kpiDefinitionId: { in: defs.map((d) => d.id) },
          },
          select: { id: true, periodId: true, employeeId: true, kpiDefinitionId: true, status: true },
        })
      : [];
  const resultByKey = new Map(
    resultRows.map((r) => [`${r.periodId}|${r.employeeId}|${r.kpiDefinitionId}`, r])
  );

  // Nhật ký thô: một lệnh createMany. createdAt tăng dần theo thứ tự trong lô
  // để "bản mới nhất của mỗi nguồn" (latestSources) vẫn là dòng gửi sau cùng,
  // y như khi ghi từng dòng.
  const feedRows: Prisma.KpiActualFeedCreateManyInput[] = [];
  const cellsToReconcile = new Set<string>();
  const baseTime = Date.now();

  for (const item of items) {
    const def = defByCode.get(item.kpiCode);
    const employee = userByEmail.get(item.employeeEmail);
    const period = periodByKey.get(`${item.year}-${item.month}`);

    if (!def) {
      errors.push(`Không có mã KPI "${item.kpiCode}".`);
      continue;
    }
    if (!employee) {
      errors.push(`Không có nhân sự "${item.employeeEmail}".`);
      continue;
    }

    // Nhật ký thô luôn được ghi, bất kể phần sau có dùng được hay không
    feedRows.push({
      kpiDefinitionId: def.id,
      employeeEmail: item.employeeEmail,
      periodMonth: item.month,
      periodYear: item.year,
      value: item.value,
      source: kind,
      sourceCode: code,
      rawPayload: JSON.stringify(item),
      createdAt: new Date(baseTime + feedRows.length),
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

    const existing = resultByKey.get(`${period.id}|${employee.id}|${def.id}`);

    // An toàn khoá dữ liệu: dòng đã chốt thì webhook không đụng vào được
    if (existing?.status === "FINALIZED") {
      errors.push(
        `Dòng KPI ${def.code} của ${employee.email} đã chốt — bỏ qua.`
      );
      continue;
    }

    // Không tự tạo dòng KPI — chỉ tiêu chưa giao cho người này thì không ai
    // được tự ý giao thay trưởng phòng (cùng luật với nạp Excel và cầu nối
    // sản xuất). Số vẫn nằm trong nhật ký feed, giao xong là đối soát được.
    if (!existing) {
      errors.push(
        `Chưa giao chỉ tiêu ${def.code} cho ${employee.email} trong kỳ ${period.name} — bỏ qua.`
      );
      continue;
    }

    cellsToReconcile.add(existing.id);
    applied++;
  }

  if (feedRows.length) {
    await prisma.kpiActualFeed.createMany({ data: feedRows });
  }

  // Đối soát quyết định có ghi số vào KPI hay không — không ghi thẳng ở đây.
  // Mỗi ô chỉ đối soát MỘT lần dù lô có nhiều bản ghi cho cùng ô: đối soát
  // đọc bản mới nhất của mỗi nguồn, chạy lại cũng ra đúng kết quả đó.
  for (const rowId of cellsToReconcile) {
    try {
      const rec = await reconcileCell(rowId);
      if (!rec.skipped && !rec.matched) mismatches++;
    } catch (e) {
      console.error("[INTEGRATION] Đối soát ô lỗi:", rowId, e);
      errors.push("Một ô KPI đối soát lỗi — số thô đã lưu, bộ máy nền sẽ đối soát lại.");
    }
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
