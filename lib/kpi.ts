import { vnDate } from "./vn-time";
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
 * Độ vênh giữa các nguồn số liệu, tính MỘT CÁCH DUY NHẤT cho toàn hệ thống
 * (cờ Data Mismatch trên dashboard và bộ đối soát đa nguồn cùng dùng hàm này,
 * để không có chuyện dashboard báo đỏ mà đối soát lại coi là khớp).
 *
 *   (lớn nhất − nhỏ nhất) / max(|lớn nhất|, |nhỏ nhất|, 1) × 100
 */
export function spreadPercent(values: number[]) {
  if (values.length < 2) return 0;
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const base = Math.max(Math.abs(maxValue), Math.abs(minValue), 1);
  return round2(((maxValue - minValue) / base) * 100);
}

/**
 * Đối soát số hệ thống (Excel/iPOS) với số nhân viên tự khai.
 * Lệch quá ngưỡng ±5% (theo spreadPercent) -> gắn cờ Data Mismatch.
 * mismatchPercent là độ lệch CÓ DẤU của số tự khai so với số hệ thống, chỉ
 * để hiển thị ("khai cao hơn 7%").
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
  const hasMismatch =
    spreadPercent([actualSystem, actualSelf]) > DATA_MISMATCH_THRESHOLD_PERCENT;
  if (actualSystem === 0) {
    return { hasMismatch, mismatchPercent: actualSelf === 0 ? 0 : 100 };
  }
  const diff = ((actualSelf - actualSystem) / Math.abs(actualSystem)) * 100;
  return { hasMismatch, mismatchPercent: round2(diff) };
}

/**
 * Lịch chốt 2-4-5: KPI của tháng M được chốt vào ngày 2/4/5 của tháng M+1,
 * mốc 23:59:59 giờ Việt Nam. Tính bằng lib/vn-time nên không phụ thuộc múi
 * giờ của server (Vercel chạy UTC, máy dev chạy giờ VN — kết quả như nhau).
 */
export function computeDeadlines(month: number, year: number) {
  // vnDate tự cuộn tháng 13 -> tháng 1 năm sau
  const at = (day: number) => vnDate(year, month + 1, day, 23, 59, 59);

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

/**
 * Tổng điểm đang ở giai đoạn nào — để KHÔNG xếp loại "Không đạt" cho một kỳ
 * chưa ai chấm (quản trị ngoại lệ: chưa tới hạn thì im lặng, không báo động).
 *
 * - UNSCORED: chưa có dòng nào qua bước tự khai → chưa có gì để chấm.
 * - PROVISIONAL: đã có số nhưng kỳ chưa chốt → điểm tạm tính, chưa xếp loại.
 * - FINAL: kỳ đã chốt (hoặc mọi dòng đã khoá) → xếp loại chính thức.
 */
export type ScoreState = "UNSCORED" | "PROVISIONAL" | "FINAL";

export function scoreStateOf(
  periodStatus: string | null | undefined,
  rows: { status: string }[]
): ScoreState {
  if (rows.length === 0) return "UNSCORED";
  if (periodStatus === "FINALIZED" || rows.every((r) => r.status === "FINALIZED")) {
    return "FINAL";
  }
  if (rows.every((r) => r.status === "DRAFT")) return "UNSCORED";
  return "PROVISIONAL";
}

/**
 * Dòng KPI có cần hiện / tính "chưa khai" không. Chỉ tiêu đã ngưng dùng mà
 * trọng số 0 thì không tính điểm, không cần khai — đưa vào chỉ đội số "chưa
 * khai" lên. Dùng chung để trang chủ, trang KPI và bảng làm việc đếm như nhau.
 */
export function isCountedKpiRow(r: {
  weightPercent: number | null;
  kpiDefinition?: { isActive: boolean } | null;
}) {
  return r.kpiDefinition?.isActive !== false || (r.weightPercent ?? 0) > 0;
}

/** Gộp trạng thái của nhiều nhóm (vd cả phòng): chỉ FINAL khi mọi nhóm FINAL. */
export function combineScoreStates(states: ScoreState[]): ScoreState {
  if (states.length === 0) return "UNSCORED";
  if (states.every((s) => s === "FINAL")) return "FINAL";
  if (states.every((s) => s === "UNSCORED")) return "UNSCORED";
  return "PROVISIONAL";
}

/** Nhãn + tông màu cho tổng điểm, có tính tới việc kỳ đã chấm hay chưa. */
export function classifyScoreFor(score: number, state: ScoreState) {
  if (state === "UNSCORED") return { label: "Chưa chấm", tone: "slate" as const };
  if (state === "PROVISIONAL") return { label: "Tạm tính", tone: "slate" as const };
  return classifyScore(score);
}

/** Xếp loại theo tổng điểm (thang 100). */
export function classifyScore(score: number) {
  if (score >= 120) return { label: "Xuất sắc", tone: "emerald" as const };
  if (score >= 100) return { label: "Tốt", tone: "green" as const };
  if (score >= 85) return { label: "Đạt", tone: "sky" as const };
  if (score >= 70) return { label: "Cần cải thiện", tone: "amber" as const };
  return { label: "Không đạt", tone: "red" as const };
}
