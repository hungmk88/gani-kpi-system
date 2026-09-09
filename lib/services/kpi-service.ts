import { prisma } from "../db";
import { BusinessError } from "../rbac";
import { ERR, KPI_SCORE_CAP, SALES_RETURN_RATE_GATEKEEPER } from "../constants";
import {
  calculateKpiScore,
  detectMismatch,
  isManagerReviewOpen,
  isSelfReviewOpen,
  round2,
} from "../kpi";
import { writeAudit } from "../audit";
import { notify, sendCeoAlert } from "../telegram";
import type { SessionUser } from "../auth";

type Meta = { ip?: string | null; userAgent?: string | null };

/**
 * Tính lại toàn bộ số liệu dẫn xuất của 1 dòng KPI và ghi xuống DB.
 * Đây là NƠI DUY NHẤT được phép ghi achievementPercent / weightedScore,
 * để không bao giờ có chuyện điểm bị gõ tay từ ngoài vào.
 */
export async function recalcResult(resultId: string) {
  const r = await prisma.kpiResult.findUnique({
    where: { id: resultId },
    include: { kpiDefinition: true },
  });
  if (!r) throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy dòng KPI.", 404);

  // Số dùng để chấm: ưu tiên số chốt, chưa có thì lấy số nhân viên khai,
  // chưa có nữa thì lấy số hệ thống.
  const effective =
    r.actualFinal ?? r.actualSelf ?? r.actualSystem ?? null;

  // Chưa gán chỉ tiêu thì không có gì để chấm — cho điểm 0, không đoán chiều.
  let calc = r.kpiDefinition
    ? calculateKpiScore({
        target: r.targetValue ?? 0,
        actual: effective,
        weight: r.weightPercent ?? 0,
        isHigherBetter: r.kpiDefinition.isHigherBetter,
      })
    : {
        achievementPercent: 0,
        weightedScore: 0,
        isCapped: false,
        rawAchievementPercent: 0,
      };

  // Gatekeeper Sales: trả hàng/khiếu nại vượt ngưỡng thì trừ THẲNG vào tổng
  // điểm, không đi qua công thức trọng số × mức đạt như mọi chỉ tiêu khác.
  // Chỉ tiêu này có defaultWeight = 0 nên bình thường weightedScore đã là 0 —
  // chỗ này chỉ ghi đè khi thật sự vượt ngưỡng.
  if (
    r.kpiDefinition?.code === SALES_RETURN_RATE_GATEKEEPER.KPI_CODE &&
    effective !== null &&
    effective !== undefined &&
    effective > SALES_RETURN_RATE_GATEKEEPER.THRESHOLD_PERCENT
  ) {
    calc = {
      ...calc,
      weightedScore: -SALES_RETURN_RATE_GATEKEEPER.PENALTY_POINTS,
    };
  }

  const mismatch = detectMismatch(r.actualSystem, r.actualSelf);

  return prisma.kpiResult.update({
    where: { id: resultId },
    data: {
      achievementPercent: calc.achievementPercent,
      weightedScore: calc.weightedScore,
      isCapped: calc.isCapped,
      hasMismatch: mismatch.hasMismatch,
      mismatchPercent: mismatch.mismatchPercent,
    },
    include: { kpiDefinition: true, employee: true, period: true },
  });
}

/** BƯỚC 1 — Nhân viên tự khai + tự nhận xét, hạn chót 23:59 ngày 2. */
export async function submitSelfReview(
  actor: SessionUser,
  resultId: string,
  input: { actualSelf: number; selfNote?: string; evidenceUrl?: string },
  meta: Meta = {}
) {
  const r = await prisma.kpiResult.findUnique({
    where: { id: resultId },
    include: { period: true, kpiDefinition: true },
  });
  if (!r) throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy dòng KPI.", 404);

  if (r.employeeId !== actor.id) {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Bạn chỉ được tự khai KPI của chính mình.",
      403
    );
  }
  if (r.status === "FINALIZED") {
    throw new BusinessError(ERR.KPI_FINALIZED, "KPI kỳ này đã chốt, không sửa được.", 409);
  }
  if (!isSelfReviewOpen(r.period)) {
    throw new BusinessError(
      ERR.SLA_LOCKED,
      `Đã quá hạn tự khai (23:59 ngày ${new Date(r.period.selfReviewDeadline).getDate()}). Liên hệ trưởng phòng nếu cần bổ sung.`,
      400
    );
  }

  const before = { actualSelf: r.actualSelf, selfNote: r.selfNote, status: r.status };

  await prisma.kpiResult.update({
    where: { id: resultId },
    data: {
      actualSelf: input.actualSelf,
      selfNote: input.selfNote ?? null,
      evidenceUrl: input.evidenceUrl ?? r.evidenceUrl,
      status: "SELF_REVIEWED",
      selfSubmittedAt: new Date(),
    },
  });

  const updated = await recalcResult(resultId);

  await prisma.kpiReview.create({
    data: {
      kpiResultId: resultId,
      reviewerId: actor.id,
      stage: "SELF",
      action: "SUBMIT",
      valueBefore: r.actualSelf,
      valueAfter: input.actualSelf,
      scoreBefore: r.weightedScore,
      scoreAfter: updated.weightedScore,
      reason: input.selfNote ?? null,
    },
  });

  await writeAudit({
    actor,
    action: "KPI_SELF_REVIEW",
    entityName: "kpi_results",
    entityId: resultId,
    before,
    after: { actualSelf: input.actualSelf, status: "SELF_REVIEWED" },
    ...meta,
  });

  // Lệch số quá ngưỡng -> báo đỏ cho Ban Giám đốc ngay
  if (updated.hasMismatch) {
    await sendCeoAlert({
      title: "Lệch số liệu KPI (Data Mismatch)",
      details: `${updated.employee.fullName} khai ${input.actualSelf} cho chỉ tiêu "${updated.kpiDefinition?.name ?? "—"}", số hệ thống là ${updated.actualSystem}. Lệch ${updated.mismatchPercent}%.`,
      actionPath: `/kpi/${updated.periodId}`,
    });
  }

  return updated;
}

/** BƯỚC 2 — Trưởng phòng duyệt / điều chỉnh, hạn chót 23:59 ngày 4. */
export async function managerReview(
  actor: SessionUser,
  resultId: string,
  input: { actualFinal: number; managerNote?: string; reason?: string },
  meta: Meta = {}
) {
  const r = await prisma.kpiResult.findUnique({
    where: { id: resultId },
    include: { period: true, employee: true, kpiDefinition: true },
  });
  if (!r) throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy dòng KPI.", 404);

  if (r.status === "FINALIZED") {
    throw new BusinessError(ERR.KPI_FINALIZED, "KPI đã chốt. Chỉ Ban Giám đốc mới mở lại được.", 409);
  }
  if (actor.role === "MANAGER") {
    if (r.employee.departmentId !== actor.departmentId) {
      throw new BusinessError(
        ERR.FORBIDDEN,
        "Bạn chỉ được duyệt KPI của nhân sự trong phòng ban mình.",
        403
      );
    }
    if (!isManagerReviewOpen(r.period)) {
      throw new BusinessError(
        ERR.SLA_LOCKED,
        `Đã quá hạn duyệt của trưởng phòng (23:59 ngày ${new Date(r.period.managerReviewDeadline).getDate()}).`,
        400
      );
    }
  }

  // Điều chỉnh khác số nhân viên khai thì bắt buộc có lý do
  const changed =
    r.actualSelf !== null && round2(input.actualFinal) !== round2(r.actualSelf);
  if (changed && !input.reason?.trim()) {
    throw new BusinessError(
      ERR.REASON_REQUIRED,
      "Bạn sửa khác số nhân viên đã khai — bắt buộc nhập lý do điều chỉnh.",
      400
    );
  }

  const before = {
    actualFinal: r.actualFinal,
    weightedScore: r.weightedScore,
    status: r.status,
  };

  await prisma.kpiResult.update({
    where: { id: resultId },
    data: {
      actualFinal: input.actualFinal,
      managerNote: input.managerNote ?? null,
      status: "MANAGER_REVIEWED",
      managerReviewedAt: new Date(),
    },
  });

  const updated = await recalcResult(resultId);

  await prisma.kpiReview.create({
    data: {
      kpiResultId: resultId,
      reviewerId: actor.id,
      stage: "MANAGER",
      action: changed ? "ADJUST" : "APPROVE",
      valueBefore: r.actualSelf,
      valueAfter: input.actualFinal,
      scoreBefore: r.weightedScore,
      scoreAfter: updated.weightedScore,
      reason: input.reason ?? input.managerNote ?? null,
    },
  });

  await writeAudit({
    actor,
    action: changed ? "KPI_MANAGER_ADJUST" : "KPI_MANAGER_APPROVE",
    entityName: "kpi_results",
    entityId: resultId,
    before,
    after: {
      actualFinal: input.actualFinal,
      weightedScore: updated.weightedScore,
      status: "MANAGER_REVIEWED",
    },
    reason: input.reason ?? null,
    ...meta,
  });

  if (changed) {
    await notify({
      userId: r.employeeId,
      title: "Trưởng phòng đã điều chỉnh KPI của bạn",
      body: `Chỉ tiêu "${r.kpiDefinition?.name ?? "—"}": số bạn khai ${r.actualSelf} → số chốt ${input.actualFinal}. Lý do: ${input.reason}`,
      level: "WARNING",
      linkUrl: `/kpi/${r.periodId}`,
    });
  }

  return updated;
}

/** BƯỚC 3 — Ban Giám đốc duyệt và KHOÁ VĨNH VIỄN. */
export async function ceoApprove(
  actor: SessionUser,
  resultIds: string[],
  input: { ceoNote?: string } = {},
  meta: Meta = {}
) {
  const results = await prisma.kpiResult.findMany({
    where: { id: { in: resultIds } },
    include: { employee: true, kpiDefinition: true },
  });

  const finalized: string[] = [];

  for (const r of results) {
    if (r.status === "FINALIZED") continue;

    // Chưa có số chốt thì lấy số nhân viên khai / số hệ thống làm số chốt
    const actualFinal = r.actualFinal ?? r.actualSelf ?? r.actualSystem ?? 0;

    await prisma.kpiResult.update({
      where: { id: r.id },
      data: {
        actualFinal,
        ceoNote: input.ceoNote ?? null,
        status: "FINALIZED",
        finalizedAt: new Date(),
      },
    });
    const updated = await recalcResult(r.id);

    await prisma.kpiReview.create({
      data: {
        kpiResultId: r.id,
        reviewerId: actor.id,
        stage: "CEO",
        action: "APPROVE",
        valueBefore: r.actualFinal,
        valueAfter: actualFinal,
        scoreBefore: r.weightedScore,
        scoreAfter: updated.weightedScore,
        reason: input.ceoNote ?? null,
      },
    });

    await writeAudit({
      actor,
      action: "KPI_CEO_APPROVE_LOCK",
      entityName: "kpi_results",
      entityId: r.id,
      before: { status: r.status, weightedScore: r.weightedScore },
      after: { status: "FINALIZED", weightedScore: updated.weightedScore },
      reason: input.ceoNote ?? null,
      ...meta,
    });

    finalized.push(r.id);
  }

  // Báo cho từng nhân viên có KPI vừa được chốt
  const employees = [...new Set(results.map((r) => r.employeeId))];
  for (const empId of employees) {
    await notify({
      userId: empId,
      title: "KPI của bạn đã được Ban Giám đốc chốt",
      body: "Điểm KPI kỳ này đã khoá. Bạn có thể xem phiếu KPI trong hệ thống.",
      level: "INFO",
      linkUrl: "/kpi",
    });
  }

  return { finalized: finalized.length };
}

/**
 * Sửa KPI SAU KHI ĐÃ KHOÁ — chỉ CEO, BẮT BUỘC có lý do.
 * Mọi lần sửa đều đẻ ra 1 bản ghi audit không thể xoá.
 */
export async function editAfterLock(
  actor: SessionUser,
  resultId: string,
  input: { actualFinal: number; reason: string },
  meta: Meta = {}
) {
  if (actor.role !== "CEO") {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Chỉ Ban Giám đốc mới được sửa KPI đã chốt.",
      403
    );
  }
  if (!input.reason?.trim() || input.reason.trim().length < 10) {
    throw new BusinessError(
      ERR.REASON_REQUIRED,
      "Sửa KPI đã chốt bắt buộc ghi lý do rõ ràng (tối thiểu 10 ký tự).",
      400
    );
  }

  const r = await prisma.kpiResult.findUnique({
    where: { id: resultId },
    include: { kpiDefinition: true },
  });
  if (!r) throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy dòng KPI.", 404);

  await prisma.kpiResult.update({
    where: { id: resultId },
    data: { actualFinal: input.actualFinal },
  });
  const updated = await recalcResult(resultId);

  await prisma.kpiReview.create({
    data: {
      kpiResultId: resultId,
      reviewerId: actor.id,
      stage: "REOPEN",
      action: "EDIT_AFTER_LOCK",
      valueBefore: r.actualFinal,
      valueAfter: input.actualFinal,
      scoreBefore: r.weightedScore,
      scoreAfter: updated.weightedScore,
      reason: input.reason,
    },
  });

  await writeAudit({
    actor,
    action: "KPI_EDIT_AFTER_LOCK",
    entityName: "kpi_results",
    entityId: resultId,
    before: { actualFinal: r.actualFinal, weightedScore: r.weightedScore },
    after: {
      actualFinal: input.actualFinal,
      weightedScore: updated.weightedScore,
    },
    reason: input.reason,
    ...meta,
  });

  await notify({
    userId: r.employeeId,
    title: "Ban Giám đốc đã sửa KPI đã chốt của bạn",
    body: `Chỉ tiêu "${r.kpiDefinition?.name ?? "—"}": ${r.actualFinal} → ${input.actualFinal}. Lý do: ${input.reason}`,
    level: "WARNING",
    linkUrl: "/kpi",
  });

  return updated;
}

/**
 * Tính lại toàn bộ số liệu dẫn xuất của các dòng KPI CHƯA CHỐT.
 *
 * Dòng đã FINALIZED không bị đụng tới — điểm đã khoá là đã khoá.
 * Bước này để hệ thống tự chữa lành: nếu số nguồn thay đổi ở đâu đó
 * (nạp Excel, iPOS đẩy về, sửa chỉ tiêu) mà điểm chưa kịp cập nhật,
 * nhịp chạy nền tiếp theo sẽ đưa mọi thứ về đúng.
 */
export async function recalcOpenResults() {
  const rows = await prisma.kpiResult.findMany({
    where: { status: { not: "FINALIZED" } },
    select: { id: true },
  });
  for (const r of rows) {
    await recalcResult(r.id);
  }
  return rows.length;
}

/**
 * CRON 2-4-5 — tự động khoá từng chặng.
 * Gọi được từ scheduler nội bộ hoặc từ endpoint /api/cron/kpi-lock.
 * Hàm này idempotent: chạy lại nhiều lần cũng không hỏng dữ liệu.
 */
export async function runKpiLockCycle(now = new Date()) {
  const periods = await prisma.kpiPeriod.findMany({
    where: { status: { not: "FINALIZED" } },
  });

  const report: string[] = [];

  for (const p of periods) {
    // Chặng 1: quá 23:59 ngày 2 -> khoá tự khai
    if (p.status === "OPEN" && now > new Date(p.selfReviewDeadline)) {
      const n = await prisma.kpiResult.updateMany({
        where: { periodId: p.id, status: "DRAFT" },
        data: { status: "SELF_REVIEWED", selfSubmittedAt: now },
      });
      await prisma.kpiPeriod.update({
        where: { id: p.id },
        data: { status: "SELF_LOCKED" },
      });
      report.push(
        `[${p.name}] Khoá tự khai của nhân viên. ${n.count} dòng chưa khai bị đẩy sang bước duyệt.`
      );
      await sendCeoAlert({
        title: `Đã khoá bước tự khai KPI ${p.name}`,
        details: `${n.count} dòng KPI nhân viên không khai kịp hạn đã bị đẩy sang trưởng phòng.`,
        actionPath: `/kpi/${p.id}`,
      });
    }

    const fresh = await prisma.kpiPeriod.findUnique({ where: { id: p.id } });
    if (!fresh) continue;

    // Chặng 2: quá 23:59 ngày 4 -> khoá trưởng phòng, đẩy lên hàng chờ CEO
    if (
      (fresh.status === "SELF_LOCKED" || fresh.status === "OPEN") &&
      now > new Date(fresh.managerReviewDeadline)
    ) {
      const pending = await prisma.kpiResult.findMany({
        where: { periodId: p.id, status: { in: ["DRAFT", "SELF_REVIEWED"] } },
      });
      for (const r of pending) {
        await prisma.kpiResult.update({
          where: { id: r.id },
          data: {
            actualFinal: r.actualFinal ?? r.actualSelf ?? r.actualSystem ?? 0,
            status: "MANAGER_REVIEWED",
            managerReviewedAt: now,
          },
        });
        await recalcResult(r.id);
      }
      await prisma.kpiPeriod.update({
        where: { id: p.id },
        data: { status: "MANAGER_LOCKED" },
      });
      report.push(
        `[${p.name}] Khoá duyệt của trưởng phòng. ${pending.length} dòng tự động đẩy lên hàng chờ Ban Giám đốc.`
      );
      await sendCeoAlert({
        title: `KPI ${p.name} đã sẵn sàng để Ban Giám đốc duyệt`,
        details: `${pending.length} dòng trưởng phòng chưa xử lý kịp đã tự động chuyển lên. Hạn duyệt của BGĐ là ngày ${new Date(fresh.ceoApprovalDeadline).getDate()}.`,
        actionPath: `/kpi/${p.id}`,
      });
    }
  }

  if (report.length === 0) report.push("Không có kỳ KPI nào tới hạn khoá.");
  return report;
}

export { KPI_SCORE_CAP };
