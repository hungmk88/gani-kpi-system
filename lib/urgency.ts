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
