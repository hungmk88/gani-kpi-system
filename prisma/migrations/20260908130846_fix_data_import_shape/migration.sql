/*
  Warnings:

  - You are about to drop the column `completedAt` on the `data_imports` table. All the data in the column will be lost.
  - You are about to drop the column `errorMsg` on the `data_imports` table. All the data in the column will be lost.
  - You are about to drop the column `rowCount` on the `data_imports` table. All the data in the column will be lost.
  - You are about to drop the column `sourceType` on the `data_imports` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `data_imports` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `data_imports` table. All the data in the column will be lost.
  - Added the required column `source` to the `data_imports` table without a default value. This is not possible if the table is not empty.
  - Added the required column `uploadedById` to the `data_imports` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_data_imports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileName" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "rowsTotal" INTEGER NOT NULL DEFAULT 0,
    "rowsOk" INTEGER NOT NULL DEFAULT 0,
    "rowsError" INTEGER NOT NULL DEFAULT 0,
    "errorLog" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "data_imports_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_data_imports" ("createdAt", "fileName", "id") SELECT "createdAt", "fileName", "id" FROM "data_imports";
DROP TABLE "data_imports";
ALTER TABLE "new_data_imports" RENAME TO "data_imports";
CREATE INDEX "data_imports_source_idx" ON "data_imports"("source");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
