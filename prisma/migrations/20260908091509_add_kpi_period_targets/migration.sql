-- CreateTable
CREATE TABLE "kpi_period_targets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "periodId" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "output_target" REAL,
    "waste_target" REAL,
    "quality_target" REAL,
    "spec_target" REAL,
    "safety_target" REAL,
    "deadline_target" REAL,
    "createdById" TEXT NOT NULL,
    "lastEditedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvalNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "kpi_period_targets_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "kpi_periods" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "kpi_period_targets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "kpi_period_targets_lastEditedById_fkey" FOREIGN KEY ("lastEditedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "kpi_shift_targets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "periodTargetId" TEXT NOT NULL,
    "shiftDate" DATETIME NOT NULL,
    "shiftType" TEXT NOT NULL,
    "output_target" REAL,
    "waste_target" REAL,
    "quality_target" REAL,
    "spec_target" REAL,
    "safety_target" REAL,
    "deadline_target" REAL,
    "createdById" TEXT NOT NULL,
    "lastEditedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "kpi_shift_targets_periodTargetId_fkey" FOREIGN KEY ("periodTargetId") REFERENCES "kpi_period_targets" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "kpi_shift_targets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "kpi_shift_targets_lastEditedById_fkey" FOREIGN KEY ("lastEditedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "kpi_period_targets_periodId_key" ON "kpi_period_targets"("periodId");

-- CreateIndex
CREATE INDEX "kpi_period_targets_department_idx" ON "kpi_period_targets"("department");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_period_targets_periodId_department_key" ON "kpi_period_targets"("periodId", "department");

-- CreateIndex
CREATE INDEX "kpi_shift_targets_shiftDate_idx" ON "kpi_shift_targets"("shiftDate");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_shift_targets_periodTargetId_shiftDate_shiftType_key" ON "kpi_shift_targets"("periodTargetId", "shiftDate", "shiftType");
