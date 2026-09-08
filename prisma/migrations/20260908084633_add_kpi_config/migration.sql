-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "jobTitle" TEXT,
    "role" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "departmentId" TEXT,
    "telegramChatId" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" DATETIME,
    "passwordChangedAt" DATETIME,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "productionRole" TEXT,
    CONSTRAINT "users_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "departmentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" DATETIME,
    "endDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "projects_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "projectId" TEXT,
    "departmentId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "creatorId" TEXT NOT NULL,
    "kpiDefinitionId" TEXT,
    "startDate" DATETIME,
    "dueDate" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'TO_DO',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "riskReason" TEXT,
    "riskScannedAt" DATETIME,
    "blockedSince" DATETIME,
    "isAiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "aiConfidence" REAL,
    "estimatedHours" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tasks_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tasks_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tasks_kpiDefinitionId_fkey" FOREIGN KEY ("kpiDefinitionId") REFERENCES "kpi_definitions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "task_comments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'COMMENT',
    "fileUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "task_comments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "task_comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "dependsOnId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "task_dependencies_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "task_dependencies_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "cross_dept_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "requesterId" TEXT NOT NULL,
    "targetDeptId" TEXT NOT NULL,
    "approverId" TEXT,
    "dueDate" DATETIME NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" DATETIME,
    CONSTRAINT "cross_dept_requests_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "cross_dept_requests_targetDeptId_fkey" FOREIGN KEY ("targetDeptId") REFERENCES "departments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "cross_dept_requests_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "kpi_periods" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "selfReviewDeadline" DATETIME NOT NULL,
    "managerReviewDeadline" DATETIME NOT NULL,
    "ceoApprovalDeadline" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" DATETIME
);

-- CreateTable
CREATE TABLE "kpi_definitions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "departmentId" TEXT,
    "unit" TEXT NOT NULL,
    "isHigherBetter" BOOLEAN NOT NULL DEFAULT true,
    "dataSource" TEXT NOT NULL DEFAULT 'MANUAL',
    "defaultWeight" REAL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kpi_definitions_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "kpi_results" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "periodId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kpiDefinitionId" TEXT,
    "kpiConfigId" TEXT,
    "weightPercent" REAL,
    "targetValue" REAL,
    "actualValue" REAL,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "kpi_results_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "kpi_periods" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "kpi_results_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "kpi_results_kpiDefinitionId_fkey" FOREIGN KEY ("kpiDefinitionId") REFERENCES "kpi_definitions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "kpi_results_kpiConfigId_fkey" FOREIGN KEY ("kpiConfigId") REFERENCES "kpi_configs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "kpi_reviews" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kpiResultId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "comment" TEXT,
    "rating" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kpi_reviews_kpiResultId_fkey" FOREIGN KEY ("kpiResultId") REFERENCES "kpi_results" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "kpi_reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "kpi_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "isHigherBetter" BOOLEAN NOT NULL DEFAULT true,
    "weightPercent" REAL NOT NULL,
    "dataSource" TEXT NOT NULL,
    "baselineValue" REAL,
    "targetValue" REAL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "bonus_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "department" TEXT NOT NULL,
    "achievementMin" REAL NOT NULL,
    "achievementMax" REAL NOT NULL,
    "bonusMultiplier" REAL NOT NULL,
    "baseSalary" REAL NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "product_waste_standards" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "wastePercent" REAL NOT NULL,
    "dataSource" TEXT NOT NULL DEFAULT 'ESTIMATED',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "period_kpi_summaries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "periodId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "totalScore" REAL NOT NULL DEFAULT 0,
    "achievementPercent" REAL NOT NULL DEFAULT 0,
    "bonusMultiplier" REAL NOT NULL DEFAULT 0,
    "bonusAmount" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "period_kpi_summaries_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "kpi_periods" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "period_kpi_summaries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "details" TEXT,
    "ipAddress" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "actionUrl" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" DATETIME,
    CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "data_imports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "errorMsg" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "data_imports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ai_suggestions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requesterId" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "suggestion" TEXT NOT NULL,
    "deciderId" TEXT,
    "decision" TEXT,
    "actionTaken" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    CONSTRAINT "ai_suggestions_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ai_suggestions_deciderId_fkey" FOREIGN KEY ("deciderId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "reconciliations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportedEmployeeId" TEXT NOT NULL,
    "resolvedById" TEXT,
    "discrepancyType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "reconciliations_reportedEmployeeId_fkey" FOREIGN KEY ("reportedEmployeeId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "reconciliations_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "telegram_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "telegramUsername" TEXT,
    "linkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "product_skus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "targetOutputPerShift" REAL NOT NULL DEFAULT 500,
    "stdWastePercent" REAL NOT NULL DEFAULT 0.07,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "production_shift_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skuId" TEXT NOT NULL,
    "shiftDate" DATETIME NOT NULL,
    "shiftType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawOutputKg" REAL NOT NULL,
    "totalLaborHours" REAL NOT NULL,
    "downtimeHours" REAL NOT NULL DEFAULT 0,
    "rawMaterialInputKg" REAL NOT NULL DEFAULT 0,
    "draftNote" TEXT,
    "qcPassedKg" REAL NOT NULL DEFAULT 0,
    "reworkKg" REAL NOT NULL DEFAULT 0,
    "scrapKg" REAL NOT NULL DEFAULT 0,
    "haccpViolationCount" INTEGER NOT NULL DEFAULT 0,
    "qcNote" TEXT,
    "qcOfficerId" TEXT,
    "qcApprovedAt" DATETIME,
    "targetOutputKg" REAL NOT NULL DEFAULT 0,
    "stdMaterialNormKg" REAL NOT NULL DEFAULT 0,
    "qualityLossVnd" REAL NOT NULL DEFAULT 0,
    "targetOverrideReason" TEXT,
    "materialOverrideReason" TEXT,
    "ceoNote" TEXT,
    "lockedById" TEXT,
    "lockedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "production_shift_logs_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "product_skus" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "production_shift_logs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "production_shift_logs_qcOfficerId_fkey" FOREIGN KEY ("qcOfficerId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "production_shift_logs_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "production_shift_participants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shiftLogId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "hoursWorked" REAL NOT NULL,
    "scheduledHours" REAL NOT NULL DEFAULT 0,
    "personalDefectKg" REAL NOT NULL DEFAULT 0,
    "violationCount" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    CONSTRAINT "production_shift_participants_shiftLogId_fkey" FOREIGN KEY ("shiftLogId") REFERENCES "production_shift_logs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "production_shift_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "anti_gaming_audits" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shiftLogId" TEXT NOT NULL,
    "behaviorType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "auditNote" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_EXPLANATION',
    "explanationText" TEXT,
    "explainedById" TEXT,
    "explainedAt" DATETIME,
    "ceoReviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "anti_gaming_audits_shiftLogId_fkey" FOREIGN KEY ("shiftLogId") REFERENCES "production_shift_logs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "anti_gaming_audits_explainedById_fkey" FOREIGN KEY ("explainedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "anti_gaming_audits_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "daily_kpi_results" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "shiftLogId" TEXT NOT NULL,
    "tier1Score" REAL NOT NULL,
    "tier2Score" REAL NOT NULL,
    "finalWeightedScore" REAL NOT NULL,
    "breakdownJson" TEXT,
    "bonusMultiplier" REAL NOT NULL DEFAULT 1.0,
    "isBonusLocked" BOOLEAN NOT NULL DEFAULT false,
    "finalBonusVnd" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "daily_kpi_results_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "daily_kpi_results_shiftLogId_fkey" FOREIGN KEY ("shiftLogId") REFERENCES "production_shift_logs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "prediction_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "predictedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completionProbability" REAL NOT NULL,
    "projectedDelayDays" REAL NOT NULL,
    "riskCategory" TEXT NOT NULL,
    "factorsJson" TEXT NOT NULL,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "confidence" TEXT NOT NULL DEFAULT 'NONE',
    "outcomeKnown" BOOLEAN NOT NULL DEFAULT false,
    "actuallyLate" BOOLEAN,
    "actualDelayDays" REAL,
    "wasCorrect" BOOLEAN,
    "outcomeAt" DATETIME,
    CONSTRAINT "prediction_logs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "kpi_anomalies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kpiResultId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kpiDefinitionId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "reportedValue" REAL NOT NULL,
    "historicalMean" REAL NOT NULL,
    "historicalMedian" REAL NOT NULL,
    "stdDev" REAL NOT NULL,
    "madValue" REAL NOT NULL,
    "zScore" REAL NOT NULL,
    "robustScore" REAL NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "confidence" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "explanationText" TEXT,
    "explainedById" TEXT,
    "explainedAt" DATETIME,
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kpi_anomalies_kpiResultId_fkey" FOREIGN KEY ("kpiResultId") REFERENCES "kpi_results" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "kpi_anomalies_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "kpi_anomalies_kpiDefinitionId_fkey" FOREIGN KEY ("kpiDefinitionId") REFERENCES "kpi_definitions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "kpi_anomalies_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "kpi_periods" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "kpi_anomalies_explainedById_fkey" FOREIGN KEY ("explainedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "kpi_anomalies_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_departmentId_idx" ON "users"("departmentId");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "projects_code_key" ON "projects"("code");

-- CreateIndex
CREATE INDEX "projects_departmentId_idx" ON "projects"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_code_key" ON "tasks"("code");

-- CreateIndex
CREATE INDEX "tasks_assigneeId_status_idx" ON "tasks"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "tasks_departmentId_idx" ON "tasks"("departmentId");

-- CreateIndex
CREATE INDEX "tasks_dueDate_idx" ON "tasks"("dueDate");

-- CreateIndex
CREATE INDEX "tasks_status_idx" ON "tasks"("status");

-- CreateIndex
CREATE INDEX "task_comments_taskId_idx" ON "task_comments"("taskId");

-- CreateIndex
CREATE INDEX "task_dependencies_dependsOnId_idx" ON "task_dependencies"("dependsOnId");

-- CreateIndex
CREATE UNIQUE INDEX "task_dependencies_taskId_dependsOnId_key" ON "task_dependencies"("taskId", "dependsOnId");

-- CreateIndex
CREATE INDEX "cross_dept_requests_status_idx" ON "cross_dept_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_periods_month_year_key" ON "kpi_periods"("month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_definitions_code_key" ON "kpi_definitions"("code");

-- CreateIndex
CREATE INDEX "kpi_definitions_departmentId_idx" ON "kpi_definitions"("departmentId");

-- CreateIndex
CREATE INDEX "kpi_results_periodId_employeeId_idx" ON "kpi_results"("periodId", "employeeId");

-- CreateIndex
CREATE INDEX "kpi_results_status_idx" ON "kpi_results"("status");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_results_periodId_employeeId_kpiDefinitionId_key" ON "kpi_results"("periodId", "employeeId", "kpiDefinitionId");

-- CreateIndex
CREATE INDEX "kpi_reviews_kpiResultId_idx" ON "kpi_reviews"("kpiResultId");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_configs_code_key" ON "kpi_configs"("code");

-- CreateIndex
CREATE INDEX "kpi_configs_department_idx" ON "kpi_configs"("department");

-- CreateIndex
CREATE INDEX "bonus_configs_department_idx" ON "bonus_configs"("department");

-- CreateIndex
CREATE UNIQUE INDEX "bonus_configs_department_achievementMin_key" ON "bonus_configs"("department", "achievementMin");

-- CreateIndex
CREATE UNIQUE INDEX "product_waste_standards_sku_key" ON "product_waste_standards"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "period_kpi_summaries_periodId_key" ON "period_kpi_summaries"("periodId");

-- CreateIndex
CREATE INDEX "period_kpi_summaries_periodId_employeeId_department_idx" ON "period_kpi_summaries"("periodId", "employeeId", "department");

-- CreateIndex
CREATE UNIQUE INDEX "period_kpi_summaries_periodId_employeeId_key" ON "period_kpi_summaries"("periodId", "employeeId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_target_targetId_idx" ON "audit_logs"("target", "targetId");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead");

-- CreateIndex
CREATE INDEX "data_imports_status_idx" ON "data_imports"("status");

-- CreateIndex
CREATE INDEX "ai_suggestions_requesterId_createdAt_idx" ON "ai_suggestions"("requesterId", "createdAt");

-- CreateIndex
CREATE INDEX "reconciliations_status_idx" ON "reconciliations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_links_userId_telegramUserId_key" ON "telegram_links"("userId", "telegramUserId");

-- CreateIndex
CREATE UNIQUE INDEX "product_skus_code_key" ON "product_skus"("code");

-- CreateIndex
CREATE INDEX "production_shift_logs_status_idx" ON "production_shift_logs"("status");

-- CreateIndex
CREATE INDEX "production_shift_logs_shiftDate_idx" ON "production_shift_logs"("shiftDate");

-- CreateIndex
CREATE UNIQUE INDEX "production_shift_logs_shiftDate_shiftType_skuId_key" ON "production_shift_logs"("shiftDate", "shiftType", "skuId");

-- CreateIndex
CREATE INDEX "production_shift_participants_userId_idx" ON "production_shift_participants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "production_shift_participants_shiftLogId_userId_key" ON "production_shift_participants"("shiftLogId", "userId");

-- CreateIndex
CREATE INDEX "anti_gaming_audits_status_idx" ON "anti_gaming_audits"("status");

-- CreateIndex
CREATE INDEX "daily_kpi_results_userId_idx" ON "daily_kpi_results"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "daily_kpi_results_shiftLogId_userId_key" ON "daily_kpi_results"("shiftLogId", "userId");

-- CreateIndex
CREATE INDEX "prediction_logs_taskId_predictedAt_idx" ON "prediction_logs"("taskId", "predictedAt");

-- CreateIndex
CREATE INDEX "prediction_logs_outcomeKnown_idx" ON "prediction_logs"("outcomeKnown");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_anomalies_kpiResultId_key" ON "kpi_anomalies"("kpiResultId");

-- CreateIndex
CREATE INDEX "kpi_anomalies_status_idx" ON "kpi_anomalies"("status");

-- CreateIndex
CREATE INDEX "kpi_anomalies_periodId_idx" ON "kpi_anomalies"("periodId");
