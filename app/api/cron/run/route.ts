import { fail, handle, ok } from "@/lib/api";
import { getSession } from "@/lib/auth";
import {
  recalcOpenResults,
  runKpiLockCycle,
} from "@/lib/services/kpi-service";
import { runRiskScan } from "@/lib/services/risk-service";
import { runReconciliation } from "@/lib/services/reconciliation-service";
import { runProductionKpiSyncRecent } from "@/lib/production/bridge";
import { runAnalyticsCycle } from "@/lib/services/analytics-service";
import {
  remindStaleMismatches,
  runDeadlineReminders,
} from "@/lib/services/reminder-service";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
// Bảy bước chạy tuần tự, mỗi bước gọi Postgres qua pooler — vượt quá 10s mặc
// định của Vercel. 60s là trần cho phép của gói Hobby.
export const maxDuration = 60;

/**
 * Bộ máy chạy nền. Năm việc, chạy theo đúng thứ tự này vì việc sau cần kết quả
 * của việc trước:
 *
 *   1. Khoá KPI theo lịch 2-4-5
 *   2. Gộp ca sản xuất đã khoá thành số liệu KPI tháng
 *   3. Đối soát dữ liệu đa nguồn (khớp thì đồng bộ, lệch thì treo lại)
 *   4. Tính lại điểm các dòng chưa chốt
 *   5. Quét rủi ro toàn bộ công việc
 *   6. Chấm lại dự báo cũ, dự báo mới, quét bất thường KPI
 *   7. Nhắc hạn cho người còn việc chưa làm
 *
 * Hai cách gọi:
 *   - Từ scheduler:  POST /api/cron/run  header  x-cron-secret: <CRON_SECRET>
 *   - Bấm tay trong giao diện (Ban Giám đốc / quản trị đã đăng nhập)
 *
 * Chạy lại nhiều lần vẫn an toàn, không tạo dữ liệu trùng và không nhắc lặp.
 */
async function execute(req: Request) {
  const secret = process.env.CRON_SECRET;
  const provided =
    req.headers.get("x-cron-secret") ??
    new URL(req.url).searchParams.get("secret");

  let actorLabel = "CRON";
  if (!secret || provided !== secret) {
    const user = await getSession();
    if (!user || (user.role !== "CEO" && user.role !== "ADMIN")) {
      return fail(
        "FORBIDDEN",
        "Cần khoá bí mật cron hoặc tài khoản Ban Giám đốc / quản trị.",
        403
      );
    }
    actorLabel = `MANUAL:${user.email}`;
  }

  const lockReport = await runKpiLockCycle();
  // Gộp ca sản xuất đã khoá thành số liệu KPI tháng TRƯỚC khi đối soát,
  // để số của xưởng cũng phải đi qua bộ đối soát như iPOS và file Excel.
  const productionSync = await runProductionKpiSyncRecent();
  const reconciliation = await runReconciliation();
  const recalced = await recalcOpenResults();
  const riskReport = await runRiskScan();
  // Phân tích chạy SAU cùng: nó đọc kết quả của mọi bước trên
  const analytics = await runAnalyticsCycle();
  const reminders = await runDeadlineReminders();
  const staleMismatch = await remindStaleMismatches();

  await writeAudit({
    actor: null,
    action: "CRON_RUN",
    entityName: "system",
    entityId: actorLabel,
    after: {
      lockReport,
      productionSync,
      reconciliation,
      recalced,
      riskReport,
      analytics,
      reminders,
      staleMismatch,
    },
  });

  return ok({
    ranAt: new Date().toISOString(),
    triggeredBy: actorLabel,
    kpiLock: lockReport,
    productionSync,
    reconciliation,
    kpiRecalculated: recalced,
    riskScan: riskReport,
    analytics,
    reminders,
    staleMismatch,
  });
}

export async function POST(req: Request) {
  return handle(() => execute(req));
}

export async function GET(req: Request) {
  return handle(() => execute(req));
}
