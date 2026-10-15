import { PrismaClient } from "@prisma/client";

/**
 * Một instance Prisma duy nhất cho toàn app.
 * Next.js dev mode hot-reload liên tục, nếu không cache lại sẽ mở hàng chục
 * connection tới database.
 *
 * `omit` toàn cục: KHÔNG BAO GIỜ trả passwordHash ra ngoài, kể cả khi một
 * route lỡ `include: { assignee: true }`. Chỗ nào thật sự cần hash (đăng nhập,
 * đổi mật khẩu) phải tự mở lại bằng `omit: { passwordHash: false }`.
 */
function createClient() {
  return new PrismaClient({
    omit: { user: { passwordHash: true } },
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}
const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createClient> | undefined;
};

export const prisma =
  globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
