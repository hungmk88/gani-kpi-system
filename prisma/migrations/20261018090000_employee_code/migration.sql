-- Mã nhân viên (users.employeeCode): không bắt buộc, duy nhất khi có.
-- Postgres cho nhiều NULL trong unique index nên tài khoản cũ chưa có mã
-- không bị chặn.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employeeCode" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "users_employeeCode_key" ON "users"("employeeCode");
