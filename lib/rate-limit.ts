import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

/**
 * Giới hạn tần suất dựa trên audit_logs — không cần Redis hay bảng đếm riêng.
 *
 * Vấn đề của kiểu "đếm rồi mới ghi": hai request song song cùng đọc "mới 4 lần
 * sai" rồi cùng lọt. Cách chữa: mọi thao tác đếm + ghi dòng đếm của CÙNG một
 * khoá (email, userId...) chạy trong một transaction có giữ
 * pg_advisory_xact_lock — các lượt song song phải xếp hàng nối tiếp. Khoá theo
 * transaction (xact) nên an toàn với pgbouncer chế độ transaction: khoá tự nhả
 * khi transaction kết thúc, không bao giờ kẹt lại trên connection khác.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/** Khoá tuần tự theo `key` cho tới hết transaction hiện tại. */
export async function lockKey(tx: Prisma.TransactionClient, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}::text))`;
}

export type AuditCountFilter = {
  action: string | string[];
  /** Mốc bắt đầu cửa sổ đếm (bao gồm). */
  since: Date;
  /** Mốc kết thúc (không bao gồm) — mặc định tới hiện tại. */
  until?: Date;
  entityId?: string;
  userId?: string;
  ip?: string | null;
};

/**
 * Đếm số dòng audit_logs khớp bộ lọc trong cửa sổ thời gian. Trường nào bỏ
 * trống (undefined) thì không lọc theo trường đó. `ip: null` (không xác định
 * được IP) đếm chung một "xô" các dòng không có IP — chặt hơn là bỏ qua, vì bỏ
 * qua thì kẻ dò chỉ cần giấu IP là thoát giới hạn.
 */
export async function countAudit(db: Db, f: AuditCountFilter): Promise<number> {
  return db.auditLog.count({
    where: {
      action: Array.isArray(f.action) ? { in: f.action } : f.action,
      createdAt: f.until ? { gte: f.since, lt: f.until } : { gte: f.since },
      ...(f.entityId !== undefined ? { entityId: f.entityId } : {}),
      ...(f.userId !== undefined ? { userId: f.userId } : {}),
      ...(f.ip !== undefined ? { ipAddress: f.ip } : {}),
    },
  });
}

/** Mốc bắt đầu của một cửa sổ trượt dài `ms` tính tới bây giờ. */
export function windowStart(ms: number, now = Date.now()) {
  return new Date(now - ms);
}

/**
 * Ghi một dòng đếm vào audit_logs NGAY trong transaction đang giữ khoá.
 * Cố ý không đi qua writeAudit (hàm đó nuốt lỗi): dòng đếm mà ghi hỏng thì
 * giới hạn mất tác dụng, nên lỗi phải nổi lên và huỷ cả transaction.
 */
export async function recordAttempt(
  tx: Prisma.TransactionClient,
  row: {
    action: string;
    entityName: string;
    entityId: string;
    userId?: string | null;
    userEmail?: string | null;
    after?: unknown;
    ip?: string | null;
    userAgent?: string | null;
  }
) {
  return tx.auditLog.create({
    data: {
      userId: row.userId ?? null,
      userEmail: row.userEmail ?? null,
      action: row.action,
      entityName: row.entityName,
      entityId: row.entityId,
      afterPayload: row.after === undefined ? null : JSON.stringify(row.after),
      ipAddress: row.ip ?? null,
      userAgent: row.userAgent ?? null,
    },
  });
}
