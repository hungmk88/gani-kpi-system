import { prisma } from "../db";
import { KPI_DEADLINE_DAYS } from "../constants";
import { vnDayRange, vnParts } from "../vn-time";

/**
 * CHỌN KỲ KPI THEO NGỮ CẢNH.
 *
 * Lịch chốt 2-4-5: KPI tháng M chốt vào ngày 2/4/5 của tháng M+1 (lib/kpi.ts
 * computeDeadlines). Nên trong mấy ngày đầu tháng, kỳ "mới nhất" (thường là kỳ
 * của tháng hiện tại, vừa mở) KHÔNG phải kỳ mà mọi người đang khai/duyệt/chốt.
 * Lấy `findFirst orderBy year/month desc` như trước là chọn nhầm kỳ đúng vào
 * mấy ngày quan trọng nhất của tháng.
 *
 * Mọi chỗ cần "kỳ đang chốt" / "kỳ tháng này" đi qua file này. Phần chọn kỳ là
 * hàm thuần (`pick*`) để test được không cần database.
 */

export type PeriodLike = { month: number; year: number; status: string };

/** Khoá so sánh tháng: tăng dần theo thời gian. */
export function monthKey(year: number, month: number) {
  return year * 12 + (month - 1);
}

function keyOf(p: { month: number; year: number }) {
  return monthKey(p.year, p.month);
}

function currentKey(now: Date) {
  const vn = vnParts(now);
  return monthKey(vn.year, vn.month);
}

/** Kỳ của đúng tháng hiện tại (lịch VN). */
export function pickCurrentMonthPeriod<T extends PeriodLike>(
  periods: T[],
  now: Date
): T | null {
  const cur = currentKey(now);
  return periods.find((p) => keyOf(p) === cur) ?? null;
}

/**
 * Lưới an toàn khi chưa có kỳ tháng này: kỳ gần nhất không nằm ở tương lai;
 * nếu chỉ có kỳ tương lai thì lấy kỳ sớm nhất trong số đó.
 */
function pickFallback<T extends PeriodLike>(periods: T[], now: Date): T | null {
  if (periods.length === 0) return null;
  const cur = currentKey(now);
  const past = periods
    .filter((p) => keyOf(p) <= cur)
    .sort((a, b) => keyOf(b) - keyOf(a));
  if (past.length > 0) return past[0];
  return [...periods].sort((a, b) => keyOf(a) - keyOf(b))[0];
}

/**
 * Kỳ ĐANG CHỐT: kỳ cũ nhất chưa FINALIZED thuộc tháng trước tháng hiện tại
 * (kỳ đang đi qua chặng 2-4-5, hoặc đang treo vì Ban Giám đốc chưa chốt).
 * Không có thì lấy kỳ tháng hiện tại, rồi tới lưới an toàn.
 */
export function pickClosingPeriod<T extends PeriodLike>(
  periods: T[],
  now: Date
): T | null {
  const cur = currentKey(now);
  const closing = periods
    .filter((p) => p.status !== "FINALIZED" && keyOf(p) < cur)
    .sort((a, b) => keyOf(a) - keyOf(b))[0];
  return (
    closing ?? pickCurrentMonthPeriod(periods, now) ?? pickFallback(periods, now)
  );
}

/**
 * Kỳ để HIỂN THỊ HẠN (bảng điều hành, /kpi trên bot): từ ngày 1 tới ngày Ban
 * Giám đốc chốt (ngày 5) là kỳ đang chốt; sau đó là kỳ tháng hiện tại — hạn
 * sắp tới gần nhất mà người dùng cần nhìn.
 */
export function pickDeadlinePeriod<T extends PeriodLike>(
  periods: T[],
  now: Date
): T | null {
  if (vnParts(now).day <= KPI_DEADLINE_DAYS.CEO_APPROVAL) {
    return pickClosingPeriod(periods, now);
  }
  return pickCurrentMonthPeriod(periods, now) ?? pickFallback(periods, now);
}

/* ------------------------------------------------------------ DATABASE */

/**
 * Nạp đủ ứng viên cho các hàm `pick*`: mọi kỳ chưa chốt (ít, thường 1-2 kỳ),
 * kỳ tháng hiện tại, và kỳ gần nhất không ở tương lai (lưới an toàn).
 */
async function loadCandidates(now: Date) {
  const vn = vnParts(now);
  const [open, latestPast] = await Promise.all([
    prisma.kpiPeriod.findMany({
      where: {
        OR: [
          { status: { not: "FINALIZED" } },
          { year: vn.year, month: vn.month },
        ],
      },
    }),
    prisma.kpiPeriod.findFirst({
      where: {
        OR: [{ year: { lt: vn.year } }, { year: vn.year, month: { lte: vn.month } }],
      },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    }),
  ]);
  const list = [...open];
  if (latestPast && !list.some((p) => p.id === latestPast.id)) list.push(latestPast);
  if (list.length === 0) {
    // Chỉ còn kỳ ở tương lai (hoặc chưa có kỳ nào)
    const earliest = await prisma.kpiPeriod.findFirst({
      orderBy: [{ year: "asc" }, { month: "asc" }],
    });
    if (earliest) list.push(earliest);
  }
  return list;
}

/** Kỳ đang chốt — xem `pickClosingPeriod`. */
export async function getClosingPeriod(now = new Date()) {
  return pickClosingPeriod(await loadCandidates(now), now);
}

/** Kỳ của tháng hiện tại (lịch VN), không có thì null. */
export async function getCurrentMonthPeriod(now = new Date()) {
  const vn = vnParts(now);
  return prisma.kpiPeriod.findUnique({
    where: { month_year: { month: vn.month, year: vn.year } },
  });
}

/** Kỳ để hiển thị hạn — xem `pickDeadlinePeriod`. */
export async function getDeadlinePeriod(now = new Date()) {
  return pickDeadlinePeriod(await loadCandidates(now), now);
}

/**
 * Kỳ có hạn Ban Giám đốc chốt rơi đúng hôm nay (ngày VN) — tức kỳ tháng trước
 * vào ngày 5. Không xét trạng thái: kỳ đã chốt sớm vẫn là kỳ của buổi giao ban.
 */
export async function getPeriodWithCeoDeadlineToday(now = new Date()) {
  return prisma.kpiPeriod.findFirst({
    where: { ceoApprovalDeadline: vnDayRange(now) },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });
}

/* ------------------------------------------------- GÁN CHỈ TIÊU KHI MỞ KỲ */

export type AssignUser = { id: string; role: string; departmentId: string | null };
export type AssignDef = {
  id: string;
  departmentId: string | null;
  appliesToRole: string | null;
  defaultWeight: number | null;
};
export type PrevRow = {
  employeeId: string;
  kpiDefinitionId: string | null;
  weightPercent: number | null;
  targetValue: number | null;
};

/**
 * Bộ dòng KPI một kỳ PHẢI có: mỗi nhân sự nhận KPI đang bật của phòng mình
 * (lọc thêm `appliesToRole` khi phòng tách bộ chỉ tiêu theo vai trò), trọng
 * số + mục tiêu lấy từ kỳ trước nếu có, không thì trọng số mặc định / mục
 * tiêu 0 cho quản lý điền. Bỏ những ô đã có (`existingKeys`, dạng
 * "employeeId|kpiDefinitionId") — để gán lại nhiều lần vẫn idempotent: lần
 * mở kỳ trước đứt giữa chừng thì lần sau chỉ điền phần còn thiếu. Thuần.
 */
export function planAssignments(input: {
  periodId: string;
  users: AssignUser[];
  defs: AssignDef[];
  prevRows: PrevRow[];
  existingKeys: Set<string>;
}) {
  const prev = new Map(
    input.prevRows.map((r) => [`${r.employeeId}|${r.kpiDefinitionId}`, r])
  );
  const rows: {
    periodId: string;
    employeeId: string;
    kpiDefinitionId: string;
    weightPercent: number | null;
    targetValue: number;
    status: "DRAFT";
  }[] = [];
  let total = 0;
  for (const u of input.users) {
    if (!u.departmentId) continue;
    for (const d of input.defs) {
      if (d.departmentId !== u.departmentId) continue;
      if (d.appliesToRole !== null && d.appliesToRole !== u.role) continue;
      total++;
      const key = `${u.id}|${d.id}`;
      if (input.existingKeys.has(key)) continue;
      const p = prev.get(key);
      rows.push({
        periodId: input.periodId,
        employeeId: u.id,
        kpiDefinitionId: d.id,
        weightPercent: p?.weightPercent ?? d.defaultWeight,
        targetValue: p?.targetValue ?? 0,
        status: "DRAFT",
      });
    }
  }
  /** total: số ô kỳ này phải có; rows: những ô còn thiếu cần tạo */
  return { total, rows };
}
