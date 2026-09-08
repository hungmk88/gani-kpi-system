-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_kpi_actual_feeds" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kpiDefinitionId" TEXT NOT NULL,
    "employeeEmail" TEXT NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "value" REAL NOT NULL,
    "source" TEXT NOT NULL,
    "sourceCode" TEXT,
    "rawPayload" TEXT,
    "importId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kpi_actual_feeds_kpiDefinitionId_fkey" FOREIGN KEY ("kpiDefinitionId") REFERENCES "kpi_definitions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "kpi_actual_feeds_importId_fkey" FOREIGN KEY ("importId") REFERENCES "data_imports" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_kpi_actual_feeds" ("createdAt", "employeeEmail", "id", "kpiDefinitionId", "periodMonth", "periodYear", "rawPayload", "source", "sourceCode", "value") SELECT "createdAt", "employeeEmail", "id", "kpiDefinitionId", "periodMonth", "periodYear", "rawPayload", "source", "sourceCode", "value" FROM "kpi_actual_feeds";
DROP TABLE "kpi_actual_feeds";
ALTER TABLE "new_kpi_actual_feeds" RENAME TO "kpi_actual_feeds";
CREATE INDEX "kpi_actual_feeds_employeeEmail_kpiDefinitionId_periodMonth_periodYear_idx" ON "kpi_actual_feeds"("employeeEmail", "kpiDefinitionId", "periodMonth", "periodYear");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
