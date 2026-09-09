import { prisma } from "@/lib/db";
import {
  startOfDay,
  startOfWeek,
  startOfMonth,
  subDays,
  format,
  eachDayOfInterval,
} from "date-fns";

/**
 * Lõi tính toán cho Dashboard KPI sản xuất (/admin/kpi-dashboard).
 *
 * Tách riêng khỏi 3 route summary/distribution/trends để route xuất báo cáo
 * (Excel + PDF) dùng lại đúng công thức, không tính lại một lần nữa theo cách
 * khác — tránh số trên màn hình và số trong báo cáo lệch nhau.
 */

export type DashboardPeriod = "today" | "week" | "month";

export const PERIOD_LABEL: Record<DashboardPeriod, string> = {
  today: "Hôm nay",
  week: "Tuần này",
  month: "Tháng này",
};

export async function getDashboardSummary(period: DashboardPeriod | string) {
  let dateFilter;
  const now = new Date();

  switch (period) {
    case "today":
      dateFilter = {
        shiftDate: {
          gte: startOfDay(now),
          lt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
      };
      break;
    case "week":
      dateFilter = {
        shiftDate: {
          gte: startOfWeek(now),
          lt: new Date(startOfWeek(now).getTime() + 7 * 24 * 60 * 60 * 1000),
        },
      };
      break;
    case "month":
      dateFilter = {
        shiftDate: {
          gte: startOfMonth(now),
          lt: new Date(now.getFullYear(), now.getMonth() + 1, 1),
        },
      };
      break;
    default:
      dateFilter = {
        shiftDate: {
          gte: startOfDay(now),
          lt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
      };
  }

  const scores = await prisma.shiftKpiScore.findMany({
    where: { shiftLog: dateFilter },
    include: { shiftLog: true },
  });

  const totalShifts = scores.length;
  const avgScore =
    totalShifts > 0
      ? scores.reduce((sum, s) => sum + s.totalScore, 0) / totalShifts
      : 0;
  const totalBonus = scores.reduce((sum, s) => sum + s.bonusAmount, 0);
  const avgBonus = totalShifts > 0 ? totalBonus / totalShifts : 0;

  const statusCounts = {
    CALCULATED: scores.filter((s) => s.status === "CALCULATED").length,
    APPROVED: scores.filter((s) => s.status === "APPROVED").length,
    DRAFT: scores.filter((s) => s.status === "DRAFT").length,
  };

  const shiftTypes = {
    MORNING: scores.filter((s) => s.shiftLog.shiftType === "MORNING").length,
    AFTERNOON: scores.filter((s) => s.shiftLog.shiftType === "AFTERNOON")
      .length,
    NIGHT: scores.filter((s) => s.shiftLog.shiftType === "NIGHT").length,
  };

  return {
    period,
    timestamp: new Date(),
    summary: {
      totalShifts,
      avgScore: parseFloat(avgScore.toFixed(2)),
      totalBonus: Math.round(totalBonus),
      avgBonus: Math.round(avgBonus),
      percentApproved:
        totalShifts > 0
          ? Math.round((statusCounts.APPROVED / totalShifts) * 100)
          : 0,
    },
    statusCounts,
    shiftTypes,
    topScores: scores
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

export async function getDashboardDistribution() {
  const thirtyDaysAgo = subDays(new Date(), 30);
  const scores = await prisma.shiftKpiScore.findMany({
    where: { shiftLog: { shiftDate: { gte: thirtyDaysAgo } } },
    select: {
      totalScore: true,
      shiftLog: { select: { shiftDate: true } },
    },
    orderBy: { shiftLog: { shiftDate: "asc" } },
  });

  const distribution = {
    "0-50": 0,
    "50-75": 0,
    "75-90": 0,
    "90-100": 0,
    "100-120": 0,
    "120+": 0,
  };

  scores.forEach((score) => {
    const s = score.totalScore;
    if (s < 50) distribution["0-50"]++;
    else if (s < 75) distribution["50-75"]++;
    else if (s < 90) distribution["75-90"]++;
    else if (s < 100) distribution["90-100"]++;
    else if (s < 120) distribution["100-120"]++;
    else distribution["120+"]++;
  });

  const validScores = scores.map((s) => s.totalScore);
  const avg =
    validScores.length > 0
      ? validScores.reduce((a, b) => a + b, 0) / validScores.length
      : 0;
  const sorted = [...validScores].sort((a, b) => a - b);
  // Mảng rỗng thì length % 2 === 0 đúng luôn, ra sorted[-1] + sorted[0] =
  // undefined + undefined = NaN — JSON hoá thành null, làm .toFixed() ở màn
  // hình vỡ ngay khi chưa có ca nào trong 30 ngày. Chặn riêng trường hợp rỗng.
  const median =
    sorted.length === 0
      ? 0
      : sorted.length % 2 === 0
        ? (sorted[Math.floor(sorted.length / 2) - 1] +
            sorted[Math.floor(sorted.length / 2)]) /
          2
        : sorted[Math.floor(sorted.length / 2)];
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
      average: parseFloat(avg.toFixed(2)),
      median: parseFloat(median.toFixed(2)),
      stdDev: parseFloat(stdDev.toFixed(2)),
      min: validScores.length > 0 ? Math.min(...validScores) : 0,
      max: validScores.length > 0 ? Math.max(...validScores) : 0,
    },
    chartData: [
      { range: "0-50", count: distribution["0-50"], percentage: 0 },
      { range: "50-75", count: distribution["50-75"], percentage: 0 },
      { range: "75-90", count: distribution["75-90"], percentage: 0 },
      { range: "90-100", count: distribution["90-100"], percentage: 0 },
      { range: "100-120", count: distribution["100-120"], percentage: 0 },
      { range: "120+", count: distribution["120+"], percentage: 0 },
    ].map((item) => ({
      ...item,
      percentage:
        validScores.length > 0
          ? Math.round((item.count / validScores.length) * 100)
          : 0,
    })),
  };
}

export async function getDashboardTrends(numDays: number) {
  const endDate = new Date();
  const startDate = subDays(endDate, numDays);

  const scores = await prisma.shiftKpiScore.findMany({
    where: {
      shiftLog: { shiftDate: { gte: startDate, lte: endDate } },
    },
    include: {
      shiftLog: { select: { shiftDate: true } },
    },
  });

  const groupedByDate = new Map<string, typeof scores>();
  scores.forEach((score) => {
    const dateKey = format(score.shiftLog.shiftDate, "yyyy-MM-dd");
    if (!groupedByDate.has(dateKey)) {
      groupedByDate.set(dateKey, []);
    }
    groupedByDate.get(dateKey)!.push(score);
  });

  const trendData = eachDayOfInterval({ start: startDate, end: endDate }).map(
    (date) => {
      const dateKey = format(date, "yyyy-MM-dd");
      const dayScores = groupedByDate.get(dateKey) || [];

      const avgScore =
        dayScores.length > 0
          ? dayScores.reduce((sum, s) => sum + s.totalScore, 0) /
            dayScores.length
          : null;

      const avgOutput =
        dayScores.length > 0
          ? dayScores.reduce((sum, s) => sum + s.output_achievement, 0) /
            dayScores.length
          : null;

      const avgWaste =
        dayScores.length > 0
          ? dayScores.reduce((sum, s) => sum + s.waste_achievement, 0) /
            dayScores.length
          : null;

      return {
        date: dateKey,
        displayDate: format(date, "MMM dd"),
        shiftCount: dayScores.length,
        avgScore: avgScore ? parseFloat(avgScore.toFixed(2)) : null,
        avgOutput: avgOutput ? parseFloat(avgOutput.toFixed(2)) : null,
        avgWaste: avgWaste ? parseFloat(avgWaste.toFixed(2)) : null,
        totalBonus:
          dayScores.length > 0
            ? Math.round(dayScores.reduce((sum, s) => sum + s.bonusAmount, 0))
            : 0,
      };
    }
  );

  const movingAvg = trendData.map((_, idx) => {
    const window = Math.min(3, idx + 1);
    const sum = trendData
      .slice(Math.max(0, idx - window + 1), idx + 1)
      .reduce((s, d) => s + (d.avgScore || 0), 0);
    return sum / window;
  });

  return {
    period: `${numDays}_days`,
    trendData: trendData.map((d, idx) => ({
      ...d,
      movingAvg: parseFloat(movingAvg[idx].toFixed(2)),
    })),
    statistics: {
      daysWithData: trendData.filter((d) => d.shiftCount > 0).length,
      totalShifts: scores.length,
      avgDailyScore:
        scores.length > 0
          ? parseFloat(
              (
                scores.reduce((sum, s) => sum + s.totalScore, 0) /
                scores.length
              ).toFixed(2)
            )
          : 0,
      totalBonusDistributed: Math.round(
        trendData.reduce((sum, d) => sum + d.totalBonus, 0)
      ),
    },
  };
}

export type DashboardSummaryResult = Awaited<
  ReturnType<typeof getDashboardSummary>
>;
export type DashboardDistributionResult = Awaited<
  ReturnType<typeof getDashboardDistribution>
>;
export type DashboardTrendsResult = Awaited<
  ReturnType<typeof getDashboardTrends>
>;
