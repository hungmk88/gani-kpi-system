/**
 * GỌI API TỪ TRÌNH DUYỆT — một chỗ duy nhất xử lý các kiểu hỏng "ngoài kịch bản".
 *
 * Trước đây mỗi nút tự `await fetch(...)` rồi `await res.json()`: mất mạng thì
 * promise reject, khối try/finally không có catch nên lỗi văng ra console và
 * người dùng chỉ thấy nút ngừng quay. Proxy/Vercel trả 413/504 bằng trang HTML
 * nên `res.json()` cũng nổ. Helper này không bao giờ throw: luôn trả
 * `{ ok, status, data, message }` với message tiếng Việt đọc được.
 *
 * File này chạy được ở client (không import gì của server).
 */

export type FetchJsonResult<T = Record<string, unknown>> = {
  ok: boolean;
  /** 0 = không tới được máy chủ (mất mạng, CORS, bị huỷ). */
  status: number;
  /** Body JSON đã parse; body rỗng / không phải JSON thì là {}. */
  data: T;
  /** Thông báo lỗi để hiện cho người dùng; null khi ok. */
  message: string | null;
};

export const NETWORK_ERROR_MESSAGE = "Mất kết nối tới máy chủ. Kiểm tra mạng rồi thử lại.";

/**
 * Thông báo mặc định theo mã HTTP khi body KHÔNG có `message` (thường là trang
 * lỗi HTML của proxy/nền tảng, không phải từ handle() của API).
 * Hàm thuần — có unit test.
 */
export function statusMessage(status: number): string {
  if (status === 0) return NETWORK_ERROR_MESSAGE;
  if (status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  if (status === 403) return "Bạn không có quyền thực hiện thao tác này.";
  if (status === 404) return "Không tìm thấy dữ liệu yêu cầu.";
  if (status === 413) return "File quá lớn, máy chủ không nhận. Hãy chia nhỏ file rồi thử lại.";
  if (status === 429) return "Bạn thao tác quá nhanh. Vui lòng đợi một lát rồi thử lại.";
  if (status === 502 || status === 504)
    return "Máy chủ xử lý quá lâu hoặc tạm thời không phản hồi. Vui lòng thử lại sau ít phút.";
  if (status === 503) return "Máy chủ đang bận hoặc bảo trì. Vui lòng thử lại sau.";
  if (status >= 500) return "Lỗi hệ thống. Vui lòng thử lại sau.";
  return `Yêu cầu không thành công (mã ${status}).`;
}

/** Parse body an toàn: rỗng hoặc HTML → {} chứ không throw. Hàm thuần. */
export function parseJsonBody(text: string): Record<string, unknown> {
  if (!text) return {};
  try {
    const v: unknown = JSON.parse(text);
    // API luôn trả object; mảng/giá trị thô vẫn giữ lại dưới khoá `value`.
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    return { value: v };
  } catch {
    return {};
  }
}

/**
 * Ghép kết quả từ status + body đã parse. Ưu tiên `message` của server (đã là
 * tiếng Việt, đúng nghiệp vụ); không có thì dùng thông báo theo mã HTTP.
 * Hàm thuần — có unit test.
 */
export function toResult<T>(status: number, data: Record<string, unknown>): FetchJsonResult<T> {
  const ok = status >= 200 && status < 300;
  const serverMsg = typeof data.message === "string" && data.message.trim() ? data.message : null;
  return {
    ok,
    status,
    data: data as T,
    message: ok ? null : (serverMsg ?? statusMessage(status)),
  };
}

export async function fetchJson<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit
): Promise<FetchJsonResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return toResult<T>(0, {});
  }
  let text = "";
  try {
    text = await res.text();
  } catch {
    // Kết nối đứt giữa chừng khi đang đọc body — coi như không có body.
  }
  return toResult<T>(res.status, parseJsonBody(text));
}

/** Tiện cho body JSON: tự đặt Content-Type và stringify. */
export function jsonInit(method: string, body?: unknown): RequestInit {
  return body === undefined
    ? { method }
    : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
