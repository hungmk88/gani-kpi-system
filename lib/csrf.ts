/**
 * Chặn CSRF cho các route ghi dữ liệu (POST/PUT/PATCH/DELETE).
 *
 * Cookie phiên đã là SameSite=Lax, nhưng Lax vẫn cho qua request từ subdomain
 * "cùng site" và không che được mọi trình duyệt cũ — nên kiểm thêm Origin:
 * request ghi từ trình duyệt LUÔN mang Origin (hoặc ít nhất Sec-Fetch-Site),
 * và trang lạ không giả được hai header này.
 *
 * File thuần (không import Prisma/next/headers) để chạy được trong middleware
 * (Edge runtime) và test bằng vitest.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Endpoint cho MÁY gọi, tự xác thực bằng secret/HMAC trong header — không dùng
 * cookie nên không có gì để CSRF, và bên gọi (Telegram, iPOS, cron-job.org)
 * không gửi Origin của app.
 */
const EXEMPT_PATTERNS: RegExp[] = [
  /^\/api\/telegram\/webhook\/?$/,
  /^\/api\/integrations\/[^/]+\/webhook\/?$/,
  /^\/api\/cron(\/.*)?$/,
];

export function isCsrfExempt(pathname: string) {
  return EXEMPT_PATTERNS.some((re) => re.test(pathname));
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

export type CsrfInput = {
  method: string;
  pathname: string;
  /** Header Origin (có thể là chuỗi "null" khi trình duyệt giấu nguồn) */
  origin: string | null;
  /** Header Sec-Fetch-Site: same-origin | same-site | cross-site | none */
  secFetchSite: string | null;
  /** Các host hợp lệ của chính app: header Host, X-Forwarded-Host... */
  hosts: (string | null | undefined)[];
  /** APP_URL (domain chính thức) */
  appUrl?: string | null;
};

export type CsrfDecision = { allowed: true } | { allowed: false; reason: string };

export function csrfDecision(input: CsrfInput): CsrfDecision {
  const method = input.method.toUpperCase();
  if (SAFE_METHODS.has(method)) return { allowed: true };
  if (isCsrfExempt(input.pathname)) return { allowed: true };

  const allowedHosts = new Set<string>();
  for (const h of input.hosts) {
    if (h) allowedHosts.add(h.split(",")[0].trim().toLowerCase());
  }
  const appHost = hostOf(input.appUrl);
  if (appHost) allowedHosts.add(appHost);

  const origin = input.origin?.trim() || null;
  if (origin) {
    // "null" = trình duyệt cố ý giấu nguồn (iframe sandbox, redirect chéo) -> chặn
    const oHost = origin === "null" ? null : hostOf(origin);
    if (oHost && allowedHosts.has(oHost)) return { allowed: true };
    return { allowed: false, reason: `origin ${origin} không thuộc app` };
  }

  const site = input.secFetchSite?.trim().toLowerCase() || null;
  if (site) {
    // "none" = người dùng tự gõ/bookmark — không phải trang khác kích hoạt
    if (site === "same-origin" || site === "none") return { allowed: true };
    return { allowed: false, reason: `sec-fetch-site=${site}` };
  }

  // Không Origin, không Sec-Fetch-Site: không phải trình duyệt hiện đại (curl,
  // script smoke test, Node fetch). Không có cookie phiên của nạn nhân thì
  // không thành CSRF được — để route tự xác thực như thường.
  return { allowed: true };
}

export const CSRF_MESSAGE =
  "Yêu cầu bị từ chối: không xác định được nguồn gửi hợp lệ. Hãy tải lại trang và thử lại.";
