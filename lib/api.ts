import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { BusinessError } from "./rbac";
import { getSession, loadActiveUser, type SessionUser } from "./auth";
import { ERR } from "./constants";

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(code: string, message: string, status = 400, extra?: object) {
  return NextResponse.json(
    { statusCode: status, errorCode: code, message, ...extra },
    { status }
  );
}

/**
 * Bọc mọi route handler: bắt lỗi nghiệp vụ và lỗi validate,
 * trả về đúng format { statusCode, errorCode, message } như bản thiết kế API.
 */
export async function handle<T>(fn: () => Promise<T>) {
  try {
    return (await fn()) as unknown as NextResponse;
  } catch (e) {
    if (e instanceof BusinessError) {
      return fail(e.code, e.message, e.statusCode);
    }
    if (e instanceof ZodError) {
      return fail(
        ERR.VALIDATION_FAILED,
        "Dữ liệu gửi lên không hợp lệ.",
        422,
        { issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }
      );
    }
    console.error("[API ERROR]", e);
    // Không trả nguyên văn lỗi nội bộ (Prisma, SQL...) ra ngoài — chi tiết
    // đã nằm trong log server.
    return fail("INTERNAL_ERROR", "Lỗi hệ thống. Vui lòng thử lại sau.", 500);
  }
}

/**
 * Lấy user đang đăng nhập, đối chiếu DB (còn hoạt động, quyền hiện tại,
 * token chưa bị thu hồi do đổi mật khẩu). Chưa đăng nhập thì 401; đang bị
 * buộc đổi mật khẩu thì 403 — trừ route đổi mật khẩu (allowMustChange).
 */
export async function requireUser(
  opts: { allowMustChange?: boolean } = {}
): Promise<SessionUser> {
  const active = await loadActiveUser(await getSession());
  if (!active) {
    throw new BusinessError(ERR.UNAUTHENTICATED, "Bạn chưa đăng nhập.", 401);
  }
  if (active.mustChangePassword && !opts.allowMustChange) {
    throw new BusinessError(
      "MUST_CHANGE_PASSWORD",
      "Bạn cần đổi mật khẩu trước khi tiếp tục.",
      403
    );
  }
  return active.user;
}
