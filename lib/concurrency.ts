/**
 * Chạy `fn` cho từng phần tử, tối đa `limit` việc cùng lúc. Lỗi của từng phần
 * tử KHÔNG làm hỏng cả lượt: ghi log rồi chạy tiếp, cuối cùng trả số việc lỗi.
 *
 * Dùng cho việc "phụ" chạy SAU khi dữ liệu đã ghi xong (gửi thông báo
 * Telegram / Zalo…): mở kỳ cho 50 người hay chốt KPI cả công ty mà gửi tuần
 * tự từng tin thì một Telegram chậm đủ làm request quá hạn — trong khi dữ
 * liệu đã khoá rồi, người dùng lại thấy "thất bại".
 */
export async function forEachLimit<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<unknown>,
  label = "forEachLimit"
): Promise<{ failed: number }> {
  let next = 0;
  let failed = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await fn(item);
      } catch (e) {
        failed++;
        console.error(`[${label}] Lỗi một phần tử (bỏ qua, chạy tiếp):`, e);
      }
    }
  };
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return { failed };
}
