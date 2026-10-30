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

const DEFAULT_SESSION_TTL_SECONDS = 12 * 60 * 60;
const TTL_UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/**
 * Thời hạn phiên (giây) — MỘT nguồn cho cả hạn JWT lẫn maxAge của cookie.
 * Trước đây JWT đọc JWT_EXPIRES_IN còn cookie cứng 12h: đặt "7d" thì token còn
 * sống mà cookie đã mất (đăng xuất "bí ẩn"), đặt "1h" thì cookie giữ token hết
 * hạn thêm 11 tiếng. Chỉ nhận dạng "<số><s|m|h|d>"; sai định dạng -> 12h.
 */
export function sessionTtlSeconds(raw: string | undefined = process.env.JWT_EXPIRES_IN): number {
  const m = /^\s*(\d+)\s*([smhd])?\s*$/i.exec(raw ?? "");
  if (!m) return DEFAULT_SESSION_TTL_SECONDS;
  const n = Number(m[1]) * TTL_UNITS[(m[2] ?? "s").toLowerCase()];
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SESSION_TTL_SECONDS;
}

/** Ký token và ghi vào cookie HttpOnly. */
export async function createSession(user: SessionUser) {
  const ttl = sessionTtlSeconds();
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
    .setExpirationTime(`${ttl}s`)
    .sign(secretKey());

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ttl,
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
 * Token có ký trước mốc `cutoff` không. iat làm tròn XUỐNG theo giây nên lùi
 * mốc 1 giây: token ký ở thời điểm t >= cutoff có iat*1000 > t - 1000 >=
 * cutoff - 1000, tức phiên cấp SAU mốc (đăng nhập lại sau khi đăng xuất, phiên
 * mới cấp ngay sau khi đổi mật khẩu) không bao giờ bị loại oan. Đổi lại, token
 * ký trong vòng 1 giây TRƯỚC mốc vẫn sống — chấp nhận được.
 */
export function issuedBefore(token: SessionToken, cutoff: Date | null | undefined) {
  if (!cutoff) return false;
  return token.issuedAt * 1000 < cutoff.getTime() - 1000;
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
  // Token ký TRƯỚC lần đổi/đặt lại mật khẩu gần nhất, hoặc trước lần đăng
  // xuất gần nhất (sessionsRevokedAt) -> hết hiệu lực.
  if (issuedBefore(token, fresh.passwordChangedAt)) return null;
  if (issuedBefore(token, fresh.sessionsRevokedAt)) return null;
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
