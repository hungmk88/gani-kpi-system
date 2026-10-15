/**
 * ĐỊNH DẠNG HIỂN THỊ DÙNG CHUNG — một cách viết số, tiền, khối lượng, ngày
 * cho toàn hệ thống (trước đây mỗi màn một kiểu: "98.5", "98,50", "1.2M").
 *
 * Quy ước vi-VN: dấu chấm hàng nghìn, dấu phẩy thập phân. Ngày dd/mm/yyyy theo
 * giờ Việt Nam (đúng cả khi server chạy UTC). Giá trị rỗng / không phải số
 * hiện "—" thay vì "0" hay "NaN".
 */
import { formatVnDate, formatVnDateTime, vnDayDiff } from "./vn-time";

const DASH = "—";

function ok(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** Số thường, tối đa `digits` chữ số lẻ, bỏ số 0 thừa: 1.234,5 */
export function fmtNum(n: number | null | undefined, digits = 2) {
  if (!ok(n)) return DASH;
  return n.toLocaleString("vi-VN", { maximumFractionDigits: digits });
}

/** Điểm thang 100, luôn 2 chữ số lẻ: 98,50 */
export function fmtScore(n: number | null | undefined) {
  if (!ok(n)) return DASH;
  return n.toLocaleString("vi-VN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Phần trăm, tối đa 1 chữ số lẻ: 98,5% · `signed` thêm dấu +/− cho độ lệch */
export function fmtPct(
  n: number | null | undefined,
  opts: { digits?: number; signed?: boolean } = {}
) {
  if (!ok(n)) return DASH;
  const { digits = 1, signed = false } = opts;
  const body = Math.abs(n).toLocaleString("vi-VN", { maximumFractionDigits: digits });
  const sign = n < 0 ? "−" : signed && n > 0 ? "+" : "";
  return `${sign}${body}%`;
}

/**
 * Tiền VNĐ. Mặc định đầy đủ "1.250.000 ₫"; `compact` rút gọn cho thẻ số và
 * bảng hẹp: "1,25 tr ₫", "3,4 tỷ ₫", "850.000 ₫" (dưới 1 triệu giữ nguyên).
 */
export function fmtVnd(n: number | null | undefined, opts: { compact?: boolean } = {}) {
  if (!ok(n)) return DASH;
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (opts.compact) {
    if (a >= 1e9) return `${sign}${(a / 1e9).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} tỷ ₫`;
    if (a >= 1e6) return `${sign}${(a / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} tr ₫`;
  }
  return `${sign}${Math.round(a).toLocaleString("vi-VN")} ₫`;
}

/** Khối lượng: dưới 1 tấn ghi kg ("850,5 kg"), từ 1 tấn ghi tấn ("1,25 tấn") */
export function fmtKg(n: number | null | undefined, opts: { unit?: "auto" | "kg" } = {}) {
  if (!ok(n)) return DASH;
  if (opts.unit !== "kg" && Math.abs(n) >= 1000) {
    return `${(n / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} tấn`;
  }
  return `${n.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} kg`;
}

/** Ngày dd/mm/yyyy (giờ VN) */
export function fmtDate(d: Date | string | number | null | undefined) {
  return formatVnDate(d);
}

/** Ngày giờ dd/mm/yyyy · HH:mm (giờ VN) */
export function fmtDateTime(d: Date | string | number | null | undefined) {
  return formatVnDateTime(d);
}

/**
 * Hạn chót kèm thời gian còn lại, theo NGÀY LỊCH Việt Nam:
 * "hôm nay", "ngày mai", "còn 5 ngày", "trễ 3 ngày". `done` thì chỉ ghi ngày.
 * Trả về cả `late` để nơi gọi tô màu (đỏ chỉ khi đã trễ).
 */
export function fmtDeadline(
  d: Date | string | null | undefined,
  opts: { now?: Date; done?: boolean } = {}
): { date: string; relative: string | null; late: boolean } {
  if (!d) return { date: DASH, relative: null, late: false };
  const date = formatVnDate(d);
  if (opts.done) return { date, relative: null, late: false };
  const now = opts.now ?? new Date();
  const days = vnDayDiff(now, d);
  if (days < 0) return { date, relative: `trễ ${-days} ngày`, late: true };
  if (days === 0) {
    const late = new Date(d).getTime() < now.getTime();
    return { date, relative: late ? "trễ hôm nay" : "hôm nay", late };
  }
  if (days === 1) return { date, relative: "ngày mai", late: false };
  return { date, relative: `còn ${days} ngày`, late: false };
}
