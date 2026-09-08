-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "jobTitle" TEXT,
    "role" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "departmentId" TEXT,
    "telegramChatId" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "productionRole" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "departmentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "projectId" TEXT,
    "departmentId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "creatorId" TEXT NOT NULL,
    "kpiDefinitionId" TEXT,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'TO_DO',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "riskReason" TEXT,
    "riskScannedAt" TIMESTAMP(3),
    "blockedSince" TIMESTAMP(3),
    "isAiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "aiConfidence" DOUBLE PRECISION,
    "estimatedHours" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_comments" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'COMMENT',
    "fileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "dependsOnId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cross_dept_requests" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "requesterId" TEXT NOT NULL,
    "targetDeptId" TEXT NOT NULL,
    "approverId" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "createdTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "cross_dept_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_periods" (
    "id" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "selfReviewDeadline" TIMESTAMP(3) NOT NULL,
    "managerReviewDeadline" TIMESTAMP(3) NOT NULL,
    "ceoApprovalDeadline" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3),

    CONSTRAINT "kpi_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_definitions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "departmentId" TEXT,
    "unit" TEXT NOT NULL,
    "isHigherBetter" BOOLEAN NOT NULL DEFAULT true,
    "dataSource" TEXT NOT NULL DEFAULT 'MANUAL',
    "defaultWeight" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_results" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kpiDefinitionId" TEXT,
    "kpiConfigId" TEXT,
    "weightPercent" DOUBLE PRECISION,
    "targetValue" DOUBLE PRECISION,
    "actualValue" DOUBLE PRECISION,
    "actualSystem" DOUBLE PRECISION,
    "actualSelf" DOUBLE PRECISION,
    "actualFinal" DOUBLE PRECISION,
    "hasMismatch" BOOLEAN NOT NULL DEFAULT false,
    "mismatchPercent" DOUBLE PRECISION,
    "evidenceUrl" TEXT,
    "achievementPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "weightedScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isCapped" BOOLEAN NOT NULL DEFAULT false,
    "isOverridden" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "selfNote" TEXT,
    "managerNote" TEXT,
    "ceoNote" TEXT,
    "selfSubmittedAt" TIMESTAMP(3),
    "managerReviewedAt" TIMESTAMP(3),
    "ceoReviewedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kpi_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_reviews" (
    "id" TEXT NOT NULL,
    "kpiResultId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "valueBefore" DOUBLE PRECISION,
    "valueAfter" DOUBLE PRECISION,
    "scoreBefore" DOUBLE PRECISION,
    "scoreAfter" DOUBLE PRECISION,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_configs" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "isHigherBetter" BOOLEAN NOT NULL DEFAULT true,
    "weightPercent" DOUBLE PRECISION NOT NULL,
    "dataSource" TEXT NOT NULL,
    "baselineValue" DOUBLE PRECISION,
    "targetValue" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kpi_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonus_configs" (
    "id" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "achievementMin" DOUBLE PRECISION NOT NULL,
    "achievementMax" DOUBLE PRECISION NOT NULL,
    "bonusMultiplier" DOUBLE PRECISION NOT NULL,
    "baseSalary" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bonus_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_waste_standards" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "wastePercent" DOUBLE PRECISION NOT NULL,
    "dataSource" TEXT NOT NULL DEFAULT 'ESTIMATED',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_waste_standards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period_kpi_summaries" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "totalScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "achievementPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bonusMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bonusAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "period_kpi_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "action" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "beforePayload" TEXT,
    "afterPayload" TEXT,
    "reason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'INFO',
    "linkUrl" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'IN_APP',
    "sentOk" BOOLEAN NOT NULL DEFAULT true,
    "sendError" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_imports" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "rowsTotal" INTEGER NOT NULL DEFAULT 0,
    "rowsOk" INTEGER NOT NULL DEFAULT 0,
    "rowsError" INTEGER NOT NULL DEFAULT 0,
    "errorLog" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_suggestions" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "entityId" TEXT,
    "inputText" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "confidencePercent" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT,
    "missingInfo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "latencyMs" INTEGER,
    "resultEntityId" TEXT,
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ai_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliations" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kpiDefinitionId" TEXT NOT NULL,
    "sourcesJson" TEXT NOT NULL,
    "minValue" DOUBLE PRECISION NOT NULL,
    "maxValue" DOUBLE PRECISION NOT NULL,
    "variancePercent" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'MATCHED',
    "resolvedValue" DOUBLE PRECISION,
    "resolvedSource" TEXT,
    "resolveReason" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_actual_feeds" (
    "id" TEXT NOT NULL,
    "kpiDefinitionId" TEXT NOT NULL,
    "employeeEmail" TEXT NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "sourceCode" TEXT,
    "rawPayload" TEXT,
    "importId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_actual_feeds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_sources" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 10,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "secret" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_logs" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_links" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_skus" (
    "id" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "skuName" TEXT NOT NULL,
    "targetOutputKg" DOUBLE PRECISION NOT NULL DEFAULT 500,
    "stdMaterialLossRate" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "stdKgPerLaborHour" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitPriceVnd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_skus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_shift_logs" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "shiftDate" TIMESTAMP(3) NOT NULL,
    "shiftType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawOutputKg" DOUBLE PRECISION NOT NULL,
    "totalLaborHours" DOUBLE PRECISION NOT NULL,
    "downtimeHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rawMaterialInputKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "draftNote" TEXT,
    "qcPassedKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reworkKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scrapKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "haccpViolationCount" INTEGER NOT NULL DEFAULT 0,
    "qcNote" TEXT,
    "qcOfficerId" TEXT,
    "qcApprovedAt" TIMESTAMP(3),
    "targetOutputKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stdMaterialNormKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qualityLossVnd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "targetOverrideReason" TEXT,
    "materialOverrideReason" TEXT,
    "ceoNote" TEXT,
    "lockedById" TEXT,
    "lockedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_shift_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_shift_participants" (
    "id" TEXT NOT NULL,
    "shiftLogId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "hoursWorked" DOUBLE PRECISION NOT NULL,
    "scheduledHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "personalDefectKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "violationCount" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "production_shift_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anti_gaming_audits" (
    "id" TEXT NOT NULL,
    "shiftLogId" TEXT NOT NULL,
    "behaviorType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "auditNote" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_EXPLANATION',
    "explanationText" TEXT,
    "explainedById" TEXT,
    "explainedAt" TIMESTAMP(3),
    "ceoReviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anti_gaming_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_kpi_results" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shiftLogId" TEXT NOT NULL,
    "tier1Score" DOUBLE PRECISION NOT NULL,
    "tier2Score" DOUBLE PRECISION NOT NULL,
    "finalWeightedScore" DOUBLE PRECISION NOT NULL,
    "breakdownJson" TEXT,
    "bonusMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "isBonusLocked" BOOLEAN NOT NULL DEFAULT false,
    "finalBonusVnd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_kpi_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prediction_logs" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "predictedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completionProbability" DOUBLE PRECISION NOT NULL,
    "projectedDelayDays" DOUBLE PRECISION NOT NULL,
    "riskCategory" TEXT NOT NULL,
    "factorsJson" TEXT NOT NULL,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "confidence" TEXT NOT NULL DEFAULT 'NONE',
    "outcomeKnown" BOOLEAN NOT NULL DEFAULT false,
    "actuallyLate" BOOLEAN,
    "actualDelayDays" DOUBLE PRECISION,
    "wasCorrect" BOOLEAN,
    "outcomeAt" TIMESTAMP(3),

    CONSTRAINT "prediction_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_anomalies" (
    "id" TEXT NOT NULL,
    "kpiResultId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kpiDefinitionId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "reportedValue" DOUBLE PRECISION NOT NULL,
    "historicalMean" DOUBLE PRECISION NOT NULL,
    "historicalMedian" DOUBLE PRECISION NOT NULL,
    "stdDev" DOUBLE PRECISION NOT NULL,
    "madValue" DOUBLE PRECISION NOT NULL,
    "zScore" DOUBLE PRECISION NOT NULL,
    "robustScore" DOUBLE PRECISION NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "confidence" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "explanationText" TEXT,
    "explainedById" TEXT,
    "explainedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_anomalies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_period_targets" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "output_target" DOUBLE PRECISION,
    "waste_target" DOUBLE PRECISION,
    "quality_target" DOUBLE PRECISION,
    "spec_target" DOUBLE PRECISION,
    "safety_target" DOUBLE PRECISION,
    "deadline_target" DOUBLE PRECISION,
    "createdById" TEXT NOT NULL,
    "lastEditedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvalNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kpi_period_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_shift_targets" (
    "id" TEXT NOT NULL,
    "periodTargetId" TEXT NOT NULL,
    "shiftDate" TIMESTAMP(3) NOT NULL,
    "shiftType" TEXT NOT NULL,
    "output_target" DOUBLE PRECISION,
    "waste_target" DOUBLE PRECISION,
    "quality_target" DOUBLE PRECISION,
    "spec_target" DOUBLE PRECISION,
    "safety_target" DOUBLE PRECISION,
    "deadline_target" DOUBLE PRECISION,
    "createdById" TEXT NOT NULL,
    "lastEditedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kpi_shift_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_kpi_scores" (
    "id" TEXT NOT NULL,
    "shiftLogId" TEXT NOT NULL,
    "periodTargetId" TEXT NOT NULL,
    "output_actual" DOUBLE PRECISION,
    "output_target" DOUBLE PRECISION,
    "output_achievement" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "output_weighted_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "waste_actual" DOUBLE PRECISION,
    "waste_target" DOUBLE PRECISION,
    "waste_achievement" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "waste_weighted_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quality_actual" DOUBLE PRECISION,
    "quality_target" DOUBLE PRECISION,
    "quality_achievement" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quality_weighted_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "spec_actual" DOUBLE PRECISION,
    "spec_target" DOUBLE PRECISION,
    "spec_achievement" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "spec_weighted_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "safety_actual" DOUBLE PRECISION,
    "safety_target" DOUBLE PRECISION,
    "safety_achievement" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "safety_weighted_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deadline_actual" DOUBLE PRECISION,
    "deadline_target" DOUBLE PRECISION,
    "deadline_achievement" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deadline_weighted_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bonusMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "baseSalary" DOUBLE PRECISION NOT NULL DEFAULT 233000,
    "bonusAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "breakdownJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "calculatedById" TEXT,
    "calculatedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_kpi_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
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
CREATE INDEX "audit_logs_entityName_entityId_idx" ON "audit_logs"("entityName", "entityId");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead");

-- CreateIndex
CREATE INDEX "data_imports_source_idx" ON "data_imports"("source");

-- CreateIndex
CREATE INDEX "ai_suggestions_requestedById_createdAt_idx" ON "ai_suggestions"("requestedById", "createdAt");

-- CreateIndex
CREATE INDEX "ai_suggestions_kind_status_idx" ON "ai_suggestions"("kind", "status");

-- CreateIndex
CREATE INDEX "reconciliations_status_idx" ON "reconciliations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliations_periodId_employeeId_kpiDefinitionId_key" ON "reconciliations"("periodId", "employeeId", "kpiDefinitionId");

-- CreateIndex
CREATE INDEX "kpi_actual_feeds_employeeEmail_kpiDefinitionId_periodMonth__idx" ON "kpi_actual_feeds"("employeeEmail", "kpiDefinitionId", "periodMonth", "periodYear");

-- CreateIndex
CREATE UNIQUE INDEX "integration_sources_code_key" ON "integration_sources"("code");

-- CreateIndex
CREATE INDEX "webhook_logs_sourceCode_createdAt_idx" ON "webhook_logs"("sourceCode", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_links_code_key" ON "telegram_links"("code");

-- CreateIndex
CREATE UNIQUE INDEX "product_skus_skuCode_key" ON "product_skus"("skuCode");

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

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_kpiDefinitionId_fkey" FOREIGN KEY ("kpiDefinitionId") REFERENCES "kpi_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cross_dept_requests" ADD CONSTRAINT "cross_dept_requests_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cross_dept_requests" ADD CONSTRAINT "cross_dept_requests_targetDeptId_fkey" FOREIGN KEY ("targetDeptId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cross_dept_requests" ADD CONSTRAINT "cross_dept_requests_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cross_dept_requests" ADD CONSTRAINT "cross_dept_requests_createdTaskId_fkey" FOREIGN KEY ("createdTaskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_definitions" ADD CONSTRAINT "kpi_definitions_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_results" ADD CONSTRAINT "kpi_results_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "kpi_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_results" ADD CONSTRAINT "kpi_results_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_results" ADD CONSTRAINT "kpi_results_kpiDefinitionId_fkey" FOREIGN KEY ("kpiDefinitionId") REFERENCES "kpi_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_results" ADD CONSTRAINT "kpi_results_kpiConfigId_fkey" FOREIGN KEY ("kpiConfigId") REFERENCES "kpi_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_reviews" ADD CONSTRAINT "kpi_reviews_kpiResultId_fkey" FOREIGN KEY ("kpiResultId") REFERENCES "kpi_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_reviews" ADD CONSTRAINT "kpi_reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_kpi_summaries" ADD CONSTRAINT "period_kpi_summaries_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "kpi_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_kpi_summaries" ADD CONSTRAINT "period_kpi_summaries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "kpi_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_kpiDefinitionId_fkey" FOREIGN KEY ("kpiDefinitionId") REFERENCES "kpi_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_actual_feeds" ADD CONSTRAINT "kpi_actual_feeds_kpiDefinitionId_fkey" FOREIGN KEY ("kpiDefinitionId") REFERENCES "kpi_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_actual_feeds" ADD CONSTRAINT "kpi_actual_feeds_importId_fkey" FOREIGN KEY ("importId") REFERENCES "data_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_logs" ADD CONSTRAINT "webhook_logs_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "integration_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_shift_logs" ADD CONSTRAINT "production_shift_logs_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "product_skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_shift_logs" ADD CONSTRAINT "production_shift_logs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_shift_logs" ADD CONSTRAINT "production_shift_logs_qcOfficerId_fkey" FOREIGN KEY ("qcOfficerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_shift_logs" ADD CONSTRAINT "production_shift_logs_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_shift_participants" ADD CONSTRAINT "production_shift_participants_shiftLogId_fkey" FOREIGN KEY ("shiftLogId") REFERENCES "production_shift_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_shift_participants" ADD CONSTRAINT "production_shift_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anti_gaming_audits" ADD CONSTRAINT "anti_gaming_audits_shiftLogId_fkey" FOREIGN KEY ("shiftLogId") REFERENCES "production_shift_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anti_gaming_audits" ADD CONSTRAINT "anti_gaming_audits_explainedById_fkey" FOREIGN KEY ("explainedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anti_gaming_audits" ADD CONSTRAINT "anti_gaming_audits_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_kpi_results" ADD CONSTRAINT "daily_kpi_results_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_kpi_results" ADD CONSTRAINT "daily_kpi_results_shiftLogId_fkey" FOREIGN KEY ("shiftLogId") REFERENCES "production_shift_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_logs" ADD CONSTRAINT "prediction_logs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_anomalies" ADD CONSTRAINT "kpi_anomalies_kpiResultId_fkey" FOREIGN KEY ("kpiResultId") REFERENCES "kpi_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_anomalies" ADD CONSTRAINT "kpi_anomalies_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_anomalies" ADD CONSTRAINT "kpi_anomalies_kpiDefinitionId_fkey" FOREIGN KEY ("kpiDefinitionId") REFERENCES "kpi_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_anomalies" ADD CONSTRAINT "kpi_anomalies_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "kpi_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_anomalies" ADD CONSTRAINT "kpi_anomalies_explainedById_fkey" FOREIGN KEY ("explainedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_anomalies" ADD CONSTRAINT "kpi_anomalies_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_period_targets" ADD CONSTRAINT "kpi_period_targets_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "kpi_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_period_targets" ADD CONSTRAINT "kpi_period_targets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_period_targets" ADD CONSTRAINT "kpi_period_targets_lastEditedById_fkey" FOREIGN KEY ("lastEditedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_shift_targets" ADD CONSTRAINT "kpi_shift_targets_periodTargetId_fkey" FOREIGN KEY ("periodTargetId") REFERENCES "kpi_period_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_shift_targets" ADD CONSTRAINT "kpi_shift_targets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_shift_targets" ADD CONSTRAINT "kpi_shift_targets_lastEditedById_fkey" FOREIGN KEY ("lastEditedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_kpi_scores" ADD CONSTRAINT "shift_kpi_scores_shiftLogId_fkey" FOREIGN KEY ("shiftLogId") REFERENCES "production_shift_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_kpi_scores" ADD CONSTRAINT "shift_kpi_scores_periodTargetId_fkey" FOREIGN KEY ("periodTargetId") REFERENCES "kpi_period_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_kpi_scores" ADD CONSTRAINT "shift_kpi_scores_calculatedById_fkey" FOREIGN KEY ("calculatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_kpi_scores" ADD CONSTRAINT "shift_kpi_scores_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
