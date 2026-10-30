import { NextResponse, type NextRequest } from "next/server";
import { csrfDecision, CSRF_MESSAGE } from "./lib/csrf";

/**
 * Middleware chỉ làm MỘT việc: chặn CSRF cho các route /api ghi dữ liệu
 * (xem lib/csrf.ts). Xác thực/phân quyền vẫn nằm ở từng route (lib/api.ts) —
 * middleware chạy Edge, không đọc được DB.
 */
export function middleware(req: NextRequest) {
  const decision = csrfDecision({
    method: req.method,
    pathname: req.nextUrl.pathname,
    origin: req.headers.get("origin"),
    secFetchSite: req.headers.get("sec-fetch-site"),
    hosts: [req.headers.get("host"), req.headers.get("x-forwarded-host"), req.nextUrl.host],
    appUrl: process.env.APP_URL,
  });
  if (!decision.allowed) {
    console.warn(`[CSRF] chặn ${req.method} ${req.nextUrl.pathname}: ${decision.reason}`);
    return NextResponse.json(
      { statusCode: 403, errorCode: "CSRF_REJECTED", message: CSRF_MESSAGE },
      { status: 403 }
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
