/*
  Warnings:

  - You are about to drop the column `comment` on the `kpi_reviews` table. All the data in the column will be lost.
  - You are about to drop the column `rating` on the `kpi_reviews` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `reconciliations` table. All the data in the column will be lost.
  - You are about to drop the column `discrepancyType` on the `reconciliations` table. All the data in the column will be lost.
  - You are about to drop the column `reportedEmployeeId` on the `reconciliations` table. All the data in the column will be lost.
  - You are about to drop the column `resolution` on the `reconciliations` table. All the data in the column will be lost.
  - You are about to drop the column `severity` on the `reconciliations` table. All the data in the column will be lost.
  - Added the required column `action` to the `kpi_reviews` table without a default value. This is not possible if the table is not empty.
  - Added the required column `stage` to the `kpi_reviews` table without a default value. This is not possible if the table is not empty.
  - Added the required column `employeeId` to the `reconciliations` table without a default value. This is not possible if the table is not empty.
  - Added the required column `kpiDefinitionId` to the `reconciliations` table without a default value. This is not possible if the table is not empty.
  - Added the required column `maxValue` to the `reconciliations` table without a default value. This is not possible if the table is not empty.
  - Added the required column `minValue` to the `reconciliations` table without a default value. This is not possible if the table is not empty.
  - Added the required column `periodId` to the `reconciliations` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sourcesJson` to the `reconciliations` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `reconciliations` table without a default value. This is not possible if the table is not empty.
  - Added the required column `variancePercent` to the `reconciliations` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "kpi_actual_feeds" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kpiDefinitionId" TEXT NOT NULL,
    "employeeEmail" TEXT NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "value" REAL NOT NULL,
    "source" TEXT NOT NULL,
    "sourceCode" TEXT NOT NULL,
    "rawPayload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kpi_actual_feeds_kpiDefinitionId_fkey" FOREIGN KEY ("kpiDefinitionId") REFERENCES "kpi_definitions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "integration_sources" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 10,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "secret" TEXT NOT NULL,
    "lastSeenAt" DATETIME,
    "lastStatus" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "webhook_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceCode" TEXT NOT NULL,
    "sourceId" TEXT,
    "endpoint" TEXT NOT NULL,
    "signatureOk" BOOLEAN NOT NULL,
    "httpStatus" INTEGER NOT NULL,
    "itemsReceived" INTEGER NOT NULL DEFAULT 0,
    "itemsApplied" INTEGER NOT NULL DEFAULT 0,
    "itemsRejected" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "payloadSample" TEXT,
    "ipAddress" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_logs_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "integration_sources" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_kpi_results" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "periodId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kpiDefinitionId" TEXT,
    "kpiConfigId" TEXT,
    "weightPercent" REAL,
    "targetValue" REAL,
    "actualValue" REAL,
    "actualSystem" REAL,
    "actualSelf" REAL,
    "actualFinal" REAL,
    "hasMismatch" BOOLEAN NOT NULL DEFAULT false,
    "mismatchPercent" REAL,
    "evidenceUrl" TEXT,
    "achievementPercent" REAL NOT NULL DEFAULT 0,
    "weightedScore" REAL NOT NULL DEFAULT 0,
    "isCapped" BOOLEAN NOT NULL DEFAULT false,
    "isOverridden" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "selfNote" TEXT,
    "managerNote" TEXT,
    "ceoNote" TEXT,
    "selfSubmittedAt" DATETIME,
    "managerReviewedAt" DATETIME,
    "ceoReviewedAt" DATETIME,
    "finalizedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "kpi_results_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "kpi_periods" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "kpi_results_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "kpi_results_kpiDefinitionId_fkey" FOREIGN KEY ("kpiDefinitionId") REFERENCES "kpi_definitions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "kpi_results_kpiConfigId_fkey" FOREIGN KEY ("kpiConfigId") REFERENCES "kpi_configs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_kpi_results" ("achievementPercent", "actualValue", "ceoNote", "ceoReviewedAt", "createdAt", "employeeId", "id", "isCapped", "isOverridden", "kpiConfigId", "kpiDefinitionId", "managerNote", "managerReviewedAt", "overrideReason", "periodId", "selfNote", "selfSubmittedAt", "status", "targetValue", "updatedAt", "weightPercent", "weightedScore") SELECT "achievementPercent", "actualValue", "ceoNote", "ceoReviewedAt", "createdAt", "employeeId", "id", "isCapped", "isOverridden", "kpiConfigId", "kpiDefinitionId", "managerNote", "managerReviewedAt", "overrideReason", "periodId", "selfNote", "selfSubmittedAt", "status", "targetValue", "updatedAt", "weightPercent", "weightedScore" FROM "kpi_results";
DROP TABLE "kpi_results";
ALTER TABLE "new_kpi_results" RENAME TO "kpi_results";
CREATE INDEX "kpi_results_periodId_employeeId_idx" ON "kpi_results"("periodId", "employeeId");
CREATE INDEX "kpi_results_status_idx" ON "kpi_results"("status");
CREATE UNIQUE INDEX "kpi_results_periodId_employeeId_kpiDefinitionId_key" ON "kpi_results"("periodId", "employeeId", "kpiDefinitionId");
CREATE TABLE "new_kpi_reviews" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kpiResultId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "valueBefore" REAL,
    "valueAfter" REAL,
    "scoreBefore" REAL,
    "scoreAfter" REAL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kpi_reviews_kpiResultId_fkey" FOREIGN KEY ("kpiResultId") REFERENCES "kpi_results" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "kpi_reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_kpi_reviews" ("createdAt", "id", "kpiResultId", "reviewerId") SELECT "createdAt", "id", "kpiResultId", "reviewerId" FROM "kpi_reviews";
DROP TABLE "kpi_reviews";
ALTER TABLE "new_kpi_reviews" RENAME TO "kpi_reviews";
CREATE INDEX "kpi_reviews_kpiResultId_idx" ON "kpi_reviews"("kpiResultId");
CREATE TABLE "new_reconciliations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "periodId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kpiDefinitionId" TEXT NOT NULL,
    "sourcesJson" TEXT NOT NULL,
    "minValue" REAL NOT NULL,
    "maxValue" REAL NOT NULL,
    "variancePercent" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'MATCHED',
    "resolvedValue" REAL,
    "resolvedSource" TEXT,
    "resolveReason" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "reconciliations_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "kpi_periods" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "reconciliations_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "reconciliations_kpiDefinitionId_fkey" FOREIGN KEY ("kpiDefinitionId") REFERENCES "kpi_definitions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "reconciliations_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_reconciliations" ("createdAt", "id", "resolvedAt", "resolvedById", "status") SELECT "createdAt", "id", "resolvedAt", "resolvedById", "status" FROM "reconciliations";
DROP TABLE "reconciliations";
ALTER TABLE "new_reconciliations" RENAME TO "reconciliations";
CREATE INDEX "reconciliations_status_idx" ON "reconciliations"("status");
CREATE UNIQUE INDEX "reconciliations_periodId_employeeId_kpiDefinitionId_key" ON "reconciliations"("periodId", "employeeId", "kpiDefinitionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "kpi_actual_feeds_employeeEmail_kpiDefinitionId_periodMonth_periodYear_idx" ON "kpi_actual_feeds"("employeeEmail", "kpiDefinitionId", "periodMonth", "periodYear");

-- CreateIndex
CREATE UNIQUE INDEX "integration_sources_code_key" ON "integration_sources"("code");

-- CreateIndex
CREATE INDEX "webhook_logs_sourceCode_createdAt_idx" ON "webhook_logs"("sourceCode", "createdAt");
