/*
  Warnings:

  - You are about to drop the column `linkedAt` on the `telegram_links` table. All the data in the column will be lost.
  - You are about to drop the column `telegramUserId` on the `telegram_links` table. All the data in the column will be lost.
  - You are about to drop the column `telegramUsername` on the `telegram_links` table. All the data in the column will be lost.
  - Added the required column `code` to the `telegram_links` table without a default value. This is not possible if the table is not empty.
  - Added the required column `expiresAt` to the `telegram_links` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_telegram_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_telegram_links" ("id", "userId") SELECT "id", "userId" FROM "telegram_links";
DROP TABLE "telegram_links";
ALTER TABLE "new_telegram_links" RENAME TO "telegram_links";
CREATE UNIQUE INDEX "telegram_links_code_key" ON "telegram_links"("code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
