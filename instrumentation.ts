/**
 * Lưới an toàn múi giờ — KHÔNG phải nơi xử lý ngày giờ.
 *
 * Mọi phép tính và hiển thị ngày/giờ đều đi qua lib/vn-time.ts (cộng cố định
 * +7, không đọc múi giờ của máy), nên code KHÔNG được dựa vào file này: server
 * chạy UTC hay giờ VN đều phải ra cùng kết quả (CI chạy test ở cả hai — npm run
 * test:tz). Trên Vercel biến TZ còn là biến dành riêng, đặt ở dashboard không
 * có tác dụng; gán ở đây cũng không bảo đảm mọi runtime đều tôn trọng.
 *
 * File này chỉ còn để đỡ cho những chỗ lọt lưới lỡ gọi toLocaleString() /
 * getHours()... không kèm timeZone khi render phía server. Thấy chỗ như vậy thì
 * sửa sang lib/vn-time, đừng trông vào dòng dưới.
 */
export function register() {
  process.env.TZ = "Asia/Ho_Chi_Minh";
}
