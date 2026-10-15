import { prisma } from "./db";
import type { SessionUser } from "./auth";

type AuditInput = {
  actor: SessionUser | null;
  action: string;
  entityName: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Ghi Immutable Audit Log.
 * Nguyên tắc: KHÔNG có API nào trong hệ thống được phép sửa/xoá bảng audit_logs.
 * Mọi thao tác chạm vào điểm KPI đã chốt bắt buộc đi qua đây kèm lý do.
 */
export async function writeAudit(input: AuditInput) {
  try {
    await prisma.auditLog.create({ data: auditRecord(input) });
  } catch (e) {
    // Không được để lỗi ghi log làm hỏng nghiệp vụ chính, nhưng phải kêu to.
    console.error("[AUDIT] Ghi log thất bại:", e);
  }
}

/**
 * Một dòng audit_logs đúng định dạng — dùng chung cho writeAudit và cho nơi
 * phải ghi nhật ký hàng loạt TRONG một giao dịch (createMany).
 */
export function auditRecord(input: AuditInput) {
  return {
    userId: input.actor?.id ?? null,
    userEmail: input.actor?.email ?? null,
    action: input.action,
    entityName: input.entityName,
    entityId: input.entityId,
    beforePayload: input.before ? safeJson(input.before) : null,
    afterPayload: input.after ? safeJson(input.after) : null,
    reason: input.reason ?? null,
    ipAddress: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  };
}

function safeJson(v: unknown) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * IP + User-Agent của người gọi, dùng cho nhật ký và đếm giới hạn đăng nhập.
 *
 * KHÔNG tin X-Forwarded-For do client tự gửi: ai cũng đặt được header đó, và
 * nếu tin nó thì kẻ dò mật khẩu chỉ cần đổi XFF mỗi lần là thoát giới hạn theo
 * IP (hoặc đổ tội cho IP người khác trong nhật ký).
 *  - Trên Vercel (VERCEL=1): edge của Vercel GHI ĐÈ các header này. Ưu tiên
 *    `x-vercel-forwarded-for`, không có thì lấy phần tử đầu của XFF (do Vercel
 *    đặt, không phải giá trị client gửi).
 *  - Ngoài Vercel: chỉ dùng `x-real-ip` (reverse proxy đặt). XFF chỉ được dùng
 *    khi TRUST_PROXY=1, tức người triển khai xác nhận phía trước app có đúng
 *    một proxy tin cậy luôn ghi đè XFF.
 */
export function clientMeta(req: Request) {
  const h = req.headers;
  const firstXff = () => h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  let ip: string | null;
  if (process.env.VERCEL === "1") {
    ip =
      h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || firstXff();
  } else {
    ip =
      h.get("x-real-ip")?.trim() ||
      (process.env.TRUST_PROXY === "1" ? firstXff() : null);
  }
  return {
    ip: ip || null,
    userAgent: h.get("user-agent"),
  };
}
