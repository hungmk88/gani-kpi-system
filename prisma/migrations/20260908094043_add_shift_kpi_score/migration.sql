-- CreateTable
CREATE TABLE "shift_kpi_scores" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shiftLogId" TEXT NOT NULL,
    "periodTargetId" TEXT NOT NULL,
    "output_actual" REAL,
    "output_target" REAL,
    "output_achievement" REAL NOT NULL DEFAULT 0,
    "output_weighted_score" REAL NOT NULL DEFAULT 0,
    "waste_actual" REAL,
    "waste_target" REAL,
    "waste_achievement" REAL NOT NULL DEFAULT 0,
    "waste_weighted_score" REAL NOT NULL DEFAULT 0,
    "quality_actual" REAL,
    "quality_target" REAL,
    "quality_achievement" REAL NOT NULL DEFAULT 0,
    "quality_weighted_score" REAL NOT NULL DEFAULT 0,
    "spec_actual" REAL,
    "spec_target" REAL,
    "spec_achievement" REAL NOT NULL DEFAULT 0,
    "spec_weighted_score" REAL NOT NULL DEFAULT 0,
    "safety_actual" REAL,
    "safety_target" REAL,
    "safety_achievement" REAL NOT NULL DEFAULT 0,
    "safety_weighted_score" REAL NOT NULL DEFAULT 0,
    "deadline_actual" REAL,
    "deadline_target" REAL,
    "deadline_achievement" REAL NOT NULL DEFAULT 0,
    "deadline_weighted_score" REAL NOT NULL DEFAULT 0,
    "totalScore" REAL NOT NULL DEFAULT 0,
    "bonusMultiplier" REAL NOT NULL DEFAULT 0,
    "baseSalary" REAL NOT NULL DEFAULT 233000,
    "bonusAmount" REAL NOT NULL DEFAULT 0,
    "breakdownJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "calculatedById" TEXT,
    "calculatedAt" DATETIME,
    "approvedById" TEXT,
    "approvedAt" DATETIME,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "shift_kpi_scores_shiftLogId_fkey" FOREIGN KEY ("shiftLogId") REFERENCES "production_shift_logs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "shift_kpi_scores_periodTargetId_fkey" FOREIGN KEY ("periodTargetId") REFERENCES "kpi_period_targets" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "shift_kpi_scores_calculatedById_fkey" FOREIGN KEY ("calculatedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "shift_kpi_scores_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "shift_kpi_scores_shiftLogId_key" ON "shift_kpi_scores"("shiftLogId");

-- CreateIndex
CREATE INDEX "shift_kpi_scores_shiftLogId_idx" ON "shift_kpi_scores"("shiftLogId");

-- CreateIndex
CREATE INDEX "shift_kpi_scores_periodTargetId_idx" ON "shift_kpi_scores"("periodTargetId");

-- CreateIndex
CREATE INDEX "shift_kpi_scores_status_idx" ON "shift_kpi_scores"("status");

-- CreateIndex
CREATE INDEX "shift_kpi_scores_createdAt_idx" ON "shift_kpi_scores"("createdAt");
