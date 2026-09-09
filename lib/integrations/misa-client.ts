/**
 * ★ KHUNG GỌI OPEN API MISA ASP — CHƯA TEST, CHƯA GỌI THẬT LẦN NÀO ★
 *
 * Dựng sẵn (10/09/2026) theo tài liệu công khai của MISA, TRƯỚC KHI có
 * `app_id`/`access_code` thật để thử — mục đích là đỡ phải viết lại từ đầu
 * khi bên kỹ thuật MISA mở API xong, không phải để chạy ngay.
 *
 * Nguồn tài liệu (đọc qua công cụ tóm tắt tự động, CHƯA đối chiếu với người
 * thật bên MISA — có thể sai chi tiết, chỉ nên coi là bản nháp):
 *   - https://www.misa.vn/154477/tong-quan-open-api-nen-tang-ke-toan-dich-vu-misa-asp/
 *   - https://actdocs.misa.vn/g2/graph/ACTOpenAPIHelp/index.html
 *
 * Luồng xác thực theo tài liệu:
 *   1. Đăng ký làm đối tác tích hợp với MISA -> được cấp `app_id`.
 *   2. Người dùng (anh) cấp `access_code` qua chính ứng dụng MISA ASP.
 *   3. Gọi `connect` để đổi access_code lấy `access_token` (hạn 12 giờ).
 *
 * Doanh số bán hàng KHÔNG lấy qua API kéo — MISA đẩy qua callback URL đăng
 * ký lúc xin app_id (giống cơ chế webhook GANI đã có ở
 * lib/integrations/signature.ts + lib/services/integration-service.ts).
 * File này CHƯA làm phần callback, chỉ mới phần kéo tồn kho.
 *
 * TRƯỚC KHI DÙNG THẬT: gọi thử `getMisaAccessToken()` và
 * `getMisaInventoryBalance()` với khoá thật, đối chiếu response thật với
 * type khai báo dưới đây — tài liệu công khai có thể lệch so với thực tế.
 */

const MISA_APP_ID = process.env.MISA_APP_ID;
const MISA_ACCESS_CODE = process.env.MISA_ACCESS_CODE;
const MISA_ORG_COMPANY_CODE = process.env.MISA_ORG_COMPANY_CODE;
const MISA_API_URL = process.env.MISA_API_URL || "https://actapp.misa.vn";

export function misaConfigured() {
  return !!(MISA_APP_ID && MISA_ACCESS_CODE && MISA_ORG_COMPANY_CODE);
}

type MisaTokenCache = {
  accessToken: string;
  tenantCode: string;
  expiresAt: number; // epoch ms
};

let tokenCache: MisaTokenCache | null = null;

/**
 * Đổi access_code lấy access_token. Tự cache trong bộ nhớ tiến trình, chỉ
 * gọi lại khi hết hạn (hạn 12 giờ theo tài liệu) — KHÔNG cache ra database vì
 * mỗi lần deploy/khởi động lại tiến trình serverless là mất bộ nhớ, tự xin
 * lại là đúng, đỡ phải lo đồng bộ token giữa nhiều instance.
 */
export async function getMisaAccessToken(): Promise<
  { ok: true; token: string; tenantCode: string } | { ok: false; error: string }
> {
  if (!misaConfigured()) {
    return { ok: false, error: "Chưa cấu hình MISA_APP_ID/MISA_ACCESS_CODE/MISA_ORG_COMPANY_CODE" };
  }

  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return { ok: true, token: tokenCache.accessToken, tenantCode: tokenCache.tenantCode };
  }

  try {
    const res = await fetch(`${MISA_API_URL}/api/oauth/actopen/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: MISA_APP_ID,
        access_code: MISA_ACCESS_CODE,
        org_company_code: MISA_ORG_COMPANY_CODE,
      }),
    });

    if (!res.ok) {
      return { ok: false, error: `MISA connect lỗi HTTP ${res.status}: ${await res.text()}` };
    }

    const body = await res.json();
    if (!body?.Success) {
      return { ok: false, error: `MISA connect từ chối: ${JSON.stringify(body)}` };
    }

    // Tài liệu ghi Data là một CHUỖI JSON lồng bên trong, không phải object
    // thẳng — cẩn thận khi parse, có thể tài liệu sai và MISA trả thẳng object.
    const inner =
      typeof body.Data === "string" ? JSON.parse(body.Data) : body.Data;

    const expiresAt = inner?.expired_time
      ? new Date(inner.expired_time).getTime()
      : Date.now() + 11 * 3600_000; // dự phòng nếu thiếu field, trừ hao 1 giờ

    tokenCache = {
      accessToken: inner.access_token,
      tenantCode: inner.tenant_code,
      expiresAt,
    };

    return { ok: true, token: tokenCache.accessToken, tenantCode: tokenCache.tenantCode };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type MisaInventoryBalanceRow = {
  // CHƯA XÁC NHẬN tên field thật — tài liệu công khai không cho response mẫu
  // đầy đủ, đoán theo quy ước đặt tên các field khác trong tài liệu.
  [key: string]: unknown;
};

/**
 * Lấy tồn kho vật tư theo từng kho — dùng để đối soát với RawMaterial.currentStockKg
 * ("kho lý thuyết" GANI tự trừ theo định mức, xem prisma/schema.prisma).
 *
 * CHƯA TEST. `stockId`/`branchId` để null lấy tất cả theo tài liệu.
 */
export async function getMisaInventoryBalance(opts: {
  stockId?: string | null;
  branchId?: string | null;
  skip?: number;
  take?: number;
}): Promise<
  | { ok: true; rows: MisaInventoryBalanceRow[] }
  | { ok: false; error: string }
> {
  const auth = await getMisaAccessToken();
  if (!auth.ok) return auth;

  try {
    const res = await fetch(
      `${MISA_API_URL}/apir/sync/actopen/get_list_inventory_balance`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-MISA-AccessToken": auth.token,
        },
        body: JSON.stringify({
          app_id: MISA_APP_ID,
          org_company_code: MISA_ORG_COMPANY_CODE,
          stock_id: opts.stockId ?? null,
          branch_id: opts.branchId ?? null,
          skip: opts.skip ?? 0,
          take: opts.take ?? 100,
        }),
      }
    );

    if (!res.ok) {
      return { ok: false, error: `MISA inventory lỗi HTTP ${res.status}: ${await res.text()}` };
    }

    const body = await res.json();
    if (!body?.Success) {
      return { ok: false, error: `MISA inventory từ chối: ${JSON.stringify(body)}` };
    }

    const rows = typeof body.Data === "string" ? JSON.parse(body.Data) : body.Data;
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Doanh số bán hàng: theo tài liệu, MISA ASP đẩy chứng từ bán hàng
 * (voucher_type 13) qua CALLBACK đăng ký lúc xin app_id, không có API kéo
 * trực tiếp đáng tin. Route nhận callback đó CHƯA làm — khi có tài liệu
 * xác nhận cấu trúc callback thật, dựng route mới kiểu
 * `app/api/integrations/misa/webhook/route.ts`, tái dùng
 * lib/integrations/signature.ts nếu MISA cũng ký request giống chuẩn HMAC
 * đang dùng cho iPOS, hoặc viết xác thực riêng theo đúng cách MISA yêu cầu.
 */
