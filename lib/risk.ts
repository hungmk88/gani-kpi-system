import { BLOCKED_ALERT_HOURS } from "./constants";

export type RiskInput = {
  status: string;
  priority: string;
  progress: number;
  startDate: Date | null;
  dueDate: Date;
  blockedSince: Date | null;
  assigneeId: string | null;
  /**
   * Số việc người phụ trách đang làm dở (IN_PROGRESS). Quá 5 việc là quá tải.
   * Không truyền thì bỏ qua yếu tố này.
   */
  assigneeActiveTaskCount?: number;
  /**
   * Tên những việc mà việc này đang phải chờ, và bản thân chúng đã trễ hạn.
   * Việc đứng sau một mắt xích đã gãy thì gần như chắc chắn cũng gãy.
   */
  lateBlockers?: string[];
};

export type RiskOutput = {
  score: number;
  level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  reasons: string[];
  reason: string;
};

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** Ôm quá số việc dở dang này cùng lúc thì coi là quá tải (theo tài liệu thiết kế). */
export const OVERLOAD_THRESHOLD = 5;

function shorten(s: string, n = 40) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/**
 * RISK ENGINE (Phase 1 - luật cứng, không cần AI).
 *
 * Chấm điểm rủi ro 0-100 cho từng task dựa trên: trễ hạn, mức ưu tiên,
 * thời gian bị chặn, tiến độ thực tế so với tiến độ đáng lẽ phải có,
 * và việc chưa có người nhận.
 *
 * Phase 2 sẽ bọc thêm 1 lớp AI để giải thích nguyên nhân bằng ngôn ngữ tự nhiên,
 * nhưng điểm số nền vẫn lấy từ hàm này để tránh AI "chấm cảm tính".
 */
export function scoreTaskRisk(t: RiskInput, now = new Date()): RiskOutput {
  const reasons: string[] = [];
  let score = 0;

  if (t.status === "DONE" || t.status === "CANCELLED") {
    return { score: 0, level: "LOW", reasons: [], reason: "" };
  }

  const due = new Date(t.dueDate).getTime();
  const nowMs = now.getTime();

  // 1. Trễ hạn
  if (nowMs > due) {
    const daysLate = Math.floor((nowMs - due) / DAY) + 1;
    const pts = Math.min(50, daysLate * 15);
    score += pts;
    reasons.push(`Trễ hạn ${daysLate} ngày`);
  } else {
    const hoursLeft = (due - nowMs) / HOUR;
    if (hoursLeft <= 24 && t.progress < 80) {
      score += 15;
      reasons.push(`Còn dưới 24h nhưng mới xong ${t.progress}%`);
    } else if (hoursLeft <= 72 && t.progress < 40) {
      score += 8;
      reasons.push(`Còn dưới 3 ngày nhưng mới xong ${t.progress}%`);
    }
  }

  // 2. Mức ưu tiên
  if (t.priority === "CRITICAL") {
    score += 25;
    reasons.push("Việc khẩn cấp");
  } else if (t.priority === "HIGH") {
    score += 15;
    reasons.push("Việc ưu tiên cao");
  } else if (t.priority === "MEDIUM") {
    score += 5;
  }

  // 3. Bị chặn quá lâu
  if (t.status === "BLOCKED") {
    const since = t.blockedSince ? new Date(t.blockedSince).getTime() : nowMs;
    const blockedHours = (nowMs - since) / HOUR;
    if (blockedHours >= BLOCKED_ALERT_HOURS) {
      const extraDays = Math.floor(blockedHours / 24);
      score += Math.min(30, 20 + extraDays * 5);
      reasons.push(`Bị chặn ${Math.round(blockedHours)} giờ chưa gỡ`);
    } else {
      score += 10;
      reasons.push("Đang bị chặn");
    }
  }

  // 4. Chưa có người nhận
  if (!t.assigneeId) {
    score += 15;
    reasons.push("Chưa giao cho ai");
  }

  // 5. Tiến độ tụt so với đường thẳng thời gian
  if (t.startDate && nowMs < due) {
    const start = new Date(t.startDate).getTime();
    const total = due - start;
    if (total > 0) {
      const expected = Math.round(((nowMs - start) / total) * 100);
      const gap = expected - t.progress;
      if (gap >= 40) {
        score += 15;
        reasons.push(`Tiến độ chậm ${gap}% so với kế hoạch`);
      } else if (gap >= 20) {
        score += 8;
        reasons.push(`Tiến độ chậm ${gap}% so với kế hoạch`);
      }
    }
  }

  // 6. Chưa động vào dù đã tới hạn khởi động
  if (t.status === "TO_DO" && t.startDate && nowMs > new Date(t.startDate).getTime() + DAY) {
    score += 10;
    reasons.push("Quá ngày bắt đầu mà chưa động tới");
  }

  // 7. Người phụ trách đang ôm quá nhiều việc dở dang
  const load = t.assigneeActiveTaskCount ?? 0;
  if (load > OVERLOAD_THRESHOLD) {
    const extra = load - OVERLOAD_THRESHOLD;
    score += Math.min(25, 20 + (extra - 1) * 5);
    reasons.push(`Người phụ trách đang ôm ${load} việc cùng lúc`);
  }

  // 8. Đang đứng chờ một việc khác đã trễ
  const blockers = t.lateBlockers ?? [];
  if (blockers.length > 0) {
    score += Math.min(25, 20 + (blockers.length - 1) * 5);
    reasons.push(
      blockers.length === 1
        ? `Phải chờ việc đang trễ: ${shorten(blockers[0])}`
        : `Phải chờ ${blockers.length} việc đang trễ`
    );
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    level: riskLevel(score),
    reasons,
    reason: reasons.join(" · "),
  };
}

export function riskLevel(score: number): RiskOutput["level"] {
  if (score >= 80) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

export const RISK_LEVEL_LABEL: Record<string, string> = {
  LOW: "Bình thường",
  MEDIUM: "Cần theo dõi",
  HIGH: "Nguy cơ cao",
  CRITICAL: "Báo động đỏ",
};
