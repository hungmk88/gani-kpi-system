import { PrismaClient } from "@prisma/client";

/**
 * Một instance Prisma duy nhất cho toàn app.
 * Next.js dev mode hot-reload liên tục, nếu không cache lại sẽ mở hàng chục
 * connection tới SQLite và làm khoá file DB.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
