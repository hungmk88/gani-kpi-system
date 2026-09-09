import {
  DATA_MISMATCH_THRESHOLD_PERCENT,
  KPI_DEADLINE_DAYS,
  KPI_SCORE_CAP,
} from "./constants";

export type KpiCalcInput = {
  target: number;
  actual: number | null | undefined;
  weight: number;
  isHigherBetter: boolean;
  /**
   * Trần riêng cho chỉ tiêu này, ghi đè KPI_SCORE_CAP (150%) mặc định toàn
   * công ty. Dùng khi một phòng ban có chính sách trần khác — vd Sales chốt
   * 120% theo "GANI_FOODY_Tai_lieu_truyen_thong_KPI_Doi_Sales" (10/09/2026).
   */
  cap?: number;
};

export type KpiCalcOutput = {
  achievementPercent: number;
  weightedScore: number;
  isCapped: boolean;
  rawAchievementPercent: number;
};

/**
 * CÔNG THỨC KPI CHÍNH THỨC (CEO chốt: thang 100, cho vượt, cap 150%).
 *
 *   Càng cao càng tốt:  Achievement% = Actual / Target * 100
 *   Càng thấp càng tốt: Achievement% = Target / Actual * 100
 *   Achievement% = min(Achievement%, 150)
 *   Weighted Score = Achievement% * Weight% / 100
 *
 * Tổng điểm cuối kỳ = tổng các Weighted Score (tổng trọng số nên bằng 100%).
 */
export function calculateKpiScore({
  target,
  actual,
  weight,
  isHigherBetter,
  cap = KPI_SCORE_CAP,
}: KpiCalcInput): KpiCalcOutput {
  const zero = {
    achievementPercent: 0,
    weightedScore: 0,
    isCapped: false,
    rawAchievementPercent: 0,
  };

  if (actual === null || actual === undefined || !Number.isFinite(actual)) {
    return zero;
  }

  let raw: number;

  if (isHigherBetter) {
    if (target === 0) return zero; // không có chỉ tiêu thì không chấm
    raw = (actual / target) * 100;
  } else {
    // Càng thấp càng tốt
    if (actual === 0) {
      // Chỉ tiêu cũng là 0 (vd: "0 sự cố an toàn") mà thực tế 0 -> ĐẠT ĐÚNG
      // mục tiêu, không phải vượt. Cho 100%, không cho trần 150% — nếu không
      // thì chỉ cần không để xảy ra sự cố là ăn điểm tối đa, bất công với
      // những chỉ tiêu phải cày mới vượt được.
      if (target === 0) {
        raw = 100;
      } else {
        // Chỉ tiêu cho phép sai sót (vd: dưới 1,5% hàng lỗi) mà thực tế bằng 0
        // -> vượt xa mục tiêu, cho chạm trần.
        raw = cap;
      }
    } else {
      if (target === 0) {
        // Chỉ tiêu là 0 mà thực tế > 0 -> không đạt
        return { ...zero, rawAchievementPercent: 0 };
      }
      raw = (target / actual) * 100;
    }
  }

  if (raw < 0) raw = 0;

  // "Chạm trần" tính cả trường hợp đúng bằng mức trần — giao diện ghi là "chạm
  // trần X%" nên đạt đúng mức trần cũng phải hiện, không chỉ khi vượt qua.
  const isCapped = raw >= cap;
  const achievementPercent = isCapped ? cap : raw;
  const weightedScore = (achievementPercent * weight) / 100;

  return {
    achievementPercent: round2(achievementPercent),
    weightedScore: round2(weightedScore),
    isCapped,
    rawAchievementPercent: round2(raw),
  };
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Đối soát số hệ thống (Excel/iPOS) với số nhân viên tự khai.
 * Lệch quá ngưỡng ±5% -> gắn cờ Data Mismatch để CEO Dashboard báo đỏ.
 */
export function detectMismatch(
  actualSystem: number | null | undefined,
  actualSelf: number | null | undefined
): { hasMismatch: boolean; mismatchPercent: number | null } {
  if (
    actualSystem === null ||
    actualSystem === undefined ||
    actualSelf === null ||
    actualSelf === undefined
  ) {
    return { hasMismatch: false, mismatchPercent: null };
  }
  if (actualSystem === 0) {
    const has = actualSelf !== 0;
    return { hasMismatch: has, mismatchPercent: has ? 100 : 0 };
  }
  const diff = ((actualSelf - actualSystem) / Math.abs(actualSystem)) * 100;
  return {
    hasMismatch: Math.abs(diff) > DATA_MISMATCH_THRESHOLD_PERCENT,
    mismatchPercent: round2(diff),
  };
}

/**
 * Lịch chốt 2-4-5: KPI của tháng M được chốt vào ngày 2/4/5 của tháng M+1.
 * Trả về mốc 23:59:59 theo giờ máy chủ.
 */
export function computeDeadlines(month: number, year: number) {
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  const at = (day: number) =>
    new Date(nextYear, nextMonth - 1, day, 23, 59, 59, 0);

  return {
    selfReviewDeadline: at(KPI_DEADLINE_DAYS.SELF_REVIEW),
    managerReviewDeadline: at(KPI_DEADLINE_DAYS.MANAGER_REVIEW),
    ceoApprovalDeadline: at(KPI_DEADLINE_DAYS.CEO_APPROVAL),
  };
}

/** Kiểm tra nhân viên còn được sửa self-review không. */
export function isSelfReviewOpen(period: {
  status: string;
  selfReviewDeadline: Date;
}) {
  if (period.status !== "OPEN") return false;
  return new Date() <= new Date(period.selfReviewDeadline);
}

/** Kiểm tra trưởng phòng còn được duyệt/chỉnh không. */
export function isManagerReviewOpen(period: {
  status: string;
  managerReviewDeadline: Date;
}) {
  if (period.status === "MANAGER_LOCKED" || period.status === "FINALIZED")
    return false;
  return new Date() <= new Date(period.managerReviewDeadline);
}

/** Tổng hợp điểm cuối kỳ của 1 nhân viên. */
export function summarizeResults(
  results: {
    weightPercent: number | null;
    weightedScore: number;
    achievementPercent: number;
  }[]
) {
  const totalWeight = round2(
    results.reduce((s, r) => s + (r.weightPercent ?? 0), 0)
  );
  const totalScore = round2(results.reduce((s, r) => s + r.weightedScore, 0));
  return { totalWeight, totalScore, count: results.length };
}

/** Xếp loại theo tổng điểm (thang 100). */
export function classifyScore(score: number) {
  if (score >= 120) return { label: "Xuất sắc", tone: "emerald" as const };
  if (score >= 100) return { label: "Tốt", tone: "green" as const };
  if (score >= 85) return { label: "Đạt", tone: "sky" as const };
  if (score >= 70) return { label: "Cần cải thiện", tone: "amber" as const };
  return { label: "Không đạt", tone: "red" as const };
}

export function formatNumber(n: number | null | undefined, unit?: string) {
  if (n === null || n === undefined) return "—";
  const s = new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: 2,
  }).format(n);
  return unit ? `${s} ${unit}` : s;
}
