// Ngày giờ theo lịch Việt Nam cho script seed (bản .mjs của lib/vn-time.ts) —
// seed chạy trên máy nào cũng ra cùng một kết quả, không phụ thuộc múi giờ máy.
const OFFSET = 7 * 3600_000;

/** Thời điểm ứng với giờ VN đã cho (tháng 1-12, tràn tự cuộn). */
export const vnDate = (y, m, d = 1, h = 0, mi = 0, s = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, mi, s) - OFFSET);

/** Năm/tháng/ngày VN của thời điểm. */
export function vnParts(t = new Date()) {
  const v = new Date(t.getTime() + OFFSET);
  return { year: v.getUTCFullYear(), month: v.getUTCMonth() + 1, day: v.getUTCDate() };
}

/** Hôm nay (VN) + offsetDays, lúc `hour` giờ VN. */
export function vnAt(offsetDays, hour = 0) {
  const p = vnParts();
  return vnDate(p.year, p.month, p.day + offsetDays, hour);
}
