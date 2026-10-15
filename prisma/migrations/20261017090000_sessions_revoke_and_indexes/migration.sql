-- Đăng xuất thu hồi phiên (users.sessionsRevokedAt) + 2 index cho truy vấn
-- hay dùng (danh sách thông báo / chặn nhắc trùng; kiểm hạn mức & trùng ngày
-- nghỉ phép).

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sessionsRevokedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "leave_requests_employeeId_startDate_idx" ON "leave_requests"("employeeId", "startDate");

CREATE INDEX IF NOT EXISTS "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- Đối soát nạp feed cả kỳ một lần (runReconciliation) — lọc theo kỳ trước.
CREATE INDEX IF NOT EXISTS "kpi_actual_feeds_periodYear_periodMonth_kpiDefinitionId_idx" ON "kpi_actual_feeds"("periodYear", "periodMonth", "kpiDefinitionId");
