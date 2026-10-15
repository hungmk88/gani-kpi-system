import { prisma } from "../db";
import { BusinessError } from "../rbac";
import { ERR } from "../constants";
import { writeAudit } from "../audit";
import { notify } from "../notify";
import { sendCeoAlert, sendExecutiveBriefingTelegram } from "../telegram";
import {
  computeCapacity,
  computeHealth,
  computeVelocity,
  detectAnomaly,
  predictTask,
  suggestRebalance,
  type CapacityReport,
  type HealthResult,
  type PredictionResult,
  type VelocityResult,
} from "../analytics/engine";
import {
  ANOMALY_SEVERITY_LABEL,
  PREDICTION_HORIZON_DAYS,
} from "../analytics/constants";
import { buildExecutiveBriefing, type BriefingFacts } from "../ai/executive-advisor";
import { round2, summarizeResults } from "../kpi";
import { vnDateKey, vnStartOfDay } from "../vn-time";
import { getDeadlinePeriod, getPeriodWithCeoDeadlineToday } from "./period-service";
import type { SessionUser } from "../auth";

/**
 * TẦNG DỊCH VỤ CHO PHẦN PHÂN TÍCH & DỰ BÁO.
 *
 * Lõi tính toán nằm ở lib/analytics/engine.ts và không chạm database. File này
 * lo phần gom dữ liệu, lưu kết quả, và — quan trọng nhất — **chấm lại xem dự báo
 * cũ có đúng không**.
 */

type Meta = { ip?: string | null; userAgent?: string | null };
const DAY = 86400_000;
const OPEN_STATUSES = ["BACKLOG", "TO_DO", "IN_PROGRESS", "BLOCKED", "REVIEW"];

/* ==================================================================== */
/* NHỊP LÀM VIỆC                                                        */
/* ==================================================================== */

/** Nhịp làm việc của một người, tính từ toàn bộ việc họ đã đóng. */
export async function velocityFor(userId: string): Promise<VelocityResult> {
  const closed = await prisma.task.findMany({
    where: {
      assigneeId: userId,
      status: "DONE",
      completedAt: { not: null },
    },
    select: { dueDate: true, completedAt: true, startDate: true, createdAt: true },
    orderBy: { completedAt: "desc" },
    take: 60,
  });

  return computeVelocity(
    closed.map((t) => ({
      dueDate: t.dueDate,
      completedAt: t.completedAt!,
      startDate: t.startDate ?? t.createdAt,
    }))
  );
}

/* ==================================================================== */
/* DỰ BÁO NGUY CƠ VỠ KẾ HOẠCH                                           */
/* ==================================================================== */

export type PredictiveScanResult = {
  predictions: (PredictionResult & {
    departmentName: string;
    assigneeName: string | null;
    dueDate: string;
  })[];
  scanned: number;
  highRisk: number;
  moderateRisk: number;
  /** Bao nhiêu dự báo dựa trên nền dữ liệu còn mỏng */
  weakBasis: number;
};

export async function runPredictiveScan(opts: {
  departmentId?: string | null;
  persist?: boolean;
  now?: Date;
}): Promise<PredictiveScanResult> {
  const now = opts.now ?? new Date();
  const horizon = new Date(now.getTime() + PREDICTION_HORIZON_DAYS * DAY);

  const tasks = await prisma.task.findMany({
    where: {
      status: { in: OPEN_STATUSES },
      dueDate: { lte: horizon },
      ...(opts.departmentId ? { departmentId: opts.departmentId } : {}),
    },
    include: {
      assignee: true,
      department: true,
      dependencies: { include: { dependsOn: true } },
    },
    orderBy: { dueDate: "asc" },
    take: 200,
  });

  // Đếm việc đang làm dở theo từng người, một lần cho cả lượt
  const loadRows = await prisma.task.groupBy({
    by: ["assigneeId"],
    where: { status: "IN_PROGRESS", assigneeId: { not: null } },
    _count: { _all: true },
  });
  const loadMap = new Map<string, number>();
  for (const r of loadRows) if (r.assigneeId) loadMap.set(r.assigneeId, r._count._all);

  // Nhịp làm việc: tính một lần cho mỗi người, dùng lại cho mọi việc của họ
  const velocityCache = new Map<string, VelocityResult>();

  const out: PredictiveScanResult["predictions"] = [];

  for (const t of tasks) {
    let vel: VelocityResult;
    if (t.assigneeId) {
      if (!velocityCache.has(t.assigneeId)) {
        velocityCache.set(t.assigneeId, await velocityFor(t.assigneeId));
      }
      vel = velocityCache.get(t.assigneeId)!;
    } else {
      vel = {
        velocity: 1,
        sampleSize: 0,
        confidence: "NONE",
        onTimeRate: null,
        medianDelayDays: null,
        note: "Việc chưa giao cho ai nên không có nhịp làm việc để dựa vào.",
      };
    }

    const lateBlockers = t.dependencies.filter(
      (d) =>
        OPEN_STATUSES.includes(d.dependsOn.status) &&
        d.dependsOn.dueDate.getTime() < now.getTime()
    ).length;

    const p = predictTask(
      {
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        progress: t.progress,
        riskScore: t.riskScore,
        startDate: t.startDate,
        createdAt: t.createdAt,
        dueDate: t.dueDate,
        assigneeId: t.assigneeId,
        assigneeActiveTasks: t.assigneeId ? (loadMap.get(t.assigneeId) ?? 0) : 0,
        lateBlockerCount: lateBlockers,
      },
      vel,
      now
    );

    out.push({
      ...p,
      departmentName: t.department.name,
      assigneeName: t.assignee?.fullName ?? null,
      dueDate: t.dueDate.toISOString(),
    });

    /* Lưu lại để sau này chấm xem dự báo có đúng không.
       Mỗi việc chỉ lưu một bản mỗi ngày, tránh phình bảng khi cron chạy 12 lượt. */
    if (opts.persist) {
      const startOfDay = vnStartOfDay(now);
      const existing = await prisma.predictionLog.findFirst({
        where: { taskId: t.id, predictedAt: { gte: startOfDay } },
      });
      if (!existing) {
        await prisma.predictionLog.create({
          data: {
            taskId: t.id,
            completionProbability: p.completionProbabilityPercent,
            projectedDelayDays: p.projectedDelayDays,
            riskCategory: p.riskCategory,
            factorsJson: JSON.stringify(p.predictiveFactors),
            sampleSize: p.sampleSize,
            confidence: p.confidence,
          },
        });
      }
    }
  }

  out.sort(
    (a, b) => a.completionProbabilityPercent - b.completionProbabilityPercent
  );

  return {
    predictions: out,
    scanned: out.length,
    highRisk: out.filter((p) => p.riskCategory === "HIGH_FAILURE_RISK").length,
    moderateRisk: out.filter((p) => p.riskCategory === "MODERATE_RISK").length,
    weakBasis: out.filter((p) => p.confidence === "NONE").length,
  };
}

/**
 * CHẤM LẠI DỰ BÁO CŨ.
 *
 * Đây là thứ quyết định bộ dự báo có đáng tin hay không. Không có nó thì hệ
 * thống cứ đưa ra số mãi mà chẳng ai biết nó đúng bao nhiêu phần. Có nó thì sau
 * vài tháng, hệ thống tự nói được: "những lần tôi báo nguy cơ cao, 7/10 lần là
 * trễ thật".
 */
export async function scorePastPredictions(now = new Date()) {
  const pending = await prisma.predictionLog.findMany({
    where: { outcomeKnown: false },
    include: { task: true },
    take: 500,
  });

  let scored = 0;

  for (const log of pending) {
    const t = log.task;
    // Chỉ chấm khi việc đã đóng hẳn
    if (t.status !== "DONE" && t.status !== "CANCELLED") continue;
    if (t.status === "CANCELLED") {
      // Việc bị huỷ thì không có đúng sai để chấm — đánh dấu đã biết kết quả
      await prisma.predictionLog.update({
        where: { id: log.id },
        data: { outcomeKnown: true, outcomeAt: now },
      });
      continue;
    }
    if (!t.completedAt) continue;

    const delayDays =
      (t.completedAt.getTime() - t.dueDate.getTime()) / DAY;
    const actuallyLate = delayDays > 0;
    // Dự báo coi là "báo trễ" khi khả năng xong đúng hạn dưới 50%
    const predictedLate = log.completionProbability < 50;

    await prisma.predictionLog.update({
      where: { id: log.id },
      data: {
        outcomeKnown: true,
        actuallyLate,
        actualDelayDays: Math.round(delayDays * 10) / 10,
        wasCorrect: predictedLate === actuallyLate,
        outcomeAt: now,
      },
    });
    scored++;
  }

  return { scored };
}

export type AccuracyReport = {
  total: number;
  correct: number;
  accuracyPercent: number | null;
  /** Báo trễ và trễ thật */
  truePositive: number;
  /** Báo trễ nhưng vẫn kịp */
  falsePositive: number;
  /** Báo ổn nhưng lại trễ — loại sai nguy hiểm nhất */
  falseNegative: number;
  trueNegative: number;
  confidence: string;
  note: string;
};

export async function getPredictionAccuracy(): Promise<AccuracyReport> {
  const rows = await prisma.predictionLog.findMany({
    where: { outcomeKnown: true, actuallyLate: { not: null } },
    select: { completionProbability: true, actuallyLate: true, wasCorrect: true },
  });

  const total = rows.length;
  if (total === 0) {
    return {
      total: 0,
      correct: 0,
      accuracyPercent: null,
      truePositive: 0,
      falsePositive: 0,
      falseNegative: 0,
      trueNegative: 0,
      confidence: "NONE",
      note: "Chưa có việc nào đóng lại sau khi được dự báo, nên chưa đo được bộ dự báo đúng bao nhiêu phần. Con số này sẽ có sau vài tuần chạy thật.",
    };
  }

  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const r of rows) {
    const predictedLate = r.completionProbability < 50;
    if (predictedLate && r.actuallyLate) tp++;
    else if (predictedLate && !r.actuallyLate) fp++;
    else if (!predictedLate && r.actuallyLate) fn++;
    else tn++;
  }

  const correct = tp + tn;
  const accuracy = Math.round((correct / total) * 1000) / 10;

  const confidence =
    total >= 50 ? "HIGH" : total >= 20 ? "MEDIUM" : "LOW";

  return {
    total,
    correct,
    accuracyPercent: accuracy,
    truePositive: tp,
    falsePositive: fp,
    falseNegative: fn,
    trueNegative: tn,
    confidence,
    note:
      total < 20
        ? `Mới đo được trên ${total} việc — con số này còn dao động mạnh, đừng vội tin.`
        : `Đo trên ${total} việc đã đóng. Đáng lo nhất là ${fn} lần hệ thống báo ổn nhưng việc vẫn trễ.`,
  };
}

/* ==================================================================== */
/* CÂN BẰNG TẢI NHÂN SỰ                                                 */
/* ==================================================================== */

export async function getCapacityReports(departmentId?: string | null) {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { not: "ADMIN" },
      ...(departmentId ? { departmentId } : { departmentId: { not: null } }),
    },
    include: {
      department: true,
      assignedTasks: {
        where: { status: { in: ["TO_DO", "IN_PROGRESS", "BLOCKED"] } },
        select: { priority: true, estimatedHours: true, dueDate: true },
      },
    },
    orderBy: { fullName: "asc" },
  });

  const reports: CapacityReport[] = users.map((u) =>
    computeCapacity(
      {
        id: u.id,
        fullName: u.fullName,
        departmentName: u.department?.name ?? null,
      },
      u.assignedTasks
    )
  );

  // Gợi ý san việc chỉ trong cùng phòng ban — luật cấm giao vượt cấp vẫn giữ
  const byDept = new Map<string, CapacityReport[]>();
  for (const r of reports) {
    const k = r.departmentName ?? "—";
    byDept.set(k, [...(byDept.get(k) ?? []), r]);
  }
  const suggestions = [...byDept.entries()].flatMap(([dept, list]) =>
    suggestRebalance(list).map((s) => ({ ...s, departmentName: dept }))
  );

  return {
    reports: reports.sort((a, b) => b.utilizationPercent - a.utilizationPercent),
    suggestions,
    overloaded: reports.filter((r) => r.workloadStatus === "OVERLOADED").length,
    underutilized: reports.filter((r) => r.workloadStatus === "UNDERUTILIZED")
      .length,
  };
}

/* ==================================================================== */
/* PHÁT HIỆN BẤT THƯỜNG KPI                                             */
/* ==================================================================== */

/**
 * Quét toàn bộ số nhân viên tự khai trong một kỳ, so với lịch sử của chính họ.
 * So người với chính mình chứ không so người này với người kia — mỗi người một
 * đầu việc, so chéo là bất công.
 */
export async function runAnomalyScan(periodId?: string, now = new Date()) {
  const period = periodId
    ? await prisma.kpiPeriod.findUnique({ where: { id: periodId } })
    : await prisma.kpiPeriod.findFirst({
        orderBy: [{ year: "desc" }, { month: "desc" }],
      });

  if (!period) {
    return { checked: 0, flagged: 0, skippedThinHistory: 0, periodName: null };
  }

  const rows = await prisma.kpiResult.findMany({
    where: {
      periodId: period.id,
      actualSelf: { not: null },
    },
    include: {
      employee: { select: { fullName: true } },
      kpiDefinition: true,
    },
  });

  // Lịch sử các kỳ trước: gom MỘT lần cho cả kỳ rồi chia theo
  // (nhân viên, chỉ tiêu) trong bộ nhớ — trước đây mỗi dòng KPI một query.
  const employeeIds = [...new Set(rows.map((r) => r.employeeId))];
  const kpiDefIds = [
    ...new Set(
      rows.map((r) => r.kpiDefinitionId).filter((x): x is string => !!x)
    ),
  ];
  const allHistory =
    employeeIds.length && kpiDefIds.length
      ? await prisma.kpiResult.findMany({
          where: {
            employeeId: { in: employeeIds },
            kpiDefinitionId: { in: kpiDefIds },
            periodId: { not: period.id },
            actualFinal: { not: null },
          },
          select: {
            employeeId: true,
            kpiDefinitionId: true,
            actualFinal: true,
          },
          orderBy: [{ period: { year: "desc" } }, { period: { month: "desc" } }],
        })
      : [];
  const historyByKey = new Map<string, number[]>();
  for (const h of allHistory) {
    const key = `${h.employeeId}|${h.kpiDefinitionId}`;
    const list = historyByKey.get(key) ?? [];
    // Đã sắp mới → cũ, chỉ giữ 12 kỳ gần nhất như trước
    if (list.length < 12) list.push(h.actualFinal!);
    historyByKey.set(key, list);
  }

  // Cảnh báo đã có của kỳ này — cũng lấy một lần
  const existingAnomalies = await prisma.kpiAnomaly.findMany({
    where: { kpiResultId: { in: rows.map((r) => r.id) } },
    select: { kpiResultId: true, status: true },
  });
  const existingByResult = new Map(
    existingAnomalies.map((a) => [a.kpiResultId, a])
  );

  let checked = 0;
  let flagged = 0;
  let thin = 0;

  for (const r of rows) {
    if (!r.kpiDefinitionId || !r.kpiDefinition) continue;

    // Lịch sử của CHÍNH người này với CHÍNH chỉ tiêu này, các kỳ trước
    const values = (
      historyByKey.get(`${r.employeeId}|${r.kpiDefinitionId}`) ?? []
    ).filter((v) => Number.isFinite(v));

    const res = detectAnomaly(r.actualSelf!, values);
    checked++;

    if (res.confidence === "NONE") {
      thin++;
      // Dọn cảnh báo cũ nếu trước đó từng gắn mà giờ không đủ nền nữa
      await prisma.kpiAnomaly.deleteMany({
        where: { kpiResultId: r.id, status: "OPEN" },
      });
      continue;
    }

    if (!res.isAnomaly) {
      await prisma.kpiAnomaly.deleteMany({
        where: { kpiResultId: r.id, status: "OPEN" },
      });
      continue;
    }

    const existing = existingByResult.get(r.id) ?? null;

    // Đã có người giải trình hoặc BGĐ đã xử lý thì không ghi đè
    if (existing && existing.status !== "OPEN") continue;

    await prisma.kpiAnomaly.upsert({
      where: { kpiResultId: r.id },
      update: {
        reportedValue: res.reportedValue,
        historicalMean: res.historicalMean,
        historicalMedian: res.historicalMedian,
        stdDev: res.stdDev,
        madValue: res.madValue,
        zScore: res.zScore,
        robustScore: res.robustScore,
        sampleSize: res.sampleSize,
        confidence: res.confidence,
        severity: res.severity!,
        reason: res.reason,
      },
      create: {
        kpiResultId: r.id,
        employeeId: r.employeeId,
        kpiDefinitionId: r.kpiDefinitionId,
        periodId: period.id,
        reportedValue: res.reportedValue,
        historicalMean: res.historicalMean,
        historicalMedian: res.historicalMedian,
        stdDev: res.stdDev,
        madValue: res.madValue,
        zScore: res.zScore,
        robustScore: res.robustScore,
        sampleSize: res.sampleSize,
        confidence: res.confidence,
        severity: res.severity!,
        reason: res.reason,
      },
    });

    if (!existing) {
      flagged++;
      if (res.severity === "CRITICAL") {
        await sendCeoAlert({
          title: `Khai báo KPI bất thường: ${r.employee.fullName}`,
          details: `${r.kpiDefinition.name} — ${res.reason}`,
          actionPath: "/analytics",
        });
      }
    }
  }

  return {
    checked,
    flagged,
    skippedThinHistory: thin,
    periodName: period.name,
  };
}

export async function explainAnomaly(
  actor: SessionUser,
  anomalyId: string,
  text: string,
  meta: Meta = {}
) {
  const a = await prisma.kpiAnomaly.findUnique({
    where: { id: anomalyId },
    include: { employee: { select: { departmentId: true } } },
  });
  if (!a) {
    throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy cảnh báo.", 404);
  }
  // Người bị nêu tên tự giải trình; trưởng phòng chỉ giải trình hộ người
  // trong phòng mình; Ban Giám đốc thì toàn công ty.
  const isSelf = a.employeeId === actor.id;
  const isDeptManager =
    actor.role === "MANAGER" &&
    !!actor.departmentId &&
    a.employee.departmentId === actor.departmentId;
  if (!isSelf && !isDeptManager && actor.role !== "CEO") {
    throw new BusinessError(
      ERR.FORBIDDEN,
      actor.role === "MANAGER"
        ? "Cảnh báo này không thuộc phòng ban của bạn."
        : "Bạn chỉ giải trình được cảnh báo về số liệu của chính mình.",
      403
    );
  }
  if (a.status !== "OPEN") {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      "Cảnh báo này đã qua bước giải trình.",
      409
    );
  }
  if (text.trim().length < 20) {
    throw new BusinessError(
      ERR.REASON_REQUIRED,
      "Giải trình phải nói rõ nguyên nhân, tối thiểu 20 ký tự.",
      400
    );
  }

  const updated = await prisma.kpiAnomaly.update({
    where: { id: anomalyId },
    data: {
      explanationText: text,
      explainedById: actor.id,
      explainedAt: new Date(),
      status: "EXPLAINED",
    },
  });

  await writeAudit({
    actor,
    action: "KPI_ANOMALY_EXPLAIN",
    entityName: "kpi_anomalies",
    entityId: anomalyId,
    reason: text,
    ...meta,
  });

  return updated;
}

export async function reviewAnomaly(
  actor: SessionUser,
  anomalyId: string,
  input: { accepted: boolean; reviewNote: string },
  meta: Meta = {}
) {
  if (actor.role !== "CEO" && actor.role !== "MANAGER") {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Chỉ trưởng phòng và Ban Giám đốc mới xử lý được cảnh báo bất thường.",
      403
    );
  }
  if (input.reviewNote.trim().length < 10) {
    throw new BusinessError(
      ERR.REASON_REQUIRED,
      "Ghi rõ kết luận của bạn, tối thiểu 10 ký tự.",
      400
    );
  }

  const a = await prisma.kpiAnomaly.findUnique({
    where: { id: anomalyId },
    include: {
      employee: { select: { departmentId: true } },
      kpiDefinition: { select: { name: true } },
    },
  });
  if (!a) {
    throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy cảnh báo.", 404);
  }
  if (actor.role === "MANAGER" && a.employee.departmentId !== actor.departmentId) {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Cảnh báo này không thuộc phòng ban của bạn.",
      403
    );
  }
  // Không tự kết luận cảnh báo về số liệu của chính mình
  if (actor.role === "MANAGER" && a.employeeId === actor.id) {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Cảnh báo về số liệu của chính bạn phải do Ban Giám đốc kết luận.",
      403
    );
  }

  const updated = await prisma.kpiAnomaly.update({
    where: { id: anomalyId },
    data: {
      status: input.accepted ? "ACCEPTED" : "DISMISSED",
      reviewNote: input.reviewNote,
      reviewedById: actor.id,
      reviewedAt: new Date(),
    },
  });

  await writeAudit({
    actor,
    action: input.accepted
      ? "KPI_ANOMALY_ACCEPT"
      : "KPI_ANOMALY_DISMISS",
    entityName: "kpi_anomalies",
    entityId: anomalyId,
    before: { severity: a.severity, sampleSize: a.sampleSize },
    after: { status: updated.status },
    reason: input.reviewNote,
    ...meta,
  });

  await notify({
    userId: a.employeeId,
    title: `Đã xử lý cảnh báo số liệu: ${a.kpiDefinition.name}`,
    body: `${actor.fullName} ${input.accepted ? "chấp nhận giải thích" : "bỏ qua cảnh báo"}. Ý kiến: ${input.reviewNote}`,
    level: "INFO",
    linkUrl: "/kpi",
  });

  return updated;
}

/* ==================================================================== */
/* SỨC KHOẺ VẬN HÀNH                                                    */
/* ==================================================================== */

/**
 * Kỳ dùng cho ảnh chụp sức khoẻ / báo cáo giao ban: kỳ chỉ định nếu có, không
 * thì kỳ đang "nóng" (ngày 1–5 là kỳ đang chốt, sau đó là kỳ tháng này) —
 * không lấy kỳ mới nhất, vì đầu tháng kỳ mới vừa mở chưa có số.
 */
async function resolveReportPeriod(now: Date, periodId?: string) {
  return periodId
    ? prisma.kpiPeriod.findUnique({ where: { id: periodId } })
    : getDeadlinePeriod(now);
}

export async function buildHealthSnapshot(now = new Date(), periodId?: string) {
  const period = await resolveReportPeriod(now, periodId);

  const [
    openTasks,
    overdueTasks,
    criticalRiskTasks,
    mismatchCells,
    totalKpiCells,
    openAnomalies,
  ] = await Promise.all([
    prisma.task.count({ where: { status: { in: OPEN_STATUSES } } }),
    prisma.task.count({
      where: { status: { in: OPEN_STATUSES }, dueDate: { lt: now } },
    }),
    prisma.task.count({
      where: { status: { in: OPEN_STATUSES }, riskScore: { gte: 80 } },
    }),
    prisma.reconciliation.count({ where: { status: "MISMATCH" } }),
    period ? prisma.kpiResult.count({ where: { periodId: period.id } }) : 0,
    prisma.kpiAnomaly.count({
      where: { status: { in: ["OPEN", "EXPLAINED"] } },
    }),
  ]);

  const capacity = await getCapacityReports();

  const health = computeHealth({
    openTasks,
    overdueTasks,
    criticalRiskTasks,
    overloadedPeople: capacity.overloaded,
    totalPeople: capacity.reports.length,
    mismatchCells,
    totalKpiCells,
    openAnomalies,
  });

  return {
    health,
    facts: {
      openTasks,
      overdueTasks,
      criticalRiskTasks,
      overloadedPeople: capacity.overloaded,
      underutilizedPeople: capacity.underutilized,
      totalPeople: capacity.reports.length,
      mismatchCells,
      totalKpiCells,
      openAnomalies,
      periodName: period?.name ?? null,
    },
    capacity,
  };
}

/* ==================================================================== */
/* BÁO CÁO GIAO BAN CHO BAN GIÁM ĐỐC                                    */
/* ==================================================================== */

/**
 * Gom đủ số liệu cho một lượt báo cáo điều hành — dùng chung cho cả đường bấm
 * tay (`POST /api/ai/executive-briefing`) lẫn đường tự động (bộ máy chạy nền
 * ngày 5). Tách riêng để hai đường luôn đọc đúng một bộ dữ liệu, không tính
 * lại theo hai cách khác nhau.
 */
export async function gatherExecutiveBriefingFacts(now = new Date(), periodId?: string) {
  const [snapshot, scan, accuracy] = await Promise.all([
    buildHealthSnapshot(now, periodId),
    runPredictiveScan({ persist: false, now }),
    getPredictionAccuracy(),
  ]);

  const period = await resolveReportPeriod(now, periodId);

  /* --- Phòng ban yếu nhất theo điểm KPI --- */
  const weakest: { name: string; avgScore: number }[] = [];
  if (period) {
    const depts = await prisma.department.findMany();
    for (const d of depts) {
      const rows = await prisma.kpiResult.findMany({
        where: { periodId: period.id, employee: { departmentId: d.id } },
        select: {
          employeeId: true,
          weightPercent: true,
          weightedScore: true,
          achievementPercent: true,
        },
      });
      if (rows.length === 0) continue;
      const byEmp = new Map<string, typeof rows>();
      for (const r of rows) {
        byEmp.set(r.employeeId, [...(byEmp.get(r.employeeId) ?? []), r]);
      }
      const scores = [...byEmp.values()].map(
        (list) => summarizeResults(list).totalScore
      );
      if (scores.length === 0) continue;
      weakest.push({
        name: d.name,
        avgScore: round2(scores.reduce((a, b) => a + b, 0) / scores.length),
      });
    }
    weakest.sort((a, b) => a.avgScore - b.avgScore);
  }

  const mostLoaded = snapshot.capacity.reports
    .filter((r) => r.workloadStatus === "OVERLOADED")
    .slice(0, 3)
    .map((r) => ({ name: r.fullName, utilizationPercent: r.utilizationPercent }));

  const facts: BriefingFacts = {
    periodName: snapshot.facts.periodName,
    openTasks: snapshot.facts.openTasks,
    overdueTasks: snapshot.facts.overdueTasks,
    criticalRiskTasks: snapshot.facts.criticalRiskTasks,
    overloadedPeople: snapshot.facts.overloadedPeople,
    underutilizedPeople: snapshot.facts.underutilizedPeople,
    totalPeople: snapshot.facts.totalPeople,
    mismatchCells: snapshot.facts.mismatchCells,
    totalKpiCells: snapshot.facts.totalKpiCells,
    openAnomalies: snapshot.facts.openAnomalies,
    predictedHighRisk: scan.highRisk,
    predictedModerate: scan.moderateRisk,
    predictionAccuracy: accuracy.accuracyPercent,
    predictionSampleSize: accuracy.total,
    weakestDepartments: weakest.slice(0, 3),
    mostLoaded,
  };

  return { health: snapshot.health as HealthResult, facts, period, accuracy };
}

/**
 * Dấu nhận biết báo cáo giao ban do bộ máy nền tự soạn (đầu `inputText`) — để
 * phân biệt với bản Ban Giám đốc bấm tay. Bản bấm tay không bao giờ mở đầu bằng
 * dấu này (xem app/api/ai/executive-briefing/route.ts).
 */
const AUTO_BRIEFING_MARKER = "[Tự động ngày 5]";

/** Cùng một ngày theo lịch Việt Nam (không phụ thuộc múi giờ server). */
function isSameCalendarDay(a: Date, b: Date) {
  return vnDateKey(a) === vnDateKey(b);
}

/**
 * Tự soạn và gửi báo cáo giao ban vào Telegram Ban Giám đốc — CHỈ vào đúng
 * ngày Ban Giám đốc chốt kỳ (`ceoApprovalDeadline`, tức ngày 5), và chỉ một
 * lần mỗi ngày dù bộ máy chạy nền chạy nhiều lượt trong ngày đó.
 *
 * Không bắt buộc có Gemini: `buildExecutiveBriefing` tự chuyển sang bản viết
 * bằng luật cứng khi chưa cấu hình khoá, báo cáo vẫn đủ số liệu thật, chỉ kém
 * trôi chảy hơn.
 */
export async function runMonthlyExecutiveBriefingIfDue(now = new Date()) {
  // Ngày 5 tháng M+1 là ngày chốt của kỳ tháng M — tức kỳ ĐANG CHỐT, không
  // phải kỳ mới nhất (kỳ tháng M+1 thường đã mở sẵn, hạn của nó ở tháng sau).
  // Tìm thẳng kỳ có hạn chốt rơi đúng hôm nay: kỳ đã được chốt sớm hơn hạn vẫn
  // có buổi giao ban như thường.
  const period = await getPeriodWithCeoDeadlineToday(now);
  if (!period) {
    const any = await prisma.kpiPeriod.count();
    return { sent: false, reason: any === 0 ? "NO_PERIOD" : "NOT_DUE_TODAY" };
  }
  if (!isSameCalendarDay(now, period.ceoApprovalDeadline)) {
    return { sent: false, reason: "NOT_DUE_TODAY" };
  }

  // Chỉ tính bản TỰ ĐỘNG đã gửi hôm nay. Ban Giám đốc bấm tay xem báo cáo lúc
  // sáng (POST /api/ai/executive-briefing) không được làm mất bản giao ban gửi
  // Telegram của ngày chốt.
  const since = vnStartOfDay(now);
  const already = await prisma.aiSuggestion.findFirst({
    where: {
      kind: "EXEC_BRIEFING",
      createdAt: { gte: since },
      inputText: { startsWith: AUTO_BRIEFING_MARKER },
    },
    select: { id: true },
  });
  if (already) return { sent: false, reason: "ALREADY_SENT_TODAY" };

  const ceo = await prisma.user.findFirst({
    where: { role: "CEO", isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (!ceo) return { sent: false, reason: "NO_CEO" };

  // Số liệu của ĐÚNG kỳ đang chốt hôm nay, khớp tiêu đề tin gửi Ban Giám đốc
  const { health, facts } = await gatherExecutiveBriefingFacts(now, period.id);
  const briefing = await buildExecutiveBriefing(health, facts);

  const saved = await prisma.aiSuggestion.create({
    data: {
      kind: "EXEC_BRIEFING",
      engine: briefing.engine,
      modelName: briefing.modelName ?? "unknown",
      entityName: "system",
      entityId: "executive-briefing",
      inputText: `${AUTO_BRIEFING_MARKER} Sức khoẻ ${briefing.healthScore}/100 · ${facts.openTasks} việc mở · ${facts.periodName ?? "chưa có kỳ KPI"}`,
      payload: JSON.stringify(briefing),
      confidencePercent: facts.predictionAccuracy ?? 0,
      rationale: briefing.executiveSummary,
      missingInfo: facts.predictionSampleSize === 0 ? briefing.dataBasis : null,
      status: "PENDING",
      latencyMs: briefing.latencyMs,
      requestedById: ceo.id,
    },
  });

  const telegram = await sendExecutiveBriefingTelegram(
    briefing,
    period.name
  );

  return { sent: true, briefingId: saved.id, telegram };
}

/* ==================================================================== */
/* LƯỢT CHẠY NỀN                                                        */
/* ==================================================================== */

/**
 * Gọi từ bộ máy chạy nền: chấm dự báo cũ, dự báo mới, quét bất thường, và —
 * đúng ngày Ban Giám đốc chốt kỳ — tự soạn báo cáo giao ban gửi Telegram.
 */
export async function runAnalyticsCycle(now = new Date()) {
  const outcome = await scorePastPredictions(now);
  const scan = await runPredictiveScan({ persist: true, now });
  const anomaly = await runAnomalyScan(undefined, now);
  const briefing = await runMonthlyExecutiveBriefingIfDue(now);

  return {
    predictionsScored: outcome.scored,
    tasksPredicted: scan.scanned,
    highRisk: scan.highRisk,
    weakBasis: scan.weakBasis,
    anomalyChecked: anomaly.checked,
    anomalyFlagged: anomaly.flagged,
    anomalySkippedThinHistory: anomaly.skippedThinHistory,
    executiveBriefingSent: briefing.sent,
  };
}

export { ANOMALY_SEVERITY_LABEL };
