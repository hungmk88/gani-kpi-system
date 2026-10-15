import { strongSecret } from "@/lib/secrets";
import { NextResponse } from "next/server";
import { ingestFromSource } from "@/lib/services/integration-service";
import { clientMeta } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * CỔNG NHẬN DỮ LIỆU ĐA NGUỒN — một địa chỉ cho mọi hệ thống bên ngoài.
 *
 *   POST /api/integrations/<mã-nguồn>/webhook
 *
 * Header bắt buộc:
 *   X-Timestamp: <giây UNIX>
 *   X-Signature: sha256=<HMAC_SHA256("<timestamp>.<body>", secret)>
 *
 * Thân tin (một bản ghi hoặc mảng tối đa 500):
 *   [{ "kpiCode": "SALES_REV", "employeeEmail": "...",
 *      "month": 9, "year": 2026, "value": 520000000 }]
 *
 * Mã nguồn và khoá bí mật khai ở Quản trị → Tích hợp.
 *
 * Riêng nguồn "ipos" còn nhận được cách xác thực cũ bằng header X-Webhook-Secret
 * để đường tích hợp làm từ Phase 1 không gãy.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ source: string }> }
) {
  const { source } = await ctx.params;

  // Phải đọc thân tin ở dạng chuỗi thô: ký HMAC trên đúng từng byte,
  // JSON.parse rồi stringify lại là chữ ký sai ngay.
  const rawBody = await req.text();

  const result = await ingestFromSource({
    sourceCode: source,
    rawBody,
    headers: req.headers,
    ip: clientMeta(req).ip,
    legacySecret:
      source.toLowerCase() === "ipos"
        ? strongSecret("IPOS_WEBHOOK_SECRET", 16)
        : null,
  });

  return NextResponse.json(
    {
      status: result.httpStatus === 200 ? "OK" : "REJECTED",
      received: result.received,
      applied: result.applied,
      rejected: result.rejected,
      mismatches: result.mismatches,
      message: result.message,
      errors: result.errors,
    },
    { status: result.httpStatus }
  );
}
