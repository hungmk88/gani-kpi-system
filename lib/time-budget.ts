/**
 * NGÂN SÁCH THỜI GIAN cho việc nền chạy trong hàm serverless có trần cứng
 * (Vercel maxDuration = 60s): quá trần là hàm bị giết ngang, không kịp ghi
 * nhật ký, không kịp mở khoá. Nên mỗi bước / mỗi vòng lặp tự hỏi "còn đủ giờ
 * không" và DỪNG GỌN — phần còn lại để lượt cron sau làm tiếp (mọi bước đều
 * chạy lại an toàn).
 *
 * File thuần, không chạm DB — test được bằng vitest.
 */
export class TimeBudget {
  constructor(
    private readonly deadlineMs: number,
    private readonly clock: () => number = Date.now
  ) {}

  /** Ngân sách `ms` tính từ bây giờ. */
  static fromNow(ms: number, clock: () => number = Date.now) {
    return new TimeBudget(clock() + ms, clock);
  }

  /** Không giới hạn — mặc định khi gọi ngoài cron (bấm tay, test). */
  static unlimited() {
    return new TimeBudget(Number.POSITIVE_INFINITY);
  }

  remainingMs() {
    return this.deadlineMs - this.clock();
  }

  /** Hết giờ (còn ít hơn `reserveMs` thì cũng coi là hết). */
  expired(reserveMs = 0) {
    return this.remainingMs() <= reserveMs;
  }
}

export const OUT_OF_TIME_MESSAGE = "hết thời gian, lượt sau làm tiếp";

/** Ghi log thống nhất khi bỏ dở phần còn lại vì hết giờ. */
export function logOutOfTime(where: string, skipped?: number) {
  console.warn(
    `[CRON] ${where}: ${OUT_OF_TIME_MESSAGE}${skipped ? ` (bỏ ${skipped} mục)` : ""}`
  );
}

export type BoundedRunResult = { done: number; failed: number; skipped: number };

/**
 * Chạy `fn` cho từng phần tử, tối đa `limit` việc song song. Mỗi việc tự bắt
 * lỗi (một tin gửi hỏng không làm hỏng cả lượt). Hết ngân sách thì không mở
 * việc mới nữa — việc đang chạy dở vẫn được chờ xong.
 */
export async function runBounded<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<unknown>,
  opts: { budget?: TimeBudget; reserveMs?: number; label?: string } = {}
): Promise<BoundedRunResult> {
  const budget = opts.budget ?? TimeBudget.unlimited();
  const result: BoundedRunResult = { done: 0, failed: 0, skipped: 0 };
  let next = 0;
  let stopped = false;

  async function worker() {
    while (next < items.length) {
      if (budget.expired(opts.reserveMs ?? 0)) {
        stopped = true;
        return;
      }
      const item = items[next++];
      try {
        await fn(item);
        result.done++;
      } catch (e) {
        result.failed++;
        console.error(`[${opts.label ?? "BOUNDED"}] một việc lỗi (bỏ qua, chạy tiếp):`, e);
      }
    }
  }

  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  result.skipped = items.length - result.done - result.failed;
  if (stopped && result.skipped > 0) logOutOfTime(opts.label ?? "runBounded", result.skipped);
  return result;
}
