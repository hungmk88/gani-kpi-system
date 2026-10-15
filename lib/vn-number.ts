/**
 * Đọc / hiển thị số theo cách gõ của người Việt.
 *
 * Quy ước: dấu chấm "." là phân cách hàng nghìn, dấu phẩy "," là phần thập
 * phân — "135.000.000" = 135 triệu, "7,5" = 7.5. Vẫn nhận kiểu gõ máy tính
 * "1234.5" cho người quen bàn phím Excel tiếng Anh.
 *
 * Trường hợp nhập nhằng duy nhất là MỘT dấu chấm theo sau đúng 3 chữ số
 * ("1.500"): hiểu là hàng nghìn (1500) như người Việt vẫn viết. Muốn số lẻ
 * thì gõ dấu phẩy ("1,5").
 */

const GROUPED_INT = /^\d{1,3}(\.\d{3})+$/;

/** Bỏ dấu chấm hàng nghìn; trả null nếu nhóm số sai (vd "1.23.4"). */
function stripGroups(intPart: string): string | null {
  if (!intPart.includes(".")) return /^\d*$/.test(intPart) ? intPart : null;
  return GROUPED_INT.test(intPart) ? intPart.replace(/\./g, "") : null;
}

/**
 * Chuyển chuỗi người dùng gõ thành số. Trả null khi để trống hoặc không phải
 * số hợp lệ. Số âm vẫn đọc được (để nơi gọi tự báo lỗi "không được âm").
 */
export function parseVnNumber(input: string): number | null {
  const s = input.replace(/[\s ]/g, "");
  if (!s) return null;

  const negative = s.startsWith("-");
  const body = negative ? s.slice(1) : s;
  if (!body) return null;

  let intPart: string | null;
  let fracPart = "";

  if (body.includes(",")) {
    // Có dấu phẩy → dấu phẩy là phần thập phân, dấu chấm (nếu có) là hàng nghìn
    const parts = body.split(",");
    if (parts.length !== 2) return null;
    fracPart = parts[1];
    if (!/^\d+$/.test(fracPart)) return null;
    intPart = stripGroups(parts[0]);
  } else {
    const dots = body.split(".");
    if (dots.length === 1) {
      intPart = body;
    } else if (
      dots.length === 2 &&
      !(/^[1-9]\d{0,2}$/.test(dots[0]) && /^\d{3}$/.test(dots[1]))
    ) {
      // Một dấu chấm, không phải dạng "1.500" → hiểu là số thập phân "1234.5"
      intPart = dots[0];
      fracPart = dots[1];
      if (!/^\d+$/.test(fracPart)) return null;
    } else {
      intPart = stripGroups(body);
    }
  }

  if (intPart === null || !/^\d*$/.test(intPart)) return null;
  if (intPart === "" && fracPart === "") return null;

  const value = Number(`${intPart || "0"}.${fracPart || "0"}`);
  if (!Number.isFinite(value)) return null;
  if (value === 0) return 0; // tránh -0
  return negative ? -value : value;
}

const PLAIN = new Intl.NumberFormat("en-US", {
  useGrouping: false,
  maximumFractionDigits: 20,
});

/**
 * Hiển thị số theo kiểu Việt ("135.000.000", "7,5") và KHÔNG làm tròn —
 * parseVnNumber(formatVnNumber(n)) luôn trả lại đúng n.
 */
export function formatVnNumber(n: number): string {
  if (!Number.isFinite(n)) return "";
  const [intPart, fracPart] = PLAIN.format(Math.abs(n)).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const sign = n < 0 ? "-" : "";
  return fracPart ? `${sign}${grouped},${fracPart}` : `${sign}${grouped}`;
}
