import { fail, handle, ok, requireUser } from "@/lib/api";
import { safeEqual, strongSecret } from "@/lib/secrets";
import { acquireJobLock, releaseJobLock } from "@/lib/job-lock";
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
 *   6. Chấm lại dự báo cũ, dự báo mới, quét bất thường KPI, và đúng ngày chốt
 *      kỳ (ngày 5) thì tự soạn báo cáo giao ban gửi Telegram Ban Giám đốc
 *   7. Nhắc hạn cho người còn việc chưa làm
 *
 * Hai cách gọi:
 *   - Từ scheduler:  POST /api/cron/run  header  x-cron-secret: <CRON_SECRET>
 *     (chỉ header — không nhận ?secret= trên URL)
 *   - Bấm tay trong giao diện (Ban Giám đốc / quản trị đã đăng nhập)
 *
 * Chạy lại nhiều lần vẫn an toàn, không tạo dữ liệu trùng và không nhắc lặp.
 */
type Step = { name: string; run: () => Promise<unknown> };

const STEPS: Step[] = [
  { name: "kpiLock", run: runKpiLockCycle },
  // Gộp ca sản xuất đã khoá thành số liệu KPI tháng TRƯỚC khi đối soát,
  // để số của xưởng cũng phải đi qua bộ đối soát như iPOS và file Excel.
  { name: "productionSync", run: runProductionKpiSyncRecent },
  { name: "reconciliation", run: runReconciliation },
  { name: "kpiRecalculated", run: recalcOpenResults },
  { name: "riskScan", run: runRiskScan },
  // Phân tích chạy SAU cùng: nó đọc kết quả của mọi bước trên
  { name: "analytics", run: runAnalyticsCycle },
  { name: "reminders", run: runDeadlineReminders },
  { name: "staleMismatch", run: remindStaleMismatches },
];

const LOCK_NAME = "cron:run";

async function execute(req: Request) {
  // Chỉ nhận khoá qua header — query string bị ghi vào log truy cập.
  const secret = strongSecret("CRON_SECRET", 16);
  const provided = req.headers.get("x-cron-secret");

  let actorLabel = "CRON";
  if (!secret || !safeEqual(provided, secret)) {
    const user = await requireUser().catch(() => null);
    if (!user || (user.role !== "CEO" && user.role !== "ADMIN")) {
      return fail(
        "FORBIDDEN",
        "Cần khoá bí mật cron hoặc tài khoản Ban Giám đốc / quản trị.",
        403
      );
    }
    actorLabel = `MANUAL:${user.email}`;
  }

  if (!(await acquireJobLock(LOCK_NAME, maxDuration + 30))) {
    return fail(
      "CRON_BUSY",
      "Một lượt chạy nền khác đang diễn ra, thử lại sau ít phút.",
      409
    );
  }

  const results: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  try {
    // Mỗi bước tự bắt lỗi: một bước hỏng không được làm mất các bước sau
    // (nhất là nhắc hạn ở cuối).
    for (const step of STEPS) {
      try {
        results[step.name] = await step.run();
      } catch (e) {
        console.error(`[CRON] Bước ${step.name} lỗi:`, e);
        errors[step.name] = e instanceof Error ? e.message : String(e);
      }
    }
  } finally {
    await releaseJobLock(LOCK_NAME);
  }

  await writeAudit({
    actor: null,
    action: "CRON_RUN",
    entityName: "system",
    entityId: actorLabel,
    after: { ...results, errors },
  });

  return ok({
    ranAt: new Date().toISOString(),
    triggeredBy: actorLabel,
    ...results,
    errors,
  });
}

// Chỉ POST: GET chạy được bằng một đường link (CSRF qua cookie SameSite=Lax).
export async function POST(req: Request) {
  return handle(() => execute(req));
}
