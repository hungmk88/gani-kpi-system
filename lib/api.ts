import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { BusinessError } from "./rbac";
import { getSession, type SessionUser } from "./auth";
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
    return fail(
      "INTERNAL_ERROR",
      e instanceof Error ? e.message : "Lỗi hệ thống không xác định.",
      500
    );
  }
}

/** Lấy user đang đăng nhập, chưa đăng nhập thì ném lỗi 401. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) {
    throw new BusinessError(ERR.UNAUTHENTICATED, "Bạn chưa đăng nhập.", 401);
  }
  return user;
}
