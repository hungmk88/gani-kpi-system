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
    await prisma.auditLog.create({
      data: {
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
      },
    });
  } catch (e) {
    // Không được để lỗi ghi log làm hỏng nghiệp vụ chính, nhưng phải kêu to.
    console.error("[AUDIT] Ghi log thất bại:", e);
  }
}

function safeJson(v: unknown) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function clientMeta(req: Request) {
  const h = req.headers;
  return {
    ip:
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      h.get("x-real-ip") ||
      null,
    userAgent: h.get("user-agent"),
  };
}
