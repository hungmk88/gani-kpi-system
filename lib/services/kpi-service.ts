import { prisma } from "../db";
import { BusinessError } from "../rbac";
import { ERR, KPI_SCORE_CAP, KPI_STATUS_ORDER } from "../constants";
import {
  calculateKpiScore,
  detectMismatch,
  gatekeeperOutcome,
  gatekeeperRuleFor,
  kpiCapFor,
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

  // Công thức nằm MỘT chỗ (computeDerivedFields) — quét hàng loạt dùng chung,
  // không có chuyện hai nơi tính lệch nhau.
  return prisma.kpiResult.update({
    where: { id: resultId },
    data: computeDerivedFields(r),
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
  input: {
    ceoNote?: string;
    /**
     * Khoá luôn cả kỳ khi không còn dòng nào chưa chốt — chạy TRONG cùng giao
     * dịch với việc khoá dòng, để không có trạng thái "dòng đã khoá hết mà kỳ
     * vẫn mở" khi lệnh thứ hai lỗi giữa chừng.
     */
    finalizePeriodId?: string;
  } = {},
  meta: Meta = {}
) {
  const results = await prisma.kpiResult.findMany({
    where: { id: { in: resultIds } },
    include: { kpiDefinition: { include: { department: true } } },
  });

  // Ô còn lệch số chưa ai chốt thì không được khoá: khoá lúc này là ngầm chọn
  // số nhân viên tự khai — đúng điều bộ đối soát cấm.
  const openMismatch = await openMismatchKeys(results.map((r) => r.periodId));
  const plan = planCeoApproval(results, openMismatch);
  const skipped = [...plan.skipped];
  const ceoNote = input.ceoNote ?? null;
  const now = new Date();

  // MỘT giao dịch cho cả lượt chốt, ghi theo tập (updateMany / createMany)
  // thay vì 4–5 lệnh mỗi dòng: chốt kỳ 50 người × 8 chỉ tiêu trước đây là
  // ~2.000 lệnh rời, đứt giữa chừng thì nửa kỳ khoá nửa kỳ không.
  const outcome = await prisma.$transaction(
    async (tx) => {
      let claimedIds: string[] = [];
      if (plan.eligible.length > 0) {
        const ids = plan.eligible.map((e) => e.id);
        // Khoá có điều kiện: duyệt trên web và Telegram cùng lúc thì chỉ một
        // lượt thắng (Postgres khoá dòng, lượt sau thấy status đã đổi).
        const res = await tx.kpiResult.updateMany({
          where: { id: { in: ids }, status: "MANAGER_REVIEWED" },
          data: { status: "FINALIZED", ceoNote, finalizedAt: now },
        });
        if (res.count === ids.length) {
          claimedIds = ids;
        } else {
          // Có dòng vừa bị lượt khác chốt — dòng của lượt này mang đúng mốc
          // finalizedAt vừa ghi.
          const mine = await tx.kpiResult.findMany({
            where: { id: { in: ids }, status: "FINALIZED", finalizedAt: now },
            select: { id: true },
          });
          claimedIds = mine.map((m) => m.id);
        }
      }
      const claimedSet = new Set(claimedIds);
      const claimed = plan.eligible.filter((e) => claimedSet.has(e.id));
      for (const e of plan.eligible) {
        if (!claimedSet.has(e.id)) {
          skipped.push({ id: e.id, reason: "Đã được chốt ở lượt khác" });
        }
      }

      // Số chốt còn trống: gom theo giá trị, mỗi giá trị một lệnh. Thường
      // không có dòng nào (trưởng phòng / cron ngày 4 đã điền số chốt).
      const fills = new Map<number, string[]>();
      for (const e of claimed) {
        if (e.fillActualFinal === null) continue;
        fills.set(e.fillActualFinal, [...(fills.get(e.fillActualFinal) ?? []), e.id]);
      }
      for (const [value, ids] of fills) {
        await tx.kpiResult.updateMany({
          where: { id: { in: ids } },
          data: { actualFinal: value },
        });
      }
      // Điểm dẫn xuất lệch với dữ liệu (chưa kịp tự chữa) thì ghi đúng trước
      // khi khoá — mỗi dòng một bộ số riêng, nên ghi từng dòng; thường là 0.
      for (const e of claimed) {
        if (!e.derivedChanged) continue;
        await tx.kpiResult.update({ where: { id: e.id }, data: e.derived });
      }

      if (claimed.length > 0) {
        await tx.kpiReview.createMany({
          data: claimed.map((e) => ({
            kpiResultId: e.id,
            reviewerId: actor.id,
            stage: "CEO",
            action: "APPROVE",
            valueBefore: e.before.actualFinal,
            valueAfter: e.actualFinal,
            scoreBefore: e.before.weightedScore,
            scoreAfter: e.derived.weightedScore,
            reason: ceoNote,
          })),
        });
        // Nhật ký ghi TRONG giao dịch: khoá mà không có dấu vết thì thà không khoá
        await tx.auditLog.createMany({
          data: claimed.map((e) =>
            auditRow(actor, meta, {
              action: "KPI_CEO_APPROVE_LOCK",
              entityName: "kpi_results",
              entityId: e.id,
              before: { status: e.before.status, weightedScore: e.before.weightedScore },
              after: { status: "FINALIZED", weightedScore: e.derived.weightedScore },
              reason: ceoNote,
            })
          ),
        });
      }

      let periodFinalized = false;
      if (input.finalizePeriodId) {
        const remaining = await tx.kpiResult.count({
          where: { periodId: input.finalizePeriodId, status: { not: "FINALIZED" } },
        });
        if (remaining === 0) {
          const p = await tx.kpiPeriod.updateMany({
            where: { id: input.finalizePeriodId, status: { not: "FINALIZED" } },
            data: { status: "FINALIZED", isLocked: true, finalizedAt: now },
          });
          if (p.count === 1) {
            periodFinalized = true;
            await tx.auditLog.create({
              data: auditRow(actor, meta, {
                action: "KPI_PERIOD_FINALIZE",
                entityName: "kpi_periods",
                entityId: input.finalizePeriodId,
                after: { status: "FINALIZED" },
              }),
            });
          }
        }
      }

      return { claimed, periodFinalized };
    },
    // Kỳ đông người + vài dòng phải tính lại: nới hạn mặc định 5 giây
    { timeout: 30_000, maxWait: 10_000 }
  );

  // Báo cho từng nhân viên có KPI vừa được chốt — SAU giao dịch: tin nhắn đã
  // gửi thì không rút lại được nếu giao dịch phải huỷ.
  const employees = [...new Set(outcome.claimed.map((e) => e.employeeId))];
  for (const empId of employees) {
    await notify({
      userId: empId,
      title: "KPI của bạn đã được Ban Giám đốc chốt",
      body: "Điểm KPI kỳ này đã khoá. Bạn có thể xem phiếu KPI trong hệ thống.",
      level: "INFO",
      linkUrl: "/kpi",
    });
  }

  return {
    finalized: outcome.claimed.length,
    skipped,
    periodFinalized: outcome.periodFinalized,
  };
}

type ApprovalRow = Parameters<typeof computeDerivedFields>[0] & {
  id: string;
  periodId: string;
  employeeId: string;
  kpiDefinitionId: string | null;
  status: string;
  achievementPercent: number;
  weightedScore: number;
  isCapped: boolean;
  hasMismatch: boolean;
  mismatchPercent: number | null;
};

/**
 * Phần THUẦN của bước chốt: dòng nào được khoá, số chốt là gì, điểm sau khoá
 * bao nhiêu, dòng nào bị bỏ qua vì sao. Tách ra để test không cần database.
 */
export function planCeoApproval(rows: ApprovalRow[], openMismatch: Set<string>) {
  const skipped: { id: string; reason: string }[] = [];
  const eligible: {
    id: string;
    employeeId: string;
    /** Số chốt sau khi khoá */
    actualFinal: number | null;
    /** Khác null = số chốt đang trống, phải ghi giá trị này */
    fillActualFinal: number | null;
    derived: ReturnType<typeof computeDerivedFields>;
    /** Điểm dẫn xuất đang lưu lệch so với dữ liệu → phải ghi lại */
    derivedChanged: boolean;
    before: { actualFinal: number | null; weightedScore: number; status: string };
  }[] = [];

  for (const r of rows) {
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
    const derived = computeDerivedFields({ ...r, actualFinal });
    const derivedChanged =
      r.achievementPercent !== derived.achievementPercent ||
      r.weightedScore !== derived.weightedScore ||
      r.isCapped !== derived.isCapped ||
      r.hasMismatch !== derived.hasMismatch ||
      r.mismatchPercent !== derived.mismatchPercent;

    eligible.push({
      id: r.id,
      employeeId: r.employeeId,
      actualFinal,
      fillActualFinal: r.actualFinal === null ? actualFinal : null,
      derived,
      derivedChanged,
      before: { actualFinal: r.actualFinal, weightedScore: r.weightedScore, status: r.status },
    });
  }
  return { eligible, skipped };
}

/** Một dòng audit_logs đúng định dạng writeAudit — để ghi hàng loạt trong giao dịch. */
function auditRow(
  actor: SessionUser,
  meta: Meta,
  e: {
    action: string;
    entityName: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
    reason?: string | null;
  }
) {
  return {
    userId: actor.id,
    userEmail: actor.email ?? null,
    action: e.action,
    entityName: e.entityName,
    entityId: e.entityId,
    beforePayload: e.before ? JSON.stringify(e.before) : null,
    afterPayload: e.after ? JSON.stringify(e.after) : null,
    reason: e.reason ?? null,
    ipAddress: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  };
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
 * NƠI DUY NHẤT tính các trường dẫn xuất của một dòng KPI (mức đạt, điểm có
 * trọng số, cờ trần, cờ lệch số). Thuần — không truy vấn, không ghi.
 *
 * - Số dùng để chấm: số chốt → số nhân viên khai → số hệ thống.
 * - Trần Sales 120% (10/09/2026), phòng khác giữ trần chung 150%.
 * - Chưa gán chỉ tiêu thì 0 điểm, không đoán chiều.
 * - Gatekeeper Sales: trả hàng/khiếu nại vượt ngưỡng thì trừ THẲNG vào tổng.
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
  const cap = kpiCapFor(r.kpiDefinition?.department?.code);

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

  const gate = gatekeeperRuleFor(r.kpiDefinition?.code);
  if (gate) {
    // Gatekeeper không có "mức đạt": không bao giờ "chạm trần" (trước đây số
    // trả hàng 0% tính ra chạm trần → giao diện ghi "0,00 điểm · chạm trần").
    calc = {
      ...calc,
      isCapped: false,
      weightedScore:
        gatekeeperOutcome(gate, effective) === "FAIL"
          ? -gate.penaltyPoints
          : calc.weightedScore,
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
