import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { strongSecret } from "./secrets";
import type { Role } from "./constants";

export const SESSION_COOKIE = "gani_kpi_session";

function secretKey() {
  const s = strongSecret("JWT_SECRET", 32);
  if (!s) {
    throw new Error(
      "JWT_SECRET thiếu, ngắn hơn 32 ký tự hoặc còn là chuỗi mẫu. Tạo bằng: openssl rand -hex 48"
    );
  }
  return new TextEncoder().encode(s);
}

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  departmentId: string | null;
  departmentName: string | null;
};

/** Phiên đọc từ cookie: thông tin trong token + thời điểm ký (giây). */
export type SessionToken = SessionUser & { issuedAt: number };

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

/** Ký token và ghi vào cookie HttpOnly. */
export async function createSession(user: SessionUser) {
  const expiresIn = process.env.JWT_EXPIRES_IN || "12h";
  const token = await new SignJWT({
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    departmentId: user.departmentId,
    departmentName: user.departmentName,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey());

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return token;
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/** Giải mã token trong cookie. Trả null nếu chưa đăng nhập / token hỏng. */
export async function getSession(): Promise<SessionToken | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}

export async function verifySessionToken(
  token: string | undefined
): Promise<SessionToken | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ["HS256"],
    });
    return {
      issuedAt: typeof payload.iat === "number" ? payload.iat : 0,
      id: String(payload.sub),
      email: String(payload.email),
      fullName: String(payload.fullName),
      role: payload.role as Role,
      departmentId: (payload.departmentId as string | null) ?? null,
      departmentName: (payload.departmentName as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Đối chiếu phiên với database. Token chỉ chứng minh "đã từng đăng nhập" —
 * quyền, phòng ban, trạng thái khoá phải lấy từ DB ở MỌI lượt gọi, nếu không
 * người bị khoá/hạ quyền/đổi mật khẩu vẫn dùng token cũ thêm 12 tiếng.
 */
export async function loadActiveUser(
  token: SessionToken | null
): Promise<{ user: SessionUser; mustChangePassword: boolean } | null> {
  if (!token) return null;
  const fresh = await prisma.user.findUnique({
    where: { id: token.id },
    include: { department: true },
  });
  if (!fresh || !fresh.isActive) return null;
  // Token ký TRƯỚC lần đổi/đặt lại mật khẩu gần nhất -> hết hiệu lực.
  // Lùi 1 giây vì iat làm tròn xuống theo giây.
  if (
    fresh.passwordChangedAt &&
    token.issuedAt * 1000 < fresh.passwordChangedAt.getTime() - 1000
  ) {
    return null;
  }
  return {
    user: {
      id: fresh.id,
      email: fresh.email,
      fullName: fresh.fullName,
      role: fresh.role as Role,
      departmentId: fresh.departmentId,
      departmentName: fresh.department?.name ?? null,
    },
    mustChangePassword: fresh.mustChangePassword,
  };
}

/**
 * Dùng trong Server Component: trả user còn hiệu lực, null nếu chưa đăng nhập
 * (trang tự redirect về /login). Người đang bị buộc đổi mật khẩu bị đẩy sang
 * /doi-mat-khau, trừ chính trang đó (allowMustChange).
 */
export async function requireSession(
  opts: { allowMustChange?: boolean } = {}
): Promise<SessionUser | null> {
  const active = await loadActiveUser(await getSession());
  if (!active) return null;
  if (active.mustChangePassword && !opts.allowMustChange) {
    redirect("/doi-mat-khau");
  }
  return active.user;
}
