/**
 * MỌI phép tính ngày/giờ theo lịch Việt Nam đi qua file này.
 *
 * Nguyên tắc: KHÔNG dựa vào múi giờ của server (process.env.TZ, getMonth(),
 * setHours(), toLocaleString() không có timeZone...). Vercel chạy UTC, máy dev
 * chạy giờ VN — code dựa vào giờ server sẽ đúng ở máy này, sai ở máy kia.
 * Việt Nam không có giờ mùa hè nên độ lệch cố định +7.
 */

export const VN_TZ = "Asia/Ho_Chi_Minh";
const OFFSET_MS = 7 * 3600_000;
const DAY_MS = 86_400_000;

export type VnParts = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Chủ nhật
};

/** Tách một thời điểm thành ngày/giờ theo lịch Việt Nam. */
export function vnParts(d: Date | string | number = new Date()): VnParts {
  const v = new Date(new Date(d).getTime() + OFFSET_MS);
  return {
    year: v.getUTCFullYear(),
    month: v.getUTCMonth() + 1,
    day: v.getUTCDate(),
    hour: v.getUTCHours(),
    minute: v.getUTCMinutes(),
    second: v.getUTCSeconds(),
    weekday: v.getUTCDay(),
  };
}

/** Thời điểm (UTC) ứng với giờ Việt Nam đã cho. Tháng 1-12; tràn tháng/ngày tự cuộn như Date.UTC. */
export function vnDate(
  year: number,
  month: number,
  day = 1,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms) - OFFSET_MS);
}

/** 00:00 giờ VN của ngày chứa thời điểm d. */
export function vnStartOfDay(d: Date | string | number = new Date()): Date {
  const p = vnParts(d);
  return vnDate(p.year, p.month, p.day);
}

/** Cộng n ngày lịch (VN không có giờ mùa hè nên = n * 24h). */
export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

/** Khoảng [gte, lt) của một ngày VN — dùng thẳng trong where của Prisma. */
export function vnDayRange(d: Date | string | number = new Date()) {
  const gte = vnStartOfDay(d);
  return { gte, lt: addDays(gte, 1) };
}

/** Khoảng [gte, lt) của tháng VN. */
export function vnMonthRange(year: number, month: number) {
  return { gte: vnDate(year, month, 1), lt: vnDate(year, month + 1, 1) };
}

/** Khoảng [gte, lt) của năm VN. */
export function vnYearRange(year: number) {
  return { gte: vnDate(year, 1, 1), lt: vnDate(year + 1, 1, 1) };
}

/** Số ngày lịch VN giữa hai thời điểm (b - a), bỏ qua giờ trong ngày. */
export function vnDayDiff(a: Date | string | number, b: Date | string | number): number {
  return Math.round(
    (vnStartOfDay(b).getTime() - vnStartOfDay(a).getTime()) / DAY_MS
  );
}

/**
 * Đọc chuỗi ngày "YYYY-MM-DD" (input type=date) hoặc ISO đầy đủ thành
 * 00:00 giờ VN của ngày đó. ISO đầy đủ thì quy về ngày VN chứa thời điểm ấy.
 */
export function parseVnDate(input: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (m) return vnDate(Number(m[1]), Number(m[2]), Number(m[3]));
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) throw new Error(`Ngày không hợp lệ: ${input}`);
  return vnStartOfDay(d);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" theo lịch VN — dùng làm khoá ngày, value cho input type=date. */
export function vnDateKey(d: Date | string | number = new Date()): string {
  const p = vnParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "dd/mm/yyyy" theo giờ VN. */
export function formatVnDate(d: Date | string | number | null | undefined): string {
  if (d === null || d === undefined || d === "") return "—";
  const p = vnParts(d);
  return `${pad(p.day)}/${pad(p.month)}/${p.year}`;
}

/** "dd/mm/yyyy · HH:mm" theo giờ VN. */
export function formatVnDateTime(d: Date | string | number | null | undefined): string {
  if (d === null || d === undefined || d === "") return "—";
  const p = vnParts(d);
  return `${pad(p.day)}/${pad(p.month)}/${p.year} · ${pad(p.hour)}:${pad(p.minute)}`;
}

/** "HH:mm" theo giờ VN. */
export function formatVnTime(d: Date | string | number): string {
  const p = vnParts(d);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Nửa năm VN của một thời điểm: 1 (Th01–Th06) hoặc 2 (Th07–Th12). */
export function vnHalfOfYear(d: Date | string | number): 1 | 2 {
  return vnParts(d).month <= 6 ? 1 : 2;
}
