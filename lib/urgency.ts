import { vnDate, vnDayDiff, vnParts } from "./vn-time";

const HOUR_MS = 3_600_000;

/** Cửa khoá cứng chỉ được chen lên đầu hàng chờ khi còn dưới mốc này. */
export const LOCK_JUMP_MS = 72 * HOUR_MS;

/**
 * Tông màu theo thời gian CÒN LẠI tới hạn: đỏ dưới 24 giờ, vàng dưới 72 giờ,
 * còn lại trung tính. Hạn còn 18 ngày mà tô đỏ là báo động giả — quản trị
 * ngoại lệ: chưa tới lúc thì im lặng.
 */
export function urgencyTone(
  deadline: Date,
  now: Date
): "red" | "amber" | "brand" {
  const left = new Date(deadline).getTime() - now.getTime();
  if (left < 24 * HOUR_MS) return "red";
  if (left < LOCK_JUMP_MS) return "amber";
  return "brand";
}

/**
 * Việc trễ bao nhiêu NGÀY LỊCH (giờ Việt Nam): 0 là trễ trong hôm nay, âm là
 * chưa tới hạn. Cùng cách đếm với fmtDeadline ("trễ 3 ngày") để con số trong
 * nhóm và nhãn trên từng dòng không vênh nhau.
 */
export function daysLate(deadline: Date | string, now: Date): number {
  // `0 - x` chứ không `-x`: tránh -0 (hiện ra "trễ -0 ngày", so sánh lệch)
  return 0 - vnDayDiff(now, deadline);
}

export type LateBucket = {
  key: "week" | "several" | "recent" | "today";
  label: string;
};

/**
 * Nhóm việc quá hạn theo độ trễ, trễ lâu nhất trước. Trễ hơn một tuần là việc
 * đã bị bỏ quên — khác hẳn việc vừa lỡ hạn hôm qua, không nên trộn chung.
 */
export const LATE_BUCKETS: LateBucket[] = [
  { key: "week", label: "Trễ hơn 1 tuần" },
  { key: "several", label: "Trễ 3–7 ngày" },
  { key: "recent", label: "Trễ 1–2 ngày" },
  { key: "today", label: "Lỡ hạn hôm nay" },
];

export function lateBucketOf(days: number): LateBucket {
  if (days > 7) return LATE_BUCKETS[0];
  if (days >= 3) return LATE_BUCKETS[1];
  if (days >= 1) return LATE_BUCKETS[2];
  return LATE_BUCKETS[3];
}

/**
 * Khoảng hạn chót (giờ VN) ứng với từng nhóm trễ, để đếm/lấy từng nhóm bằng
 * truy vấn riêng — đếm trên một danh sách đã cắt bớt là ra số sai.
 * `gte` không có nghĩa là không chặn dưới; `lt` luôn có.
 */
export function lateBucketRanges(now: Date) {
  const { year, month, day } = vnParts(now);
  const daysAgo = (n: number) => vnDate(year, month, day - n);
  return [
    { ...LATE_BUCKETS[0], gte: null, lt: daysAgo(7) },
    { ...LATE_BUCKETS[1], gte: daysAgo(7), lt: daysAgo(2) },
    { ...LATE_BUCKETS[2], gte: daysAgo(2), lt: daysAgo(0) },
    { ...LATE_BUCKETS[3], gte: daysAgo(0), lt: now },
  ] as (LateBucket & { gte: Date | null; lt: Date })[];
}

/**
 * Hạng hiển thị của một việc trong ô ngày trên Lịch (số nhỏ đứng trên):
 *   0 — đã trễ (chưa xong mà quá hạn)
 *   1 — gấp: ưu tiên Khẩn cấp / Cao
 *   2 — đang mở bình thường
 *   3 — đã xong
 * Ô ngày chỉ hiện vài dòng đầu — ngoại lệ phải nằm trong số đó, không được
 * chìm vào "+N việc nữa".
 */
export function calendarRank(
  t: { status: string; priority: string; dueDate: Date | string },
  now: Date
): 0 | 1 | 2 | 3 {
  if (t.status === "DONE") return 3;
  if (new Date(t.dueDate).getTime() < now.getTime()) return 0;
  if (t.priority === "CRITICAL" || t.priority === "HIGH") return 1;
  return 2;
}

/** Sắp xếp theo calendarRank; cùng hạng thì Khẩn cấp trước Cao, rồi hạn sớm. */
export function sortForCalendar<
  T extends { status: string; priority: string; dueDate: Date | string },
>(list: T[], now: Date): T[] {
  const prio = (p: string) => (p === "CRITICAL" ? 0 : p === "HIGH" ? 1 : 2);
  return [...list].sort(
    (a, b) =>
      calendarRank(a, now) - calendarRank(b, now) ||
      prio(a.priority) - prio(b.priority) ||
      new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
  );
}
