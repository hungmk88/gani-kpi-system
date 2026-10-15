import { prisma } from "@/lib/db";
import { BusinessError } from "@/lib/rbac";
import { ERR } from "@/lib/constants";
import type { SessionUser } from "@/lib/auth";
import { SHIFT_TYPES } from "@/lib/production/constants";
import { SHIFT_SCORE_CAP } from "@/lib/kpi-calculator";
import {
  addDays,
  vnDateKey,
  vnDayRange,
  vnMonthRange,
  vnParts,
  vnStartOfDay,
} from "@/lib/vn-time";
import { canSeeMoney, withProductionRole } from "./production-service";

/**
 * Lõi tính toán cho Dashboard KPI sản xuất (/admin/kpi-dashboard).
 *
 * Tách riêng khỏi 3 route summary/distribution/trends để route xuất báo cáo
 * (Excel + PDF) dùng lại đúng công thức, không tính lại một lần nữa theo cách
 * khác — tránh số trên màn hình và số trong báo cáo lệch nhau.
 *
 * Mọi mốc ngày (hôm nay / tuần / tháng / nhóm theo ngày) tính theo LỊCH VIỆT
 * NAM qua lib/vn-time — không dựa vào múi giờ của server.
 */

export type DashboardPeriod = "today" | "week" | "month";

export const PERIOD_LABEL: Record<DashboardPeriod, string> = {
  today: "Hôm nay",
  week: "Tuần này",
  month: "Tháng này",
};

export function normalizePeriod(p: string | null | undefined): DashboardPeriod {
  return p === "week" || p === "month" ? p : "today";
}

/* ------------------------------------------------------------ PHÂN QUYỀN */

/**
 * Dashboard KPI sản xuất: chỉ Ban Giám đốc và quản trị hệ thống (như trước).
 * Trả kèm cờ được xem tiền — tiền thưởng chỉ CEO / Giám đốc SX được thấy.
 */
export async function assertDashboardAccess(user: SessionUser) {
  if (user.role !== "CEO" && user.role !== "ADMIN") {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Chỉ Ban Giám đốc và quản trị hệ thống mới xem được Dashboard KPI sản xuất.",
      403
    );
  }
  return { includeMoney: canSeeMoney(await withProductionRole(user)) };
}

const MONEY_KEYS = new Set([
  "bonusAmount",
  "totalBonus",
  "avgBonus",
  "totalBonusDistributed",
]);

/**
 * Xoá (đặt null) mọi trường tiền thưởng trong kết quả dashboard, cho người
 * không được xem tiền. Kiểu trả về giữ nguyên để dùng lại chỗ cũ — phía hiển
 * thị phải coi null = "ẩn".
 */
export function redactDashboardMoney<T>(data: T): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object" && !(v instanceof Date)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([k, val]) => [
          k,
          MONEY_KEYS.has(k) ? null : walk(val),
        ])
      );
    }
    return v;
  };
  return walk(data) as T;
}

/* ------------------------------------------------------------ KHOẢNG NGÀY */

function periodRange(period: DashboardPeriod, now = new Date()) {
  switch (period) {
    case "week": {
      // Tuần Việt Nam bắt đầu thứ Hai.
      const today = vnStartOfDay(now);
      const sinceMonday = (vnParts(now).weekday + 6) % 7;
      const gte = addDays(today, -sinceMonday);
      return { gte, lt: addDays(gte, 7) };
    }
    case "month": {
      const p = vnParts(now);
      return vnMonthRange(p.year, p.month);
    }
    case "today":
    default:
      return vnDayRange(now);
  }
}

const round2 = (n: number) => parseFloat(n.toFixed(2));
const avgOf = (xs: number[]) =>
  xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

/* ================================================================ SUMMARY */

export async function getDashboardSummary(periodInput: DashboardPeriod | string) {
  const period = normalizePeriod(periodInput);
  const scores = await prisma.shiftKpiScore.findMany({
    where: { shiftLog: { shiftDate: periodRange(period) } },
    select: {
      totalScore: true,
      bonusAmount: true,
      status: true,
      shiftLog: { select: { shiftDate: true, shiftType: true } },
    },
  });

  const totalShifts = scores.length;
  const avgScore = avgOf(scores.map((s) => s.totalScore)) ?? 0;
  const totalBonus = scores.reduce((sum, s) => sum + s.bonusAmount, 0);
  const avgBonus = totalShifts > 0 ? totalBonus / totalShifts : 0;

  const statusCounts = {
    CALCULATED: scores.filter((s) => s.status === "CALCULATED").length,
    APPROVED: scores.filter((s) => s.status === "APPROVED").length,
    DRAFT: scores.filter((s) => s.status === "DRAFT").length,
  };

  // Mã ca thật trong ProductionShiftLog là CA_1 / CA_2 / CA_3 (xem
  // lib/production/constants.ts) — bản cũ đếm MORNING/AFTERNOON/NIGHT nên luôn ra 0.
  const shiftTypes: Record<string, number> = Object.fromEntries(
    SHIFT_TYPES.map((t) => [t, scores.filter((s) => s.shiftLog.shiftType === t).length])
  );

  return {
    period,
    timestamp: new Date(),
    summary: {
      totalShifts,
      avgScore: round2(avgScore),
      totalBonus: Math.round(totalBonus),
      avgBonus: Math.round(avgBonus),
      percentApproved:
        totalShifts > 0 ? Math.round((statusCounts.APPROVED / totalShifts) * 100) : 0,
    },
    statusCounts,
    shiftTypes,
    topScores: [...scores]
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, 5)
      .map((s) => ({
        shiftDate: s.shiftLog.shiftDate,
        shiftType: s.shiftLog.shiftType,
        totalScore: s.totalScore,
        bonusAmount: s.bonusAmount,
        status: s.status,
      })),
  };
}

/* ============================================================ DISTRIBUTION */

/**
 * Khoảng điểm — khớp thang điểm ca (100 = đạt kế hoạch, trần SHIFT_SCORE_CAP =
 * 150) và mốc bậc thưởng 90 / 100 / 120 trong BonusConfig.
 */
const BUCKETS = [
  { range: "0-50", max: 50 },
  { range: "50-75", max: 75 },
  { range: "75-90", max: 90 },
  { range: "90-100", max: 100 },
  { range: "100-120", max: 120 },
  { range: `120-${SHIFT_SCORE_CAP}`, max: Infinity },
] as const;

const DISTRIBUTION_DAYS = 30;

export async function getDashboardDistribution() {
  const today = vnStartOfDay();
  const scores = await prisma.shiftKpiScore.findMany({
    where: {
      shiftLog: {
        shiftDate: { gte: addDays(today, -(DISTRIBUTION_DAYS - 1)), lt: addDays(today, 1) },
      },
    },
    select: { totalScore: true },
  });

  const validScores = scores.map((s) => s.totalScore);
  const distribution: Record<string, number> = Object.fromEntries(
    BUCKETS.map((b) => [b.range, 0])
  );
  for (const s of validScores) {
    const bucket = BUCKETS.find((b) => s < b.max) ?? BUCKETS[BUCKETS.length - 1];
    distribution[bucket.range]++;
  }

  const avg = avgOf(validScores) ?? 0;
  const sorted = [...validScores].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length === 0
      ? 0
      : sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
  const stdDev =
    validScores.length > 0
      ? Math.sqrt(
          validScores.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) /
            validScores.length
        )
      : 0;

  return {
    period: "last_30_days",
    distribution,
    statistics: {
      count: validScores.length,
      average: round2(avg),
      median: round2(median),
      stdDev: round2(stdDev),
      min: validScores.length > 0 ? Math.min(...validScores) : 0,
      max: validScores.length > 0 ? Math.max(...validScores) : 0,
    },
    chartData: BUCKETS.map((b) => ({
      range: b.range as string,
      count: distribution[b.range],
      percentage:
        validScores.length > 0
          ? Math.round((distribution[b.range] / validScores.length) * 100)
          : 0,
    })),
  };
}

/* ================================================================== TRENDS */

const MOVING_AVG_WINDOW = 3;

/** Xu hướng `numDays` ngày lịch VN gần nhất, tính cả hôm nay. */
export async function getDashboardTrends(numDaysInput: number) {
  const numDays = Math.min(90, Math.max(1, Math.floor(numDaysInput) || 7));
  const today = vnStartOfDay();
  const start = addDays(today, -(numDays - 1));

  const scores = await prisma.shiftKpiScore.findMany({
    where: { shiftLog: { shiftDate: { gte: start, lt: addDays(today, 1) } } },
    select: {
      totalScore: true,
      output_achievement: true,
      waste_achievement: true,
      bonusAmount: true,
      shiftLog: { select: { shiftDate: true } },
    },
  });

  const groupedByDate = new Map<string, typeof scores>();
  for (const score of scores) {
    const key = vnDateKey(score.shiftLog.shiftDate);
    const arr = groupedByDate.get(key);
    if (arr) arr.push(score);
    else groupedByDate.set(key, [score]);
  }

  const trendData = Array.from({ length: numDays }, (_, i) => {
    const day = addDays(start, i);
    const dateKey = vnDateKey(day);
    const p = vnParts(day);
    const dayScores = groupedByDate.get(dateKey) ?? [];

    // Ngày không có ca → null (không phải 0). Trung bình đúng bằng 0 vẫn là 0.
    const avgScore = avgOf(dayScores.map((s) => s.totalScore));
    const avgOutput = avgOf(dayScores.map((s) => s.output_achievement));
    const avgWaste = avgOf(dayScores.map((s) => s.waste_achievement));

    return {
      date: dateKey,
      displayDate: `${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}`,
      shiftCount: dayScores.length,
      avgScore: avgScore === null ? null : round2(avgScore),
      avgOutput: avgOutput === null ? null : round2(avgOutput),
      avgWaste: avgWaste === null ? null : round2(avgWaste),
      totalBonus: Math.round(dayScores.reduce((sum, s) => sum + s.bonusAmount, 0)),
    };
  });

  // Trung bình trượt 3 ngày: chỉ lấy những ngày CÓ dữ liệu trong cửa sổ —
  // ngày nghỉ không kéo đường xuống 0. Cả cửa sổ trống → null.
  const movingAvg = trendData.map((_, idx) => {
    const windowVals = trendData
      .slice(Math.max(0, idx - MOVING_AVG_WINDOW + 1), idx + 1)
      .map((d) => d.avgScore)
      .filter((v): v is number => v !== null);
    const a = avgOf(windowVals);
    return a === null ? null : round2(a);
  });

  return {
    period: `${numDays}_days`,
    trendData: trendData.map((d, idx) => ({ ...d, movingAvg: movingAvg[idx] })),
    statistics: {
      daysWithData: trendData.filter((d) => d.shiftCount > 0).length,
      totalShifts: scores.length,
      avgDailyScore: round2(avgOf(scores.map((s) => s.totalScore)) ?? 0),
      totalBonusDistributed: Math.round(
        trendData.reduce((sum, d) => sum + d.totalBonus, 0)
      ),
    },
  };
}

export type DashboardSummaryResult = Awaited<ReturnType<typeof getDashboardSummary>>;
export type DashboardDistributionResult = Awaited<
  ReturnType<typeof getDashboardDistribution>
>;
export type DashboardTrendsResult = Awaited<ReturnType<typeof getDashboardTrends>>;
