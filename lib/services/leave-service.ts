import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ANNUAL_LEAVE_QUOTA_DAYS,
  ERR,
  HALF_YEAR_LEAVE_CAP_DAYS,
} from "@/lib/constants";
import { BusinessError } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { notify } from "@/lib/telegram";
import type { SessionUser } from "@/lib/auth";
import {
  addDays,
  formatVnDate,
  vnDayDiff,
  vnHalfOfYear,
  vnParts,
  vnStartOfDay,
  vnYearRange,
} from "@/lib/vn-time";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Số ngày của một đơn nghỉ phép — dùng thống nhất ở mọi chỗ tính ngày.
 * Đếm BAO GỒM cả ngày đầu lẫn ngày cuối theo lịch VN: nghỉ 16/10 → 16/10
 * là 1 ngày (trước đây đếm loại trừ nên ra 0). Ngày lịch, không trừ cuối tuần.
 */
export function leaveDaysBetween(start: Date, end: Date): number {
  return Math.max(0, vnDayDiff(start, end) + 1);
}

export type HalfKey = `${number}-H${1 | 2}`;

/**
 * Phân bổ từng ngày của đơn vào năm và nửa năm VN của CHÍNH ngày đó:
 * nghỉ 29/06 → 03/07 = 2 ngày nửa đầu + 3 ngày nửa cuối; vắt qua năm mới
 * cũng tách tương tự. Chỉ gọi với khoảng ngày đã giới hạn (≤ vài chục ngày).
 */
export function allocateLeaveDays(start: Date, end: Date) {
  const byYear = new Map<number, number>();
  const byHalf = new Map<HalfKey, number>();
  const n = leaveDaysBetween(start, end);
  const first = vnStartOfDay(start);
  for (let i = 0; i < n; i++) {
    const p = vnParts(addDays(first, i));
    const half: 1 | 2 = p.month <= 6 ? 1 : 2;
    byYear.set(p.year, (byYear.get(p.year) ?? 0) + 1);
    const key = `${p.year}-H${half}` as HalfKey;
    byHalf.set(key, (byHalf.get(key) ?? 0) + 1);
  }
  return { total: n, byYear, byHalf };
}

const HALF_LABEL: Record<1 | 2, string> = {
  1: "Nửa đầu năm (Th01–Th06)",
  2: "Nửa cuối năm (Th07–Th12)",
};

/** Đếm ngày phép đã DUYỆT của 1 người trong năm VN, tách theo từng nửa năm. */
async function approvedUsage(
  db: Db,
  userId: string,
  year: number,
  excludeId?: string
) {
  const range = vnYearRange(year);
  // Lấy mọi đơn CHẠM vào năm (kể cả đơn bắt đầu từ cuối năm trước).
  const approved = await db.leaveRequest.findMany({
    where: {
      employeeId: userId,
      status: "APPROVED",
      startDate: { lt: range.lt },
      endDate: { gte: range.gte },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { startDate: true, endDate: true },
  });
  let used = 0;
  const half = { 1: 0, 2: 0 } as Record<1 | 2, number>;
  for (const r of approved) {
    const a = allocateLeaveDays(r.startDate, r.endDate);
    used += a.byYear.get(year) ?? 0;
    half[1] += a.byHalf.get(`${year}-H1`) ?? 0;
    half[2] += a.byHalf.get(`${year}-H2`) ?? 0;
  }
  return { used, half };
}

/**
 * Hạn mức phép năm — 12 ngày/người/năm, cố định trong code, áp dụng chung
 * cho mọi người dùng trang Nghỉ phép (chưa phân biệt thâm niên/loại hợp
 * đồng — làm sau nếu cần). "Đã dùng" chỉ tính đơn đã DUYỆT (APPROVED);
 * đơn đang chờ/bị từ chối không trừ.
 *
 * Trần nửa năm — chốt 15/09/2026: tối đa 6 ngày mỗi nửa (Th01-Th06 /
 * Th07-Th12). Mỗi NGÀY nghỉ được tính vào năm/nửa năm VN của chính ngày đó
 * (xem allocateLeaveDays). "Nửa hiện tại" hiển thị là nửa năm VN của hôm
 * nay; xem năm đã qua thì hiển thị nửa cuối, năm tới thì nửa đầu.
 */
export async function getAnnualLeaveQuota(userId: string, year: number) {
  const { used, half } = await approvedUsage(prisma, userId, year);

  const now = vnParts(new Date());
  const currentHalf: 1 | 2 =
    year === now.year ? vnHalfOfYear(new Date()) : year < now.year ? 2 : 1;
  const halfUsed = half[currentHalf];

  return {
    year,
    total: ANNUAL_LEAVE_QUOTA_DAYS,
    used,
    remaining: Math.max(0, ANNUAL_LEAVE_QUOTA_DAYS - used),
    half: {
      label: HALF_LABEL[currentHalf],
      cap: HALF_YEAR_LEAVE_CAP_DAYS,
      used: halfUsed,
      remaining: Math.max(0, HALF_YEAR_LEAVE_CAP_DAYS - halfUsed),
    },
  };
}

/**
 * Khoá theo người xin nghỉ trong phạm vi transaction (advisory lock của
 * Postgres) — hai lần duyệt/gửi song song của CÙNG một người phải chạy nối
 * tiếp, nếu không cả hai cùng đọc "còn 6 ngày" rồi cùng lọt.
 */
export async function lockLeaveOwner(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`leave:${userId}`}::text))`;
}

/**
 * Chặn nếu (đơn đã DUYỆT + đơn này) vượt 12 ngày/năm hoặc 6 ngày/nửa năm.
 * Gọi bên trong transaction, sau lockLeaveOwner. excludeId: id của chính đơn
 * đang duyệt (phòng khi đơn đã ở trạng thái APPROVED vì lý do nào đó).
 */
export async function assertLeaveQuota(
  tx: Prisma.TransactionClient,
  userId: string,
  start: Date,
  end: Date,
  excludeId?: string
) {
  const days = leaveDaysBetween(start, end);
  // Một đơn tối đa 12 ngày (6 ngày nửa cuối năm này + 6 ngày nửa đầu năm sau)
  // — kiểm tra sớm để khỏi duyệt từng ngày của một khoảng vô lý.
  if (days > ANNUAL_LEAVE_QUOTA_DAYS) {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      `Đơn nghỉ ${days} ngày vượt hạn mức phép năm (${ANNUAL_LEAVE_QUOTA_DAYS} ngày/năm, tối đa ${HALF_YEAR_LEAVE_CAP_DAYS} ngày mỗi nửa năm).`,
      400
    );
  }
  const alloc = allocateLeaveDays(start, end);
  for (const [year, add] of alloc.byYear) {
    const { used, half } = await approvedUsage(tx, userId, year, excludeId);
    if (used + add > ANNUAL_LEAVE_QUOTA_DAYS) {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        `Vượt hạn mức phép năm ${year}: đã duyệt ${used} ngày, đơn này thêm ${add} ngày — tối đa ${ANNUAL_LEAVE_QUOTA_DAYS} ngày/năm.`,
        400
      );
    }
    for (const h of [1, 2] as const) {
      const addHalf = alloc.byHalf.get(`${year}-H${h}`) ?? 0;
      if (addHalf > 0 && half[h] + addHalf > HALF_YEAR_LEAVE_CAP_DAYS) {
        throw new BusinessError(
          ERR.VALIDATION_FAILED,
          `Vượt trần ${HALF_LABEL[h].toLowerCase()} ${year}: đã duyệt ${half[h]} ngày, đơn này thêm ${addHalf} ngày — tối đa ${HALF_YEAR_LEAVE_CAP_DAYS} ngày mỗi nửa năm.`,
          400
        );
      }
    }
  }
}

/* ------------------------------------------------------ TRÙNG LỊCH NGHỈ */

/**
 * Hai khoảng ngày nghỉ (tính trọn ngày lịch VN, gồm cả ngày đầu và cuối) có
 * chạm nhau không. Hàm thuần — dùng cho kiểm tra trùng đơn.
 */
export function leaveRangesOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): boolean {
  const a0 = vnStartOfDay(aStart).getTime();
  const a1 = vnStartOfDay(aEnd).getTime();
  const b0 = vnStartOfDay(bStart).getTime();
  const b1 = vnStartOfDay(bEnd).getTime();
  return a0 <= b1 && b0 <= a1;
}

/**
 * Chặn đơn trùng ngày với đơn khác CỦA CÙNG NGƯỜI (theo ngày lịch VN).
 * - Gửi đơn mới: so với đơn đang chờ và đã duyệt.
 * - Duyệt đơn: chỉ so với đơn ĐÃ DUYỆT (hai đơn chờ trùng nhau từ dữ liệu cũ
 *   thì duyệt được một, đơn kia sẽ bị chặn khi duyệt).
 * Gọi trong transaction, sau lockLeaveOwner.
 */
export async function assertNoLeaveOverlap(
  db: Db,
  userId: string,
  start: Date,
  end: Date,
  opts: { statuses?: ("PENDING" | "APPROVED")[]; excludeId?: string } = {}
) {
  const statuses = opts.statuses ?? ["PENDING", "APPROVED"];
  const from = vnStartOfDay(start);
  const toExclusive = addDays(vnStartOfDay(end), 1);
  const clash = await db.leaveRequest.findFirst({
    where: {
      employeeId: userId,
      status: { in: statuses },
      startDate: { lt: toExclusive },
      endDate: { gte: from },
      ...(opts.excludeId ? { id: { not: opts.excludeId } } : {}),
    },
    select: { startDate: true, endDate: true, status: true },
    orderBy: { startDate: "asc" },
  });
  if (clash) {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      `Trùng ngày với đơn nghỉ ${clash.status === "APPROVED" ? "đã duyệt" : "đang chờ duyệt"} từ ${formatVnDate(clash.startDate)} đến ${formatVnDate(clash.endDate)}. Huỷ hoặc sửa đơn kia trước.`,
      409
    );
  }
}

/* -------------------------------------------------- QUYỀN DUYỆT / HUỶ ĐƠN */

type LeaveActor = { id: string; role: string; departmentId: string | null };
type LeaveTarget = {
  employeeId: string;
  departmentId: string | null;
  employee: { role: string };
};

/**
 * Ai được duyệt / từ chối / huỷ hộ một đơn:
 * - Trưởng phòng xin nghỉ, hoặc Admin xin nghỉ -> chỉ Ban Giám đốc.
 * - Nhân viên thường -> Ban Giám đốc hoặc đúng Trưởng phòng của phòng đó.
 * Không ai tự duyệt đơn của mình.
 */
export function canReviewLeave(actor: LeaveActor, r: LeaveTarget): boolean {
  if (actor.id === r.employeeId) return false;
  const requesterNeedsCeo = r.employee.role === "MANAGER" || r.employee.role === "ADMIN";
  const isDeptManager =
    actor.role === "MANAGER" && actor.departmentId === r.departmentId;
  return actor.role === "CEO" || (!requesterNeedsCeo && isDeptManager);
}

/**
 * Đơn có huỷ được không (chưa xét quyền):
 * - Đang chờ: huỷ được.
 * - Đã duyệt: chỉ huỷ được TRƯỚC 00:00 (giờ VN) của ngày bắt đầu nghỉ — đã
 *   vào ngày nghỉ rồi thì ngày đó coi như đã dùng.
 */
export function isLeaveCancellable(
  r: { status: string; startDate: Date },
  now: Date = new Date()
): boolean {
  if (r.status === "PENDING") return true;
  if (r.status === "APPROVED") return now.getTime() < vnStartOfDay(r.startDate).getTime();
  return false;
}

/** Người này có được huỷ đơn này không (gồm cả quyền và thời điểm). */
export function canCancelLeave(
  actor: LeaveActor,
  r: LeaveTarget & { status: string; startDate: Date },
  now: Date = new Date()
): boolean {
  if (!isLeaveCancellable(r, now)) return false;
  if (actor.id === r.employeeId) return true;
  // Đơn đang chờ chỉ người gửi tự rút; người duyệt thì dùng "Từ chối".
  return r.status === "APPROVED" && canReviewLeave(actor, r);
}

/**
 * Huỷ đơn nghỉ: người gửi tự rút đơn đang chờ, hoặc huỷ đơn ĐÃ DUYỆT trước
 * ngày bắt đầu nghỉ (người gửi, Trưởng phòng / Ban Giám đốc có quyền duyệt).
 * Huỷ đơn đã duyệt thì ngày phép tự được trả lại (hạn mức chỉ đếm đơn APPROVED).
 *
 * Ghi có điều kiện (status + startDate) để không huỷ nhầm đơn vừa đổi trạng
 * thái hoặc vừa bước sang ngày nghỉ giữa lúc đọc và lúc ghi.
 */
export async function cancelLeaveRequest(
  actor: SessionUser,
  id: string,
  note: string | undefined,
  meta: { ip?: string | null; userAgent?: string | null } = {}
) {
  const r = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { employee: { select: { id: true, role: true, fullName: true } } },
  });
  if (!r) {
    throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy đơn nghỉ phép.", 404);
  }
  const now = new Date();
  const isOwner = r.employeeId === actor.id;

  if (r.status !== "PENDING" && r.status !== "APPROVED") {
    throw new BusinessError(ERR.VALIDATION_FAILED, "Đơn đã được xử lý.", 409);
  }
  if (!isLeaveCancellable(r, now)) {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      `Đơn đã duyệt chỉ huỷ được trước ngày bắt đầu nghỉ (${formatVnDate(r.startDate)}).`,
      409
    );
  }
  if (!canCancelLeave(actor, r, now)) {
    throw new BusinessError(
      ERR.FORBIDDEN,
      r.status === "PENDING"
        ? "Chỉ người gửi mới huỷ được đơn đang chờ của chính mình."
        : "Chỉ người gửi, Trưởng phòng của người gửi hoặc Ban Giám đốc mới huỷ được đơn đã duyệt.",
      403
    );
  }
  // Huỷ hộ đơn đã duyệt của người khác thì phải nói vì sao
  if (!isOwner && !note?.trim()) {
    throw new BusinessError(
      ERR.REASON_REQUIRED,
      "Huỷ đơn nghỉ đã duyệt của người khác bắt buộc ghi lý do.",
      400
    );
  }

  const res = await prisma.leaveRequest.updateMany({
    where:
      r.status === "PENDING"
        ? { id, status: "PENDING", employeeId: actor.id }
        : { id, status: "APPROVED", startDate: { gt: now } },
    data: { status: "CANCELLED", resolvedAt: now },
  });
  if (res.count !== 1) {
    throw new BusinessError(ERR.VALIDATION_FAILED, "Đơn đã được xử lý.", 409);
  }

  await writeAudit({
    actor,
    action: "LEAVE_REQUEST_CANCEL",
    entityName: "leave_requests",
    entityId: id,
    before: { status: r.status },
    after: { status: "CANCELLED", huyHo: !isOwner },
    reason: note?.trim() || null,
    ...meta,
  });

  if (r.status === "APPROVED") {
    const range = `${formatVnDate(r.startDate)} đến ${formatVnDate(r.endDate)}`;
    const recipients = new Set<string>();
    if (r.reviewedById && r.reviewedById !== actor.id) recipients.add(r.reviewedById);
    for (const uid of recipients) {
      await notify({
        userId: uid,
        title: `Đơn nghỉ đã duyệt bị huỷ: ${r.employee.fullName}`,
        body: `${actor.fullName} đã huỷ đơn nghỉ từ ${range}.${note?.trim() ? ` Lý do: ${note.trim()}` : ""}`,
        level: "INFO",
        linkUrl: "/leave-requests",
      });
    }
    if (!isOwner) {
      await notify({
        userId: r.employeeId,
        title: "Đơn nghỉ phép đã duyệt của bạn bị huỷ",
        body: `${actor.fullName} đã huỷ đơn nghỉ từ ${range}. Lý do: ${note?.trim()}`,
        level: "WARNING",
        linkUrl: "/leave-requests",
      });
    }
  }

  return { status: "CANCELLED" as const };
}

/**
 * Trưởng phòng, Ban Giám đốc và phòng Kế toán mới được tải file tổng hợp
 * nghỉ phép — theo yêu cầu 14/09/2026. Dùng chung cho cả route xuất Excel và
 * trang /leave-requests (ẩn/hiện nút tải). Phạm vi dữ liệu: xem
 * leaveReportScope — Trưởng phòng chỉ thấy phòng mình.
 */
export async function canExportLeaveReport(user: {
  role: string;
  departmentId: string | null;
}): Promise<boolean> {
  return (await leaveReportScope(user)) !== null;
}

/**
 * Phạm vi file tổng hợp nghỉ phép:
 * - "ALL": Ban Giám đốc và phòng Kế toán — toàn công ty.
 * - { departmentId }: Trưởng phòng — chỉ phòng mình (lý do nghỉ là thông tin
 *   riêng tư, không để trưởng phòng này đọc lý do nghỉ của phòng khác).
 * - null: không được tải.
 */
export async function leaveReportScope(user: {
  role: string;
  departmentId: string | null;
}): Promise<"ALL" | { departmentId: string } | null> {
  if (user.role === "CEO") return "ALL";
  if (user.departmentId) {
    const dept = await prisma.department.findUnique({
      where: { id: user.departmentId },
      select: { code: true },
    });
    if (dept?.code === "ACC") return "ALL";
    if (user.role === "MANAGER") return { departmentId: user.departmentId };
  }
  return null;
}
