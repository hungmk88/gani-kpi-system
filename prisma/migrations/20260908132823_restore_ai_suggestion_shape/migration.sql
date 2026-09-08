/*
  Warnings:

  - You are about to drop the column `actionTaken` on the `ai_suggestions` table. All the data in the column will be lost.
  - You are about to drop the column `context` on the `ai_suggestions` table. All the data in the column will be lost.
  - You are about to drop the column `deciderId` on the `ai_suggestions` table. All the data in the column will be lost.
  - You are about to drop the column `decision` on the `ai_suggestions` table. All the data in the column will be lost.
  - You are about to drop the column `requesterId` on the `ai_suggestions` table. All the data in the column will be lost.
  - You are about to drop the column `suggestion` on the `ai_suggestions` table. All the data in the column will be lost.
  - Added the required column `confidencePercent` to the `ai_suggestions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `engine` to the `ai_suggestions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `entityName` to the `ai_suggestions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `inputText` to the `ai_suggestions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `kind` to the `ai_suggestions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `modelName` to the `ai_suggestions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `payload` to the `ai_suggestions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `requestedById` to the `ai_suggestions` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ai_suggestions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "entityId" TEXT,
    "inputText" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "confidencePercent" REAL NOT NULL,
    "rationale" TEXT,
    "missingInfo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "latencyMs" INTEGER,
    "resultEntityId" TEXT,
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    CONSTRAINT "ai_suggestions_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ai_suggestions_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ai_suggestions" ("createdAt", "decidedAt", "id") SELECT "createdAt", "decidedAt", "id" FROM "ai_suggestions";
DROP TABLE "ai_suggestions";
ALTER TABLE "new_ai_suggestions" RENAME TO "ai_suggestions";
CREATE INDEX "ai_suggestions_requestedById_createdAt_idx" ON "ai_suggestions"("requestedById", "createdAt");
CREATE INDEX "ai_suggestions_kind_status_idx" ON "ai_suggestions"("kind", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
