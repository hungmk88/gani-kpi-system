import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import type { Role } from "./constants";

export const SESSION_COOKIE = "gani_kpi_session";

function secretKey() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "Thiếu JWT_SECRET trong file .env (hoặc chuỗi quá ngắn). Xem .env.example."
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
export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}

export async function verifySessionToken(
  token: string | undefined
): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return {
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
 * Dùng trong Server Component: lấy user, nếu chưa đăng nhập thì ném lỗi
 * (layout sẽ redirect). Đồng thời kiểm tra tài khoản còn active không.
 */
export async function requireSession(): Promise<SessionUser | null> {
  const session = await getSession();
  if (!session) return null;
  const fresh = await prisma.user.findUnique({
    where: { id: session.id },
    include: { department: true },
  });
  if (!fresh || !fresh.isActive) return null;
  return {
    id: fresh.id,
    email: fresh.email,
    fullName: fresh.fullName,
    role: fresh.role as Role,
    departmentId: fresh.departmentId,
    departmentName: fresh.department?.name ?? null,
  };
}
