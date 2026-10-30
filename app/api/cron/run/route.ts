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
import { logOutOfTime, TimeBudget } from "@/lib/time-budget";

export const runtime = "nodejs";
// Tám bước chạy tuần tự, mỗi bước gọi Postgres qua pooler — vượt quá 10s mặc
// định của Vercel. 60s là trần cho phép của gói Hobby (xem STEP_BUDGET_MS).
export const maxDuration = 60;

/**
 * Bộ máy chạy nền. Các việc chạy theo đúng thứ tự này:
 *
 *   1. Khoá KPI theo lịch 2-4-5
 *   2. Gộp ca sản xuất đã khoá thành số liệu KPI tháng
 *   3. Đối soát dữ liệu đa nguồn (khớp thì đồng bộ, lệch thì treo lại)
 *   4. Tính lại điểm các dòng chưa chốt
 *   5. Nhắc hạn cho người còn việc chưa làm (cần kết quả bước 1)
 *   6. Nhắc Ban Giám đốc ô KPI treo vì lệch số (cần kết quả bước 3)
 *   7. Quét rủi ro toàn bộ công việc
 *   8. Chấm lại dự báo cũ, dự báo mới, quét bất thường KPI, và đúng ngày chốt
 *      kỳ (ngày 5) thì tự soạn báo cáo giao ban gửi Telegram Ban Giám đốc
 *
 * Nhắc hạn (5, 6) chạy TRƯỚC các bước chậm (7, 8 — nhiều Telegram, gọi
 * Gemini): nhắc hạn là việc có giờ giấc, trễ một lượt là người ta lỡ hạn; còn
 * quét rủi ro/phân tích trễ 2 tiếng không sao.
 *
 * NGÂN SÁCH THỜI GIAN: Vercel giết hàm ở giây 60 — không kịp ghi nhật ký,
 * không kịp mở khoá. Mỗi bước (và vòng lặp gửi tin bên trong) tự kiểm hạn
 * chót; hết giờ thì bỏ phần còn lại, log "hết thời gian, lượt sau làm tiếp".
 * Mọi bước đều chạy lại an toàn nên lượt sau làm nốt.
 *
 * Hai cách gọi:
 *   - Từ scheduler:  POST /api/cron/run  header  x-cron-secret: <CRON_SECRET>
 *     (chỉ header — không nhận ?secret= trên URL)
 *   - Bấm tay trong giao diện (Ban Giám đốc / quản trị đã đăng nhập)
 *
 * Chạy lại nhiều lần vẫn an toàn, không tạo dữ liệu trùng và không nhắc lặp.
 */
type Step = {
  name: string;
  /** Còn dưới chừng này mili-giây thì không bắt đầu bước này */
  minMs: number;
  run: (budget: TimeBudget) => Promise<unknown>;
};

/**
 * Ngân sách cho các bước: chừa ~20s dưới trần 60s cho một lệnh gọi ngoài đang
 * dở (Telegram tối đa 15s), ghi nhật ký và mở khoá.
 */
const STEP_BUDGET_MS = 40_000;

const STEPS: Step[] = [
  { name: "kpiLock", minMs: 3000, run: () => runKpiLockCycle() },
  // Gộp ca sản xuất đã khoá thành số liệu KPI tháng TRƯỚC khi đối soát,
  // để số của xưởng cũng phải đi qua bộ đối soát như iPOS và file Excel.
  { name: "productionSync", minMs: 3000, run: () => runProductionKpiSyncRecent() },
  { name: "reconciliation", minMs: 3000, run: () => runReconciliation() },
  { name: "kpiRecalculated", minMs: 3000, run: () => recalcOpenResults() },
  { name: "reminders", minMs: 3000, run: (b) => runDeadlineReminders(new Date(), b) },
  { name: "staleMismatch", minMs: 3000, run: () => remindStaleMismatches() },
  { name: "riskScan", minMs: 5000, run: (b) => runRiskScan(new Date(), b) },
  // Phân tích chạy SAU cùng: nó đọc kết quả của mọi bước trên
  { name: "analytics", minMs: 5000, run: (b) => runAnalyticsCycle(new Date(), b) },
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

  const budget = TimeBudget.fromNow(STEP_BUDGET_MS);
  const lock = await acquireJobLock(LOCK_NAME, maxDuration + 30);
  if (!lock) {
    return fail(
      "CRON_BUSY",
      "Một lượt chạy nền khác đang diễn ra, thử lại sau ít phút.",
      409
    );
  }

  const results: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  const skipped: string[] = [];
  try {
    // Mỗi bước tự bắt lỗi: một bước hỏng không được làm mất các bước sau.
    for (const step of STEPS) {
      if (budget.expired(step.minMs)) {
        skipped.push(step.name);
        continue;
      }
      try {
        results[step.name] = await step.run(budget);
      } catch (e) {
        console.error(`[CRON] Bước ${step.name} lỗi:`, e);
        errors[step.name] = e instanceof Error ? e.message : String(e);
      }
    }
    if (skipped.length) logOutOfTime(`bỏ các bước ${skipped.join(", ")}`);
  } finally {
    await releaseJobLock(lock);
  }

  await writeAudit({
    actor: null,
    action: "CRON_RUN",
    entityName: "system",
    entityId: actorLabel,
    after: { ...results, errors, skippedOutOfTime: skipped },
  });

  return ok({
    ranAt: new Date().toISOString(),
    triggeredBy: actorLabel,
    ...results,
    errors,
    skippedOutOfTime: skipped,
  });
}

// Chỉ POST: GET chạy được bằng một đường link (CSRF qua cookie SameSite=Lax).
export async function POST(req: Request) {
  return handle(() => execute(req));
}
