-- Mục 4 sau review 10/2026.
--
-- 1) Tiền chuyển từ Float sang INTEGER (số nguyên VND). Prisma Int vẫn là
--    `number` trong TypeScript nên code không đổi kiểu. Giá trị cũ được làm
--    tròn đến đồng. Kiểm tra tràn TRƯỚC khi đổi để migration hỏng sạch sẽ,
--    không đổi dở dang.
--
-- 2) CHECK constraint cho các cột liệt kê (vai trò, trạng thái, ca...). Danh
--    sách giá trị khớp hằng số trong code (lib/db-constraints.ts, có unit test
--    so khớp). Thêm ở chế độ NOT VALID: chặn mọi dòng GHI MỚI sai giá trị nhưng
--    không kiểm dữ liệu cũ, nên migration không thể hỏng vì dữ liệu lịch sử.
--    Kiểm và xác nhận dữ liệu cũ sau: node scripts/validate-db-checks.mjs

DO $$
DECLARE
  bad TEXT := '';
BEGIN
  IF EXISTS (SELECT 1 FROM "bonus_configs" WHERE abs("baseSalary") > 2147483647) THEN
    bad := bad || ' bonus_configs.baseSalary';
  END IF;
  IF EXISTS (SELECT 1 FROM "period_kpi_summaries" WHERE abs("bonusAmount") > 2147483647) THEN
    bad := bad || ' period_kpi_summaries.bonusAmount';
  END IF;
  IF EXISTS (SELECT 1 FROM "product_skus" WHERE abs("unitPriceVnd") > 2147483647) THEN
    bad := bad || ' product_skus.unitPriceVnd';
  END IF;
  IF EXISTS (SELECT 1 FROM "production_shift_logs" WHERE abs("qualityLossVnd") > 2147483647) THEN
    bad := bad || ' production_shift_logs.qualityLossVnd';
  END IF;
  IF EXISTS (SELECT 1 FROM "daily_kpi_results" WHERE abs("finalBonusVnd") > 2147483647) THEN
    bad := bad || ' daily_kpi_results.finalBonusVnd';
  END IF;
  IF EXISTS (SELECT 1 FROM "shift_kpi_scores" WHERE abs("baseSalary") > 2147483647) THEN
    bad := bad || ' shift_kpi_scores.baseSalary';
  END IF;
  IF EXISTS (SELECT 1 FROM "shift_kpi_scores" WHERE abs("bonusAmount") > 2147483647) THEN
    bad := bad || ' shift_kpi_scores.bonusAmount';
  END IF;
  IF bad <> '' THEN
    RAISE EXCEPTION 'Giá trị tiền vượt giới hạn INTEGER ở:%', bad;
  END IF;
END $$;

ALTER TABLE "bonus_configs" ALTER COLUMN "baseSalary" SET DATA TYPE INTEGER USING round("baseSalary")::integer;
ALTER TABLE "period_kpi_summaries" ALTER COLUMN "bonusAmount" SET DATA TYPE INTEGER USING round("bonusAmount")::integer;
ALTER TABLE "period_kpi_summaries" ALTER COLUMN "bonusAmount" SET DEFAULT 0;
ALTER TABLE "product_skus" ALTER COLUMN "unitPriceVnd" SET DATA TYPE INTEGER USING round("unitPriceVnd")::integer;
ALTER TABLE "product_skus" ALTER COLUMN "unitPriceVnd" SET DEFAULT 0;
ALTER TABLE "production_shift_logs" ALTER COLUMN "qualityLossVnd" SET DATA TYPE INTEGER USING round("qualityLossVnd")::integer;
ALTER TABLE "production_shift_logs" ALTER COLUMN "qualityLossVnd" SET DEFAULT 0;
ALTER TABLE "daily_kpi_results" ALTER COLUMN "finalBonusVnd" SET DATA TYPE INTEGER USING round("finalBonusVnd")::integer;
ALTER TABLE "daily_kpi_results" ALTER COLUMN "finalBonusVnd" SET DEFAULT 0;
ALTER TABLE "shift_kpi_scores" ALTER COLUMN "baseSalary" SET DATA TYPE INTEGER USING round("baseSalary")::integer;
ALTER TABLE "shift_kpi_scores" ALTER COLUMN "baseSalary" SET DEFAULT 233000;
ALTER TABLE "shift_kpi_scores" ALTER COLUMN "bonusAmount" SET DATA TYPE INTEGER USING round("bonusAmount")::integer;
ALTER TABLE "shift_kpi_scores" ALTER COLUMN "bonusAmount" SET DEFAULT 0;

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_role_check";
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("role" IN ('EMPLOYEE', 'MANAGER', 'CEO', 'ADMIN')) NOT VALID;
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_productionRole_check";
ALTER TABLE "users" ADD CONSTRAINT "users_productionRole_check" CHECK ("productionRole" IS NULL OR "productionRole" IN ('WORKER', 'TEAM_LEADER', 'SUPERVISOR', 'QC_OFFICER', 'PRODUCTION_DIRECTOR')) NOT VALID;
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_status_check";
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_check" CHECK ("status" IN ('BACKLOG', 'TO_DO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE', 'CANCELLED')) NOT VALID;
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_priority_check";
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_priority_check" CHECK ("priority" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')) NOT VALID;
ALTER TABLE "kpi_periods" DROP CONSTRAINT IF EXISTS "kpi_periods_status_check";
ALTER TABLE "kpi_periods" ADD CONSTRAINT "kpi_periods_status_check" CHECK ("status" IN ('OPEN', 'SELF_LOCKED', 'MANAGER_LOCKED', 'FINALIZED')) NOT VALID;
ALTER TABLE "kpi_results" DROP CONSTRAINT IF EXISTS "kpi_results_status_check";
ALTER TABLE "kpi_results" ADD CONSTRAINT "kpi_results_status_check" CHECK ("status" IN ('DRAFT', 'SELF_REVIEWED', 'MANAGER_REVIEWED', 'FINALIZED')) NOT VALID;
ALTER TABLE "leave_requests" DROP CONSTRAINT IF EXISTS "leave_requests_status_check";
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')) NOT VALID;
ALTER TABLE "cross_dept_requests" DROP CONSTRAINT IF EXISTS "cross_dept_requests_status_check";
ALTER TABLE "cross_dept_requests" ADD CONSTRAINT "cross_dept_requests_status_check" CHECK ("status" IN ('PENDING', 'ACCEPTED', 'REJECTED')) NOT VALID;
ALTER TABLE "production_shift_logs" DROP CONSTRAINT IF EXISTS "production_shift_logs_status_check";
ALTER TABLE "production_shift_logs" ADD CONSTRAINT "production_shift_logs_status_check" CHECK ("status" IN ('DRAFT', 'QC_APPROVED', 'LOCKED')) NOT VALID;
ALTER TABLE "production_shift_logs" DROP CONSTRAINT IF EXISTS "production_shift_logs_shiftType_check";
ALTER TABLE "production_shift_logs" ADD CONSTRAINT "production_shift_logs_shiftType_check" CHECK ("shiftType" IN ('CA_1', 'CA_2', 'CA_3')) NOT VALID;
