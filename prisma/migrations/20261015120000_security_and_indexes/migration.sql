-- Sửa đợt review 10/2026: khoá chạy nền (job_locks), index cho khoá ngoại hay lọc,
-- bỏ unique sai trên period_kpi_summaries.periodId, bỏ index trùng của shift_kpi_scores.
-- Dùng IF [NOT] EXISTS để an toàn với database từng được 'db push'.

-- DropIndex
DROP INDEX IF EXISTS "period_kpi_summaries_periodId_key";

-- DropIndex
DROP INDEX IF EXISTS "shift_kpi_scores_shiftLogId_idx";

-- CreateTable
CREATE TABLE IF NOT EXISTS "job_locks" (
    "name" TEXT NOT NULL,
    "lockedUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_locks_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tasks_projectId_idx" ON "tasks"("projectId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tasks_creatorId_idx" ON "tasks"("creatorId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tasks_kpiDefinitionId_idx" ON "tasks"("kpiDefinitionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cross_dept_requests_requesterId_idx" ON "cross_dept_requests"("requesterId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cross_dept_requests_targetDeptId_idx" ON "cross_dept_requests"("targetDeptId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "leave_requests_departmentId_idx" ON "leave_requests"("departmentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "kpi_results_employeeId_kpiDefinitionId_idx" ON "kpi_results"("employeeId", "kpiDefinitionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "kpi_results_kpiDefinitionId_idx" ON "kpi_results"("kpiDefinitionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reconciliations_employeeId_idx" ON "reconciliations"("employeeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reconciliations_kpiDefinitionId_idx" ON "reconciliations"("kpiDefinitionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "kpi_actual_feeds_importId_idx" ON "kpi_actual_feeds"("importId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "webhook_logs_sourceId_idx" ON "webhook_logs"("sourceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "telegram_links_userId_idx" ON "telegram_links"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "product_skus_rawMaterialId_idx" ON "product_skus"("rawMaterialId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "raw_material_transactions_shiftLogId_idx" ON "raw_material_transactions"("shiftLogId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "production_shift_logs_skuId_idx" ON "production_shift_logs"("skuId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "anti_gaming_audits_shiftLogId_idx" ON "anti_gaming_audits"("shiftLogId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "kpi_anomalies_employeeId_idx" ON "kpi_anomalies"("employeeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "kpi_anomalies_kpiDefinitionId_idx" ON "kpi_anomalies"("kpiDefinitionId");

