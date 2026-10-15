import { prisma } from "../db";
import { BusinessError } from "../rbac";
import {
  ERR,
  KPI_SCORE_CAP,
  KPI_STATUS_ORDER,
  SALES_DEPARTMENT_CODE,
  SALES_KPI_CAP,
  SALES_RETURN_RATE_GATEKEEPER,
} from "../constants";
import {
  calculateKpiScore,
  detectMismatch,
  isManagerReviewOpen,
  isSelfReviewOpen,
  round2,
} from "../kpi";
import { writeAudit } from "../audit";
import { vnParts } from "../vn-time";
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
    include: { kpiDefinition: { include: { department: true } } },
  });
  if (!r) throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy dòng KPI.", 404);

  // Số dùng để chấm: ưu tiên số chốt, chưa có thì lấy số nhân viên khai,
  // chưa có nữa thì lấy số hệ thống.
  const effective =
    r.actualFinal ?? r.actualSelf ?? r.actualSystem ?? null;

  // Trần Sales là 120% (tài liệu truyền thông KPI Sales, 10/09/2026) — khác
  // trần 150% chung toàn công ty. Chỉ Sales bị ghi đè, phòng ban khác giữ
  // nguyên KPI_SCORE_CAP mặc định.
  const cap =
    r.kpiDefinition?.department?.code === SALES_DEPARTMENT_CODE
      ? SALES_KPI_CAP
      : undefined;

  // Chưa gán chỉ tiêu thì không có gì để chấm — cho điểm 0, không đoán chiều.
  let calc = r.kpiDefinition
    ? calculateKpiScore({
        target: r.targetValue ?? 0,
        actual: effective,
        weight: r.weightPercent ?? 0,
        isHigherBetter: r.kpiDefinition.isHigherBetter,
        cap,
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
  // Trưởng phòng đã duyệt rồi thì nhân viên không khai đè được nữa — nếu
  // không, dòng bị kéo lùi về SELF_REVIEWED mà số chốt của trưởng phòng vẫn
  // thắng, số mới của nhân viên thành vô nghĩa.
  if ((KPI_STATUS_ORDER[r.status] ?? 0) >= KPI_STATUS_ORDER.MANAGER_REVIEWED) {
    throw new BusinessError(
      ERR.SLA_LOCKED,
      "Trưởng phòng đã duyệt dòng này. Cần sửa thì trao đổi với trưởng phòng.",
      409
    );
  }
  if (!isSelfReviewOpen(r.period)) {
    throw new BusinessError(
      ERR.SLA_LOCKED,
      `Đã quá hạn tự khai (23:59 ngày ${vnParts(r.period.selfReviewDeadline).day}). Liên hệ trưởng phòng nếu cần bổ sung.`,
      400
    );
  }

  const before = { actualSelf: r.actualSelf, selfNote: r.selfNote, status: r.status };

  // Ghi có điều kiện: trưởng phòng vừa duyệt đúng lúc này thì lượt khai này
  // thua, không kéo dòng lùi về SELF_REVIEWED.
  const claimed = await prisma.kpiResult.updateMany({
    where: { id: resultId, status: { in: ["DRAFT", "SELF_REVIEWED"] } },
    data: {
      actualSelf: input.actualSelf,
      selfNote: input.selfNote ?? null,
      evidenceUrl: input.evidenceUrl ?? r.evidenceUrl,
      status: "SELF_REVIEWED",
      selfSubmittedAt: new Date(),
    },
  });
  if (claimed.count !== 1) {
    throw new BusinessError(
      ERR.SLA_LOCKED,
      "Dòng KPI vừa được trưởng phòng duyệt — tải lại trang để xem số mới.",
      409
    );
  }

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
    // KPI của chính trưởng phòng do Ban Giám đốc duyệt, không tự duyệt mình
    if (r.employeeId === actor.id) {
      throw new BusinessError(
        ERR.FORBIDDEN,
        "Không thể tự duyệt KPI của chính bạn — Ban Giám đốc sẽ duyệt.",
        403
      );
    }
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
        `Đã quá hạn duyệt của trưởng phòng (23:59 ngày ${vnParts(r.period.managerReviewDeadline).day}).`,
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

  const claimed = await prisma.kpiResult.updateMany({
    where: { id: resultId, status: { not: "FINALIZED" } },
    data: {
      actualFinal: input.actualFinal,
      managerNote: input.managerNote ?? null,
      status: "MANAGER_REVIEWED",
      managerReviewedAt: new Date(),
    },
  });
  if (claimed.count !== 1) {
    throw new BusinessError(
      ERR.KPI_FINALIZED,
      "Dòng KPI vừa được Ban Giám đốc chốt — không sửa được nữa.",
      409
    );
  }

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
  const skipped: { id: string; reason: string }[] = [];

  // Ô còn lệch số chưa ai chốt thì không được khoá: khoá lúc này là ngầm chọn
  // số nhân viên tự khai — đúng điều bộ đối soát cấm.
  const openMismatch = await openMismatchKeys(results.map((r) => r.periodId));

  for (const r of results) {
    if (r.status === "FINALIZED") continue;
    // Đúng thứ tự 3 cấp: chỉ chốt dòng đã qua trưởng phòng (duyệt tay hoặc
    // tự khoá ngày 4). Dòng còn ở bước nhân viên thì bỏ qua và báo lại.
    if (r.status !== "MANAGER_REVIEWED") {
      skipped.push({ id: r.id, reason: "Chưa qua bước trưởng phòng duyệt" });
      continue;
    }
    if (openMismatch.has(mismatchKey(r))) {
      skipped.push({
        id: r.id,
        reason: "Còn lệch số chưa chốt — chốt ở trang Đối soát trước",
      });
      continue;
    }

    // Chưa có số chốt thì lấy số nhân viên khai / số hệ thống. Không có số
    // nào thì để TRỐNG (chấm 0 điểm) — tuyệt đối không quy về 0, vì với chỉ
    // tiêu "càng thấp càng tốt" số 0 là điểm tối đa.
    const actualFinal = r.actualFinal ?? r.actualSelf ?? r.actualSystem ?? null;

    // Khoá có điều kiện: duyệt trên web và Telegram cùng lúc thì chỉ một lượt thắng
    const claimed = await prisma.kpiResult.updateMany({
      where: { id: r.id, status: "MANAGER_REVIEWED" },
      data: {
        actualFinal,
        ceoNote: input.ceoNote ?? null,
        status: "FINALIZED",
        finalizedAt: new Date(),
      },
    });
    if (claimed.count !== 1) {
      skipped.push({ id: r.id, reason: "Đã được chốt ở lượt khác" });
      continue;
    }
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
  const finalizedSet = new Set(finalized);
  const employees = [
    ...new Set(results.filter((r) => finalizedSet.has(r.id)).map((r) => r.employeeId)),
  ];
  for (const empId of employees) {
    await notify({
      userId: empId,
      title: "KPI của bạn đã được Ban Giám đốc chốt",
      body: "Điểm KPI kỳ này đã khoá. Bạn có thể xem phiếu KPI trong hệ thống.",
      level: "INFO",
      linkUrl: "/kpi",
    });
  }

  return { finalized: finalized.length, skipped };
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
  // Đường này chỉ dành cho dòng ĐÃ CHỐT. Dòng chưa chốt đi đúng luồng duyệt.
  if (r.status !== "FINALIZED") {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      "Dòng KPI này chưa chốt — sửa qua luồng duyệt bình thường.",
      400
    );
  }

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
  // Một truy vấn đọc cho cả lượt, tính trong bộ nhớ, chỉ GHI dòng nào số dẫn
  // xuất thật sự đổi — trước đây mỗi dòng 2 truy vấn + 1 lệnh ghi dù không đổi
  // gì, cron Vercel 60 giây không gánh nổi khi số dòng lớn.
  const rows = await prisma.kpiResult.findMany({
    where: { status: { not: "FINALIZED" } },
    include: { kpiDefinition: { include: { department: true } } },
  });

  for (const r of rows) {
    const next = computeDerivedFields(r);
    const same =
      r.achievementPercent === next.achievementPercent &&
      r.weightedScore === next.weightedScore &&
      r.isCapped === next.isCapped &&
      r.hasMismatch === next.hasMismatch &&
      r.mismatchPercent === next.mismatchPercent;
    if (same) continue;

    // Ghi có điều kiện: nếu số nguồn vừa bị sửa ở luồng khác thì luồng đó đã
    // tự gọi recalcResult — không ghi đè bằng số tính từ dữ liệu cũ.
    await prisma.kpiResult.updateMany({
      where: {
        id: r.id,
        status: { not: "FINALIZED" },
        kpiDefinitionId: r.kpiDefinitionId,
        targetValue: r.targetValue,
        weightPercent: r.weightPercent,
        actualSystem: r.actualSystem,
        actualSelf: r.actualSelf,
        actualFinal: r.actualFinal,
      },
      data: next,
    });
  }
  // Giữ kiểu trả về cũ (số dòng đã xét) để báo cáo cron không đổi ý nghĩa
  return rows.length;
}

/**
 * BẢN SAO THUẦN của phần tính toán trong recalcResult (không truy vấn, không
 * ghi) — dùng cho quét hàng loạt. Sửa công thức ở recalcResult thì PHẢI sửa
 * cả ở đây.
 */
function computeDerivedFields(r: {
  targetValue: number | null;
  weightPercent: number | null;
  actualSystem: number | null;
  actualSelf: number | null;
  actualFinal: number | null;
  kpiDefinition: {
    code: string;
    isHigherBetter: boolean;
    department: { code: string } | null;
  } | null;
}) {
  const effective = r.actualFinal ?? r.actualSelf ?? r.actualSystem ?? null;
  const cap =
    r.kpiDefinition?.department?.code === SALES_DEPARTMENT_CODE
      ? SALES_KPI_CAP
      : undefined;

  let calc = r.kpiDefinition
    ? calculateKpiScore({
        target: r.targetValue ?? 0,
        actual: effective,
        weight: r.weightPercent ?? 0,
        isHigherBetter: r.kpiDefinition.isHigherBetter,
        cap,
      })
    : {
        achievementPercent: 0,
        weightedScore: 0,
        isCapped: false,
        rawAchievementPercent: 0,
      };

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
  return {
    achievementPercent: calc.achievementPercent,
    weightedScore: calc.weightedScore,
    isCapped: calc.isCapped,
    hasMismatch: mismatch.hasMismatch,
    mismatchPercent: mismatch.mismatchPercent,
  };
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
    const managerDue =
      (fresh.status === "SELF_LOCKED" || fresh.status === "OPEN") &&
      now > new Date(fresh.managerReviewDeadline);

    // Kỳ đã khoá trưởng phòng mà vẫn còn dòng ở bước trước (vd nạp Excel tạo
    // muộn) -> đẩy nốt lên, nếu không CEO không chốt được và kỳ kẹt mãi.
    if (fresh.status === "MANAGER_LOCKED") {
      const late = await escalatePendingRows(p.id, now);
      if (late.moved > 0) {
        report.push(
          `[${p.name}] ${late.moved} dòng còn sót ở bước trước đã đẩy lên hàng chờ Ban Giám đốc` +
            (late.mismatched ? ` (${late.mismatched} dòng còn lệch số, chờ chốt đối soát).` : ".")
        );
      }
    }

    if (managerDue) {
      const { moved, mismatched } = await escalatePendingRows(p.id, now);
      const pending = { length: moved };
      if (mismatched > 0) {
        report.push(
          `[${p.name}] ${mismatched} dòng còn lệch số chưa chốt — đẩy lên Ban Giám đốc nhưng KHÔNG tự chọn số, chờ chốt ở trang Đối soát.`
        );
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
        details: `${pending.length} dòng trưởng phòng chưa xử lý kịp đã tự động chuyển lên. Hạn duyệt của BGĐ là ngày ${vnParts(fresh.ceoApprovalDeadline).day}.`,
        actionPath: `/kpi/${p.id}`,
      });
    }
  }

  if (report.length === 0) report.push("Không có kỳ KPI nào tới hạn khoá.");
  return report;
}

export { KPI_SCORE_CAP };


/* ------------------------------------------------- lệch số & đẩy dòng */

function mismatchKey(r: { periodId: string; employeeId: string; kpiDefinitionId: string | null }) {
  return `${r.periodId}:${r.employeeId}:${r.kpiDefinitionId ?? ""}`;
}

/** Các ô (kỳ, người, chỉ tiêu) đang lệch số mà chưa ai chốt. */
async function openMismatchKeys(periodIds: string[]) {
  const ids = [...new Set(periodIds)];
  if (ids.length === 0) return new Set<string>();
  const rows = await prisma.reconciliation.findMany({
    where: { periodId: { in: ids }, status: "MISMATCH" },
    select: { periodId: true, employeeId: true, kpiDefinitionId: true },
  });
  return new Set(rows.map(mismatchKey));
}

/**
 * Đẩy các dòng còn ở DRAFT / SELF_REVIEWED của một kỳ lên MANAGER_REVIEWED
 * (hàng chờ Ban Giám đốc). Số chốt lấy theo thứ tự chốt → tự khai → hệ thống,
 * RIÊNG ô đang lệch số chưa chốt thì không tự chọn số nào: giữ nguyên
 * actualFinal để Ban Giám đốc chốt ở trang Đối soát (ceoApprove cũng chặn).
 */
async function escalatePendingRows(periodId: string, now: Date) {
  const pending = await prisma.kpiResult.findMany({
    where: { periodId, status: { in: ["DRAFT", "SELF_REVIEWED"] } },
  });
  const openMismatch = await openMismatchKeys([periodId]);
  let moved = 0;
  let mismatched = 0;
  for (const r of pending) {
    const isMismatch = openMismatch.has(mismatchKey(r));
    if (isMismatch) mismatched++;
    const res = await prisma.kpiResult.updateMany({
      where: { id: r.id, status: { in: ["DRAFT", "SELF_REVIEWED"] } },
      data: {
        // Không có số nào thì để trống (0 điểm), không quy về 0
        actualFinal: isMismatch
          ? r.actualFinal
          : (r.actualFinal ?? r.actualSelf ?? r.actualSystem ?? null),
        status: "MANAGER_REVIEWED",
        managerReviewedAt: now,
      },
    });
    if (res.count === 1) {
      moved++;
      await recalcResult(r.id);
    }
  }
  return { moved, mismatched };
}
