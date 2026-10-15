import { prisma } from "@/lib/db";
import { BusinessError } from "@/lib/rbac";
import { ERR } from "@/lib/constants";
import type { SessionUser } from "@/lib/auth";
import {
  BONUS_TIERS,
  SHIFT_TYPES,
  type ShiftStatus,
} from "@/lib/production/constants";
import { computeShiftMetrics } from "@/lib/production/kpi-engine";
import { SHIFT_STAGES, shiftStage, type ShiftStage } from "@/lib/production/shift-flow";
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
 * NGUỒN SỐ LIỆU: điểm THẬT của ca sản xuất — `DailyKpiResult` (mỗi người một
 * dòng, sinh ra khi Ban Giám đốc khoá số một `ProductionShiftLog`). Đây chính là
 * số nuôi KPI tháng và tính thưởng ca, nên dashboard nhìn vào đâu thì lương
 * thưởng chạy theo đó. Bảng ShiftKpiScore cũ (6 chỉ tiêu/ca) đã bỏ.
 *
 * Quy ước:
 *  - "Ca" = một ProductionShiftLog đã KHOÁ SỐ (status LOCKED). Ca chưa khoá chưa
 *    có điểm — chỉ xuất hiện trong khối "theo trạng thái" để thấy việc còn treo.
 *  - Điểm trung bình tính theo NGƯỜI (finalWeightedScore), không theo ca — một
 *    ca 12 người nặng hơn một ca 3 người, đúng như cách tính thưởng.
 *  - Điểm ca = trung bình điểm của những người trong ca; thưởng ca = tổng thưởng.
 *  - Thang điểm: 100 = đạt; trần kỹ thuật 150 nhưng thực tế tối đa ~112 (xem
 *    BONUS_TIERS trong lib/production/constants.ts).
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
  "totalBonus",
  "avgBonus",
  "shiftBonus",
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

const round2OrNull = (n: number | null) => (n === null ? null : round2(n));
const sumOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const LOCKED: ShiftStatus = "LOCKED";

/* ================================================================ SUMMARY */

export async function getDashboardSummary(periodInput: DashboardPeriod | string) {
  const period = normalizePeriod(periodInput);

  // Một truy vấn: mọi ca trong kỳ (mọi trạng thái — để đếm việc còn treo), kèm
  // điểm từng người. Chỉ ca LOCKED mới có DailyKpiResult (mở lại ca thì điểm bị xoá).
  const shifts = await prisma.productionShiftLog.findMany({
    where: { shiftDate: periodRange(period) },
    select: {
      id: true,
      status: true,
      // Đọc dấu "KCS trả về" (ca vẫn DRAFT) để đếm riêng — xem shift-flow.ts
      qcNote: true,
      shiftDate: true,
      shiftType: true,
      sku: { select: { skuCode: true, skuName: true } },
      kpiResults: {
        select: {
          finalWeightedScore: true,
          tier2Score: true,
          finalBonusVnd: true,
          isBonusLocked: true,
        },
      },
    },
  });

  // Đếm theo chặng: DRAFT = chờ KCS thật sự, RETURNED = KCS trả về đang chờ
  // sản xuất sửa (trong DB vẫn là DRAFT). DRAFT + RETURNED + QC_APPROVED +
  // LOCKED = mọi ca trong kỳ.
  const statusCounts = Object.fromEntries(
    SHIFT_STAGES.map((st) => [st, shifts.filter((s) => shiftStage(s) === st).length])
  ) as Record<ShiftStage, number>;

  const locked = shifts.filter((s) => s.status === LOCKED);
  const results = locked.flatMap((s) => s.kpiResults);

  const totalShifts = locked.length;
  const resultCount = results.length;
  const avgScore = avgOf(results.map((r) => r.finalWeightedScore));
  const totalBonus = sumOf(results.map((r) => r.finalBonusVnd));
  const bonusLockedCount = results.filter((r) => r.isBonusLocked).length;

  // Điểm và thưởng theo từng ca.
  const perShift = locked.map((s) => ({
    shiftId: s.id,
    shiftDate: s.shiftDate,
    shiftType: s.shiftType,
    skuCode: s.sku.skuCode,
    skuName: s.sku.skuName,
    peopleCount: s.kpiResults.length,
    avgScore: avgOf(s.kpiResults.map((r) => r.finalWeightedScore)),
    // Tầng 2 giống hệt nhau cho mọi người trong ca — lấy trung bình cho chắc.
    tier2Score: avgOf(s.kpiResults.map((r) => r.tier2Score)),
    shiftBonus: sumOf(s.kpiResults.map((r) => r.finalBonusVnd)),
    bonusLocked: s.kpiResults.some((r) => r.isBonusLocked),
  }));

  // Mã ca thật trong ProductionShiftLog là CA_1 / CA_2 / CA_3 (xem
  // lib/production/constants.ts). Chỉ đếm ca đã khoá — cùng tập với totalShifts.
  const shiftTypes: Record<string, number> = Object.fromEntries(
    SHIFT_TYPES.map((t) => [t, locked.filter((s) => s.shiftType === t).length])
  );

  return {
    period,
    timestamp: new Date(),
    summary: {
      /** Số ca đã khoá số trong kỳ */
      totalShifts,
      /** Số lượt chấm điểm (người × ca) */
      resultCount,
      /** Điểm cuối TB theo người; null = chưa có ca nào khoá */
      avgScore: round2OrNull(avgScore),
      /** Điểm Tầng 2 (toàn xưởng) TB theo ca */
      avgTier2Score: round2OrNull(
        avgOf(perShift.flatMap((s) => (s.tier2Score === null ? [] : [s.tier2Score])))
      ),
      totalBonus: Math.round(totalBonus),
      /** Thưởng TB mỗi ca đã khoá */
      avgBonus: totalShifts > 0 ? Math.round(totalBonus / totalShifts) : 0,
      /** Số lượt bị khoá thưởng vì cảnh báo chống chạy chỉ tiêu còn treo/bị từ chối */
      bonusLockedCount,
      /** % lượt chấm KHÔNG bị khoá thưởng; null = chưa có lượt nào */
      percentBonusUnlocked:
        resultCount > 0
          ? Math.round(((resultCount - bonusLockedCount) / resultCount) * 100)
          : null,
    },
    /** Đếm ca theo trạng thái duyệt — gồm cả ca chưa khoá (việc còn treo) */
    statusCounts,
    shiftTypes,
    /** Top 5 ca có điểm TB cao nhất */
    topScores: perShift
      .filter((s) => s.avgScore !== null)
      .sort((a, b) => (b.avgScore ?? 0) - (a.avgScore ?? 0))
      .slice(0, 5)
      .map((s) => ({
        ...s,
        avgScore: round2(s.avgScore ?? 0),
        tier2Score: round2OrNull(s.tier2Score),
        shiftBonus: Math.round(s.shiftBonus),
      })),
  };
}

/* ============================================================ DISTRIBUTION */

/**
 * Khoảng điểm dựng thẳng từ BONUS_TIERS — mỗi cột là đúng một bậc hệ số thưởng
 * (<90 → 0×, 90–100 → 0,7×, 100–105 → 1×, 105–110 → 1,2×, ≥110 → 1,5×). Đổi bậc
 * thưởng trong constants là biểu đồ tự đổi theo. Biên dưới tính vào bậc (≥),
 * khớp bonusMultiplierFor.
 */
const BUCKETS = (() => {
  const asc = [...BONUS_TIERS].sort((a, b) => a.minScore - b.minScore);
  return asc.map((t, i) => {
    const next = asc[i + 1];
    const min = t.minScore;
    const max = next ? next.minScore : Infinity;
    const range =
      i === 0 && next
        ? `<${max}`
        : next
          ? `${min}–${max}`
          : `≥${min}`;
    return { range, min, max, multiplier: t.multiplier as number };
  });
})();

const DISTRIBUTION_DAYS = 30;

/** Phân bố điểm cuối của từng NGƯỜI trong các ca đã khoá, 30 ngày VN gần nhất. */
export async function getDashboardDistribution() {
  const today = vnStartOfDay();
  const results = await prisma.dailyKpiResult.findMany({
    where: {
      shiftLog: {
        status: LOCKED,
        shiftDate: { gte: addDays(today, -(DISTRIBUTION_DAYS - 1)), lt: addDays(today, 1) },
      },
    },
    select: { finalWeightedScore: true },
  });

  const validScores = results
    .map((r) => r.finalWeightedScore)
    .filter((n) => Number.isFinite(n));
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
      /** Số lượt chấm (người × ca) */
      count: validScores.length,
      average: round2(avg),
      median: round2(median),
      stdDev: round2(stdDev),
      min: sorted.length > 0 ? round2(sorted[0]) : 0,
      max: sorted.length > 0 ? round2(sorted[sorted.length - 1]) : 0,
    },
    chartData: BUCKETS.map((b) => ({
      range: b.range,
      /** Hệ số thưởng của bậc này */
      multiplier: b.multiplier,
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

/** Xu hướng `numDays` ngày lịch VN gần nhất, tính cả hôm nay — chỉ ca đã khoá. */
export async function getDashboardTrends(numDaysInput: number) {
  const numDays = Math.min(90, Math.max(1, Math.floor(numDaysInput) || 7));
  const today = vnStartOfDay();
  const start = addDays(today, -(numDays - 1));

  const shifts = await prisma.productionShiftLog.findMany({
    where: { status: LOCKED, shiftDate: { gte: start, lt: addDays(today, 1) } },
    select: {
      shiftDate: true,
      // Đủ dữ kiện cho computeShiftMetrics — dùng đúng công thức của engine chấm điểm.
      rawOutputKg: true,
      qcPassedKg: true,
      reworkKg: true,
      scrapKg: true,
      haccpViolationCount: true,
      totalLaborHours: true,
      downtimeHours: true,
      targetOutputKg: true,
      rawMaterialInputKg: true,
      stdMaterialNormKg: true,
      kpiResults: { select: { finalWeightedScore: true, finalBonusVnd: true } },
    },
  });

  type DayShift = {
    scores: number[];
    bonus: number;
    outputAchievement: number | null;
    defectRate: number | null;
  };
  const groupedByDate = new Map<string, DayShift[]>();
  for (const s of shifts) {
    const m = computeShiftMetrics(s);
    const item: DayShift = {
      scores: s.kpiResults.map((r) => r.finalWeightedScore),
      bonus: sumOf(s.kpiResults.map((r) => r.finalBonusVnd)),
      outputAchievement: m.outputAchievementPercent,
      defectRate: m.defectRatePercent,
    };
    const key = vnDateKey(s.shiftDate);
    const arr = groupedByDate.get(key);
    if (arr) arr.push(item);
    else groupedByDate.set(key, [item]);
  }

  const notNull = (xs: (number | null)[]) =>
    xs.filter((v): v is number => v !== null);

  const trendData = Array.from({ length: numDays }, (_, i) => {
    const day = addDays(start, i);
    const dateKey = vnDateKey(day);
    const p = vnParts(day);
    const dayShifts = groupedByDate.get(dateKey) ?? [];
    const dayScores = dayShifts.flatMap((s) => s.scores);

    // Ngày không có ca → null (không phải 0). Trung bình đúng bằng 0 vẫn là 0.
    return {
      date: dateKey,
      displayDate: `${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}`,
      shiftCount: dayShifts.length,
      peopleCount: dayScores.length,
      /** Điểm cuối TB theo người */
      avgScore: round2OrNull(avgOf(dayScores)),
      /** TB theo ca của % đạt chỉ tiêu sản lượng (QC đạt / chỉ tiêu); ca không có chỉ tiêu bị bỏ qua */
      avgOutputAchievement: round2OrNull(
        avgOf(notNull(dayShifts.map((s) => s.outputAchievement)))
      ),
      /** TB theo ca của tỷ lệ lỗi (phế + làm lại × hệ số) / sản lượng thô — đúng defectRatePercent của engine */
      avgDefectRate: round2OrNull(avgOf(notNull(dayShifts.map((s) => s.defectRate)))),
      totalBonus: Math.round(sumOf(dayShifts.map((s) => s.bonus))),
    };
  });

  // Trung bình trượt 3 ngày: chỉ lấy những ngày CÓ dữ liệu trong cửa sổ —
  // ngày nghỉ không kéo đường xuống 0. Cả cửa sổ trống → null.
  const movingAvg = trendData.map((_, idx) => {
    const windowVals = notNull(
      trendData
        .slice(Math.max(0, idx - MOVING_AVG_WINDOW + 1), idx + 1)
        .map((d) => d.avgScore)
    );
    return round2OrNull(avgOf(windowVals));
  });

  const allScores = shifts.flatMap((s) => s.kpiResults.map((r) => r.finalWeightedScore));

  return {
    period: `${numDays}_days`,
    trendData: trendData.map((d, idx) => ({ ...d, movingAvg: movingAvg[idx] })),
    statistics: {
      daysWithData: trendData.filter((d) => d.shiftCount > 0).length,
      totalShifts: shifts.length,
      resultCount: allScores.length,
      /** Điểm cuối TB theo người trong cả khoảng; null = không có ca nào khoá */
      avgScore: round2OrNull(avgOf(allScores)),
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
