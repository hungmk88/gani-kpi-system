/**
 * Chỉ nhận link http(s) — chặn javascript:, data:... bị nhúng vào trang.
 * Dùng chung cho link bằng chứng (bình luận công việc, KPI) ở cả API lẫn form.
 */
export function isHttpUrl(v: string) {
  try {
    return ["https:", "http:"].includes(new URL(v).protocol);
  } catch {
    return false;
  }
}
