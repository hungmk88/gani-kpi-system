// File: lib/kpi-calculator.ts

import { prisma } from "@/lib/db";
import { BusinessError } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import {
  ERR,
  KPI_SCORE_CAP,
  PRODUCTION_DEPARTMENT_CODE,
} from "@/lib/constants";
import { vnDayRange, vnParts } from "@/lib/vn-time";
import type { SessionUser } from "@/lib/auth";

/**
 * BỘ TÍNH ĐIỂM "6 CHỈ TIÊU / CA" CỦA PHÒNG SẢN XUẤT.
 *
 * Đây là đường chấm điểm thứ hai, song song với lib/production/kpi-engine.ts
 * (2 tầng 60/40). Chưa bỏ — chờ quyết định sản phẩm — nhưng phải ĐÚNG và AN
 * TOÀN:
 *   - Số thực tế do SERVER tự rút từ ca sản xuất đã khoá, không nhận từ client.
 *   - Chỉ tiêu nào chưa có nguồn dữ liệu (Đúng Spec, Đúng Deadline) thì để
 *     null = "chưa có dữ liệu" và LOẠI khỏi phép tính (xem calculateScores).
 *   - Trọng số + chiều tốt/xấu đọc từ KpiConfig (Quản trị → 6 chỉ tiêu).
 */

/**
 * Nhãn phạm vi dùng chung cho KpiConfig / BonusConfig / KpiPeriodTarget.
 * Lưu ý: đây KHÔNG phải mã phòng ban trong bảng Department (mã đó là
 * PRODUCTION_DEPARTMENT_CODE = "PROD"). Ba bảng cấu hình trên từ đầu đã seed
 * với nhãn "PRODUCTION" — giữ nguyên để không lệch dữ liệu cũ.
 */
export const PRODUCTION_KPI_SCOPE = "PRODUCTION";

/** Trần tổng điểm ca = trần chung toàn công ty (150), để bậc thưởng ≥120 chạm được. */
export const SHIFT_SCORE_CAP = KPI_SCORE_CAP;

/**
 * Lương nền tính thưởng ca (VNĐ) — CHỈ dùng khi BonusConfig chưa seed. Số thật
 * lấy từ cột baseSalary của bậc thưởng khớp trong BonusConfig.
 */
export const DEFAULT_SHIFT_BASE_SALARY_VND = 233_000;

/** Mỗi vi phạm HACCP trong ca trừ chừng này điểm An Toàn (thang 100, sàn 0). */
export const SAFETY_PENALTY_PER_HACCP_VIOLATION = 20;

export const KPI_CODES = [
  "PROD_OUTPUT",
  "PROD_WASTE",
  "PROD_QUALITY",
  "PROD_SPEC",
  "PROD_SAFETY",
  "PROD_DEADLINE",
] as const;

export type KpiCode = (typeof KPI_CODES)[number];

/** Tiền tố cột tương ứng trong ShiftKpiScore / KpiPeriodTarget. */
const FIELD: Record<KpiCode, "output" | "waste" | "quality" | "spec" | "safety" | "deadline"> = {
  PROD_OUTPUT: "output",
  PROD_WASTE: "waste",
  PROD_QUALITY: "quality",
  PROD_SPEC: "spec",
  PROD_SAFETY: "safety",
  PROD_DEADLINE: "deadline",
};

export type KpiDefinition = {
  code: KpiCode;
  name: string;
  unit: string;
  weight: number;
  isHigherBetter: boolean;
  /** false = KpiConfig thiếu/tắt mã này, đang dùng số gốc bên dưới. */
  fromConfig: boolean;
};

/**
 * Số gốc — dùng khi KpiConfig chưa seed hoặc một mã bị tắt isActive, để việc
 * tính điểm ca không bao giờ vỡ hẳn giữa chừng vì thiếu dữ liệu cấu hình.
 */
const DEFAULT_DEFS: Record<KpiCode, Omit<KpiDefinition, "code" | "fromConfig">> = {
  PROD_OUTPUT: { name: "Sản Lượng Thực Tế", unit: "kg/ca", weight: 25, isHigherBetter: true },
  PROD_WASTE: { name: "Tỷ Lệ Hao Hụt", unit: "%", weight: 25, isHigherBetter: false },
  PROD_QUALITY: { name: "Tỷ Lệ Chất Lượng (OK)", unit: "%", weight: 20, isHigherBetter: true },
  PROD_SPEC: { name: "Tỷ Lệ Sản Phẩm Đúng Spec", unit: "%", weight: 15, isHigherBetter: true },
  PROD_SAFETY: { name: "An Toàn Lao Động", unit: "điểm", weight: 10, isHigherBetter: true },
  PROD_DEADLINE: { name: "Đúng Deadline Batch", unit: "%", weight: 5, isHigherBetter: true },
};

/** 6 chỉ tiêu theo cấu hình hiện hành (KpiConfig), thiếu mã nào thì dùng số gốc. */
export async function getKpiDefinitions(): Promise<KpiDefinition[]> {
  const configs = await prisma.kpiConfig.findMany({
    where: {
      department: PRODUCTION_KPI_SCOPE,
      isActive: true,
      code: { in: [...KPI_CODES] },
    },
  });
  const map = new Map(configs.map((c) => [c.code, c]));

  return KPI_CODES.map((code) => {
    const c = map.get(code);
    if (!c) return { code, ...DEFAULT_DEFS[code], fromConfig: false };
    return {
      code,
      name: c.name,
      unit: c.unit,
      weight: c.weightPercent,
      isHigherBetter: c.isHigherBetter,
      fromConfig: true,
    };
  });
}

/* ------------------------------------------------------------ PHÂN QUYỀN */

/** CEO, ADMIN, hoặc Trưởng phòng (MANAGER) của phòng Sản xuất. */
export async function canManageProductionKpi(user: SessionUser): Promise<boolean> {
  if (user.role === "CEO" || user.role === "ADMIN") return true;
  if (user.role !== "MANAGER" || !user.departmentId) return false;
  const dept = await prisma.department.findUnique({
    where: { id: user.departmentId },
    select: { code: true },
  });
  return dept?.code === PRODUCTION_DEPARTMENT_CODE;
}

export async function assertCanManageProductionKpi(
  user: SessionUser,
  message = "Chỉ Ban Giám đốc, quản trị hệ thống hoặc Giám đốc Sản xuất mới thực hiện được thao tác này."
) {
  if (!(await canManageProductionKpi(user))) {
    throw new BusinessError(ERR.FORBIDDEN, message, 403);
  }
}

/* ------------------------------------------------------------ CÔNG THỨC */

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * % đạt của 1 chỉ tiêu — cùng ngữ nghĩa với calculateKpiScore() ở lib/kpi.ts.
 *
 * Trả về null = "không chấm được" (thiếu số thực tế, thiếu chỉ tiêu, hoặc
 * chỉ tiêu cao-tốt bằng 0). Chỉ tiêu null bị loại khỏi tổng, KHÔNG tính là 0.
 *
 * Thấp-tốt (vd hao hụt):
 *   - thực tế 0, chỉ tiêu > 0  → vượt xa mục tiêu, chạm trần
 *   - thực tế 0, chỉ tiêu 0    → đạt đúng mục tiêu, 100%
 *   - thực tế > 0, chỉ tiêu 0  → không đạt, 0%
 *   - còn lại                  → chỉ tiêu / thực tế × 100
 */
export function calculateAchievementPercent(
  actual: number | null | undefined,
  target: number | null | undefined,
  isHigherBetter: boolean,
  cap: number = SHIFT_SCORE_CAP
): number | null {
  if (actual === null || actual === undefined || !Number.isFinite(actual)) return null;
  if (target === null || target === undefined || !Number.isFinite(target)) return null;

  let raw: number;
  if (isHigherBetter) {
    if (target === 0) return null; // không có chỉ tiêu thì không chấm
    raw = (actual / target) * 100;
  } else if (actual === 0) {
    raw = target === 0 ? 100 : cap;
  } else {
    if (target === 0) return 0;
    raw = (target / actual) * 100;
  }
  return Math.max(0, Math.min(raw, cap));
}

export type ShiftActuals = Record<KpiCode, number | null>;
export type ShiftTargets = Record<KpiCode, number | null>;

export type KpiLine = {
  code: KpiCode;
  name: string;
  unit: string;
  actual: number | null;
  target: number | null;
  /** null = chưa có dữ liệu → bị loại khỏi tổng điểm */
  achievement: number | null;
  /** Trọng số cấu hình (KpiConfig) */
  weight: number;
  /** Trọng số thực dùng sau khi chia lại cho các chỉ tiêu có dữ liệu */
  effectiveWeight: number;
  score: number;
  included: boolean;
};

/**
 * Tính điểm 6 chỉ tiêu.
 *
 * CHỈ TIÊU THIẾU DỮ LIỆU — LOẠI RA VÀ CHIA LẠI TRỌNG SỐ (đã chọn, không chấm 0):
 * Đúng Spec và Đúng Deadline hiện chưa có nguồn số liệu trong ca sản xuất.
 * Chấm 0 thì phạt oan cả ca vì lỗi của hệ thống; điền cứng 97/100 (cách cũ ở
 * client) thì là bịa số. Nên chỉ tiêu nào achievement = null bị loại, phần
 * trọng số còn lại được phóng lên cho đủ 100:
 *   trọng số thực = trọng số cấu hình × 100 / tổng trọng số các chỉ tiêu có dữ liệu
 * Ví dụ thiếu Spec (15) + Deadline (5): Sản lượng 25 → 25 × 100/80 = 31,25.
 * Cách này cũng tự xử lý trường hợp Quản trị cấu hình tổng trọng số ≠ 100.
 *
 * Tổng điểm = Σ achievement × trọng số thực / 100, trần SHIFT_SCORE_CAP (150) —
 * cùng trần với từng chỉ tiêu, nên bậc thưởng ≥120 đạt được thật.
 */
export function calculateScores(
  defs: KpiDefinition[],
  actuals: ShiftActuals,
  targets: ShiftTargets
): { lines: KpiLine[]; totalScore: number } {
  const prelim = defs.map((d) => ({
    d,
    actual: actuals[d.code],
    target: targets[d.code],
    achievement: calculateAchievementPercent(actuals[d.code], targets[d.code], d.isHigherBetter),
  }));
  const usableWeight = prelim
    .filter((p) => p.achievement !== null && p.d.weight > 0)
    .reduce((s, p) => s + p.d.weight, 0);

  if (usableWeight <= 0) {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      "Không đủ dữ liệu để chấm điểm: chưa chỉ tiêu nào có cả số thực tế lẫn mục tiêu.",
      422
    );
  }

  const lines: KpiLine[] = prelim.map(({ d, actual, target, achievement }) => {
    const included = achievement !== null && d.weight > 0;
    const effectiveWeight = included ? (d.weight * 100) / usableWeight : 0;
    const score = included ? ((achievement as number) * effectiveWeight) / 100 : 0;
    return {
      code: d.code,
      name: d.name,
      unit: d.unit,
      actual: actual === null ? null : round2(actual),
      target,
      achievement: achievement === null ? null : round2(achievement),
      weight: d.weight,
      effectiveWeight: round2(effectiveWeight),
      score: round2(score),
      included,
    };
  });

  const total = lines.reduce((s, l) => s + l.score, 0);
  return { lines, totalScore: round2(Math.min(total, SHIFT_SCORE_CAP)) };
}

/**
 * Bậc thưởng theo BonusConfig.
 *
 * Chọn bậc có achievementMin cao nhất mà điểm ≥ achievementMin. KHÔNG dùng
 * achievementMax: bảng seed để khoảng hở (vd 99,99 → 100, 119,99 → 120) nên
 * điểm 99,995 từng rơi vào khe và mất thưởng. Bậc liền mạch theo mốc dưới.
 */
export async function getBonusTier(totalScore: number) {
  const tiers = await prisma.bonusConfig.findMany({
    where: { department: PRODUCTION_KPI_SCOPE, isActive: true },
    orderBy: { achievementMin: "desc" },
  });
  const tier = tiers.find((t) => totalScore >= t.achievementMin);
  const baseSalary =
    tier?.baseSalary ?? tiers[0]?.baseSalary ?? DEFAULT_SHIFT_BASE_SALARY_VND;
  return {
    bonusMultiplier: tier?.bonusMultiplier ?? 0,
    baseSalary,
    description: tier?.description ?? null,
  };
}

/** Bonus = lương nền × hệ số */
export function calculateBonusAmount(baseSalary: number, bonusMultiplier: number): number {
  return Math.round(baseSalary * bonusMultiplier);
}

/* ------------------------------------------------- SỐ THỰC TẾ CỦA CA */

type ShiftFactsForKpi = {
  rawOutputKg: number;
  rawMaterialInputKg: number;
  qcPassedKg: number;
  haccpViolationCount: number;
};

/**
 * Rút số thực tế từ ca đã khoá — nguồn DUY NHẤT của số thực tế.
 *
 *   Sản lượng  = sản lượng thô đã qua KCS đối chiếu (rawOutputKg, kg/ca)
 *   Hao hụt %  = (NVL cấp vào − sản lượng thô) / NVL cấp vào × 100, sàn 0
 *   Chất lượng = KCS đạt / sản lượng thô × 100
 *   An toàn    = 100 − 20 × số vi phạm HACCP, sàn 0
 *   Đúng Spec, Đúng Deadline: CHƯA CÓ NGUỒN → null ("chưa có dữ liệu")
 */
export function deriveShiftActuals(s: ShiftFactsForKpi): ShiftActuals {
  return {
    PROD_OUTPUT: s.rawOutputKg,
    PROD_WASTE:
      s.rawMaterialInputKg > 0
        ? Math.max(0, ((s.rawMaterialInputKg - s.rawOutputKg) / s.rawMaterialInputKg) * 100)
        : null,
    PROD_QUALITY: s.rawOutputKg > 0 ? (s.qcPassedKg / s.rawOutputKg) * 100 : null,
    PROD_SPEC: null,
    PROD_SAFETY: Math.max(
      0,
      100 - SAFETY_PENALTY_PER_HACCP_VIOLATION * s.haccpViolationCount
    ),
    PROD_DEADLINE: null,
  };
}

/** Trạng thái điểm ca không được tính đè. */
const FROZEN_SCORE_STATUSES = ["APPROVED", "LOCKED"];
/** Mục tiêu kỳ phải được CEO duyệt mới dùng để chấm thưởng. */
const USABLE_TARGET_STATUSES = ["APPROVED", "LOCKED"];

/**
 * Tính (hoặc tính lại) điểm 6 chỉ tiêu cho 1 ca. Mọi số liệu do server tự lấy:
 * ca phải LOCKED, kỳ KPI tìm theo tháng VN của ngày ca, mục tiêu lấy từ
 * KpiPeriodTarget (đè bằng KpiShiftTarget của đúng ca nếu có).
 */
export async function calculateShiftKpiScore(
  actor: SessionUser,
  shiftLogId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {}
) {
  const shift = await prisma.productionShiftLog.findUnique({
    where: { id: shiftLogId },
    select: {
      id: true,
      status: true,
      shiftDate: true,
      shiftType: true,
      rawOutputKg: true,
      rawMaterialInputKg: true,
      qcPassedKg: true,
      haccpViolationCount: true,
    },
  });
  if (!shift) {
    throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy ca sản xuất.", 404);
  }
  if (shift.status !== "LOCKED") {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      "Ca phải được Ban Giám đốc khoá số (LOCKED) rồi mới tính điểm KPI — trước đó số còn sửa được.",
      409
    );
  }

  const { month, year } = vnParts(shift.shiftDate);
  const period = await prisma.kpiPeriod.findUnique({
    where: { month_year: { month, year } },
  });
  if (!period) {
    throw new BusinessError(
      ERR.NOT_FOUND,
      `Chưa mở kỳ KPI tháng ${month}/${year} nên chưa có mục tiêu để chấm ca này.`,
      404
    );
  }
  const periodTarget = await prisma.kpiPeriodTarget.findUnique({
    where: { periodId: period.id },
  });
  if (!periodTarget) {
    throw new BusinessError(
      ERR.NOT_FOUND,
      `Chưa thiết lập mục tiêu KPI Phòng SX cho kỳ ${period.name}.`,
      404
    );
  }
  if (!USABLE_TARGET_STATUSES.includes(periodTarget.status)) {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      `Mục tiêu KPI kỳ ${period.name} chưa được Ban Giám đốc phê duyệt — chưa dùng để chấm thưởng được.`,
      409
    );
  }

  const shiftTarget = await prisma.kpiShiftTarget.findFirst({
    where: {
      periodTargetId: periodTarget.id,
      shiftType: shift.shiftType,
      shiftDate: vnDayRange(shift.shiftDate),
    },
  });

  const targets = {} as ShiftTargets;
  for (const code of KPI_CODES) {
    const key = `${FIELD[code]}_target` as const;
    targets[code] = shiftTarget?.[key] ?? periodTarget[key] ?? null;
  }

  const defs = await getKpiDefinitions();
  const actuals = deriveShiftActuals(shift);
  const { lines, totalScore } = calculateScores(defs, actuals, targets);
  const tier = await getBonusTier(totalScore);
  const bonusAmount = calculateBonusAmount(tier.baseSalary, tier.bonusMultiplier);

  // Không ghi tiền vào breakdownJson — JSON này đi thẳng ra màn hình, còn tiền
  // chỉ người được xem tiền mới thấy (xem canSeeMoney).
  const breakdownJson = JSON.stringify({
    version: 2,
    kpis: lines,
    totalScore,
    scoreCap: SHIFT_SCORE_CAP,
    bonusMultiplier: tier.bonusMultiplier,
    excludedNote:
      "Chỉ tiêu 'chưa có dữ liệu' bị loại, trọng số chia lại cho các chỉ tiêu còn lại.",
  });

  const L = Object.fromEntries(lines.map((l) => [l.code, l])) as Record<KpiCode, KpiLine>;
  // achievement trong DB là cột NOT NULL — chỉ tiêu bị loại lưu 0 kèm
  // actual = null; ý nghĩa "chưa có dữ liệu" nằm ở breakdownJson (included=false).
  const columns = {
    output_actual: L.PROD_OUTPUT.actual,
    output_target: L.PROD_OUTPUT.target,
    output_achievement: L.PROD_OUTPUT.achievement ?? 0,
    output_weighted_score: L.PROD_OUTPUT.score,
    waste_actual: L.PROD_WASTE.actual,
    waste_target: L.PROD_WASTE.target,
    waste_achievement: L.PROD_WASTE.achievement ?? 0,
    waste_weighted_score: L.PROD_WASTE.score,
    quality_actual: L.PROD_QUALITY.actual,
    quality_target: L.PROD_QUALITY.target,
    quality_achievement: L.PROD_QUALITY.achievement ?? 0,
    quality_weighted_score: L.PROD_QUALITY.score,
    spec_actual: L.PROD_SPEC.actual,
    spec_target: L.PROD_SPEC.target,
    spec_achievement: L.PROD_SPEC.achievement ?? 0,
    spec_weighted_score: L.PROD_SPEC.score,
    safety_actual: L.PROD_SAFETY.actual,
    safety_target: L.PROD_SAFETY.target,
    safety_achievement: L.PROD_SAFETY.achievement ?? 0,
    safety_weighted_score: L.PROD_SAFETY.score,
    deadline_actual: L.PROD_DEADLINE.actual,
    deadline_target: L.PROD_DEADLINE.target,
    deadline_achievement: L.PROD_DEADLINE.achievement ?? 0,
    deadline_weighted_score: L.PROD_DEADLINE.score,
  };

  const now = new Date();
  const data = {
    ...columns,
    periodTargetId: periodTarget.id,
    totalScore,
    bonusMultiplier: tier.bonusMultiplier,
    baseSalary: tier.baseSalary,
    bonusAmount,
    breakdownJson,
    status: "CALCULATED",
    calculatedById: actor.id,
    calculatedAt: now,
  };

  const { before, saved } = await prisma.$transaction(async (tx) => {
    const existing = await tx.shiftKpiScore.findUnique({
      where: { shiftLogId },
      select: { id: true, status: true, totalScore: true, bonusMultiplier: true, bonusAmount: true },
    });
    if (existing && FROZEN_SCORE_STATUSES.includes(existing.status)) {
      throw new BusinessError(
        ERR.KPI_FINALIZED,
        "Điểm KPI ca này đã được phê duyệt — không tính đè được.",
        409
      );
    }
    const saved = await tx.shiftKpiScore.upsert({
      where: { shiftLogId },
      create: { shiftLogId, ...data },
      update: data,
    });
    return { before: existing, saved };
  });

  await writeAudit({
    actor,
    action: before ? "SHIFT_KPI_SCORE_RECALCULATE" : "SHIFT_KPI_SCORE_CALCULATE",
    entityName: "shift_kpi_scores",
    entityId: saved.id,
    before: before ?? undefined,
    after: {
      shiftLogId,
      periodTargetId: periodTarget.id,
      totalScore,
      bonusMultiplier: tier.bonusMultiplier,
      bonusAmount,
      actuals,
      targets,
    },
    ...meta,
  });

  return saved;
}

/* --------------------------------------------- ĐỌC breakdownJson AN TOÀN */

/**
 * Đọc breakdownJson (cả bản cũ lẫn bản mới) và bỏ mọi trường tiền nếu
 * includeMoney = false. Bản cũ lưu bonusAmount ngay trong JSON.
 */
export function parseBreakdown(json: string | null, includeMoney: boolean) {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (!includeMoney) {
      delete parsed.bonusAmount;
      delete parsed.baseSalary;
    }
    return parsed;
  } catch {
    return null;
  }
}
