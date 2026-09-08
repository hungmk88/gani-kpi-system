import { prisma } from "../db";
import { BusinessError } from "../rbac";
import { ERR } from "../constants";
import { writeAudit } from "../audit";
import { notify } from "../notify";
import { sendCeoAlert } from "../telegram";
import {
  computeFinalScore,
  computeQualityLoss,
  computeShiftMetrics,
  computeStdMaterialNorm,
  computeTier2,
  tierWeightsFor,
  type ParticipantFacts,
  type ShiftFacts,
} from "../production/kpi-engine";
import { runAntiGamingRules } from "../production/anti-gaming";
import { BEHAVIOR_LABEL } from "../production/constants";
import type { SessionUser } from "../auth";

/**
 * LUỒNG DUYỆT SỐ LIỆU CA SẢN XUẤT — 3 BƯỚC BẮT BUỘC.
 *
 *   DRAFT          Sản xuất khai sản lượng, giờ công, NVL kho cấp
 *      ↓
 *   QC_APPROVED    KCS xác nhận đạt / làm lại / phế / vi phạm HACCP
 *      ↓
 *   LOCKED         Ban Giám đốc chốt chỉ tiêu và khoá số
 *                  → lúc này mới chấm điểm và quét chống chạy chỉ tiêu
 *
 * Ba nguyên tắc không được phá:
 *   1. Người khai sản lượng KHÔNG được tự xác nhận phẩm chất của chính mình.
 *   2. Chấm điểm chỉ chạy ở bước cuối — trước đó số còn sửa được, chấm là vô nghĩa.
 *   3. Ca đã khoá thì đóng băng. Muốn sửa phải mở lại có lý do, và mọi thứ vào nhật ký.
 */

type Meta = { ip?: string | null; userAgent?: string | null };

/* ------------------------------------------------------------ PHÂN QUYỀN */

function canEnterDraft(u: SessionUser & { productionRole?: string | null }) {
  if (u.role === "CEO") return true;
  return ["WORKER", "TEAM_LEADER", "SUPERVISOR", "PRODUCTION_DIRECTOR"].includes(
    u.productionRole ?? ""
  );
}

function canQcApprove(u: SessionUser & { productionRole?: string | null }) {
  return u.productionRole === "QC_OFFICER" || u.role === "CEO";
}

function canLock(u: SessionUser) {
  // Bản thiết kế ghi rõ: bước 3 là của CEO / Ban Giám đốc
  return u.role === "CEO";
}

export function canSeeMoney(
  u: SessionUser & { productionRole?: string | null }
) {
  return u.role === "CEO" || u.productionRole === "PRODUCTION_DIRECTOR";
}

/** Nạp thêm vai trò trong xưởng cho phiên đăng nhập. */
export async function withProductionRole(user: SessionUser) {
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { productionRole: true },
  });
  return { ...user, productionRole: row?.productionRole ?? null };
}

/* ======================================================= BƯỚC 1 — DRAFT */

export async function submitShiftDraft(
  actor: SessionUser & { productionRole?: string | null },
  input: {
    shiftDate: Date;
    shiftType: string;
    skuId: string;
    rawOutputKg: number;
    totalLaborHours: number;
    downtimeHours: number;
    rawMaterialInputKg: number;
    draftNote?: string | null;
    participants: {
      userId: string;
      stage: string;
      hoursWorked: number;
      scheduledHours: number;
    }[];
  },
  meta: Meta = {}
) {
  if (!canEnterDraft(actor)) {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Bạn không có vai trò trong xưởng để khai báo ca sản xuất.",
      403
    );
  }
  if (input.participants.length === 0) {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      "Phải khai ít nhất một người làm ca này — không có người thì không chấm điểm cho ai được.",
      400
    );
  }

  const sku = await prisma.productSku.findUnique({ where: { id: input.skuId } });
  if (!sku || !sku.isActive) {
    throw new BusinessError(
      ERR.NOT_FOUND,
      "Mã sản phẩm không tồn tại hoặc đã ngưng dùng.",
      404
    );
  }

  const day = new Date(input.shiftDate);
  day.setHours(0, 0, 0, 0);

  const dup = await prisma.productionShiftLog.findUnique({
    where: {
      shiftDate_shiftType_skuId: {
        shiftDate: day,
        shiftType: input.shiftType,
        skuId: input.skuId,
      },
    },
  });
  if (dup) {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      `Ca ${input.shiftType} ngày ${day.toLocaleDateString("vi-VN")} cho mã ${sku.skuCode} đã được khai rồi.`,
      409
    );
  }

  const totalHours = input.participants.reduce((s, p) => s + p.hoursWorked, 0);
  if (Math.abs(totalHours - input.totalLaborHours) > 0.51) {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      `Tổng giờ công khai là ${input.totalLaborHours} nhưng cộng giờ của ${input.participants.length} người lại được ${totalHours}. Hai số này phải khớp nhau.`,
      400
    );
  }

  const log = await prisma.productionShiftLog.create({
    data: {
      shiftDate: day,
      shiftType: input.shiftType,
      skuId: input.skuId,
      status: "DRAFT",
      rawOutputKg: input.rawOutputKg,
      totalLaborHours: input.totalLaborHours,
      downtimeHours: input.downtimeHours,
      rawMaterialInputKg: input.rawMaterialInputKg,
      draftNote: input.draftNote ?? null,
      createdById: actor.id,
      participants: {
        create: input.participants.map((p) => ({
          userId: p.userId,
          stage: p.stage,
          hoursWorked: p.hoursWorked,
          scheduledHours: p.scheduledHours,
        })),
      },
    },
    include: { sku: true, participants: true },
  });

  await writeAudit({
    actor,
    action: "PRODUCTION_SHIFT_DRAFT",
    entityName: "production_shift_logs",
    entityId: log.id,
    after: {
      ca: `${input.shiftType} ${day.toLocaleDateString("vi-VN")}`,
      sku: sku.skuCode,
      sanLuongTho: input.rawOutputKg,
      nvlCapVao: input.rawMaterialInputKg,
      soNguoi: input.participants.length,
    },
    ...meta,
  });

  // Báo KCS vào xác nhận
  const qcOfficers = await prisma.user.findMany({
    where: { productionRole: "QC_OFFICER", isActive: true },
  });
  for (const qc of qcOfficers) {
    await notify({
      userId: qc.id,
      title: `Ca sản xuất chờ KCS xác nhận: ${sku.skuName}`,
      body: `${actor.fullName} vừa khai ca ${input.shiftType} ngày ${day.toLocaleDateString("vi-VN")}, sản lượng thô ${input.rawOutputKg} kg.`,
      level: "INFO",
      linkUrl: `/production/${log.id}`,
    });
  }

  return log;
}

/* ================================================== BƯỚC 2 — QC XÁC NHẬN */

export async function approveByQc(
  actor: SessionUser & { productionRole?: string | null },
  logId: string,
  input: {
    qcPassedKg: number;
    reworkKg: number;
    scrapKg: number;
    haccpViolationCount: number;
    qcNote?: string | null;
    /** Lỗi quy về từng công đoạn — thứ duy nhất phân biệt được người trong cùng ca */
    participantDefects?: {
      userId: string;
      personalDefectKg: number;
      violationCount: number;
      note?: string | null;
    }[];
  },
  meta: Meta = {}
) {
  if (!canQcApprove(actor)) {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Chỉ nhân viên KCS mới xác nhận được số liệu phẩm chất.",
      403
    );
  }

  const log = await prisma.productionShiftLog.findUnique({
    where: { id: logId },
    include: { sku: true, participants: true },
  });
  if (!log) {
    throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy ca sản xuất.", 404);
  }
  if (log.status !== "DRAFT") {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      `Ca này đang ở trạng thái "${log.status}", chỉ ca vừa khai (DRAFT) mới xác nhận KCS được.`,
      409
    );
  }

  // TÁCH BẠCH TRÁCH NHIỆM — điểm mấu chốt của cả luồng 3 bước.
  // Người khai sản lượng mà tự xác nhận phẩm chất thì bước KCS thành hình thức.
  if (log.createdById === actor.id && actor.role !== "CEO") {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Bạn là người khai ca này nên không được tự xác nhận phẩm chất. Phải là KCS khác vào duyệt.",
      403
    );
  }

  const accounted = input.qcPassedKg + input.reworkKg + input.scrapKg;
  if (accounted > log.rawOutputKg * 1.5) {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      `Tổng KCS xác nhận ${accounted} kg vượt quá 150% sản lượng thô đã khai (${log.rawOutputKg} kg). Kiểm tra lại số cân.`,
      400
    );
  }

  const updated = await prisma.productionShiftLog.update({
    where: { id: logId },
    data: {
      qcPassedKg: input.qcPassedKg,
      reworkKg: input.reworkKg,
      scrapKg: input.scrapKg,
      haccpViolationCount: input.haccpViolationCount,
      qcNote: input.qcNote ?? null,
      qcOfficerId: actor.id,
      qcApprovedAt: new Date(),
      status: "QC_APPROVED",
    },
    include: { sku: true },
  });

  for (const d of input.participantDefects ?? []) {
    await prisma.productionShiftParticipant.updateMany({
      where: { shiftLogId: logId, userId: d.userId },
      data: {
        personalDefectKg: d.personalDefectKg,
        violationCount: d.violationCount,
        note: d.note ?? null,
      },
    });
  }

  await writeAudit({
    actor,
    action: "PRODUCTION_SHIFT_QC_APPROVE",
    entityName: "production_shift_logs",
    entityId: logId,
    before: { status: "DRAFT" },
    after: {
      status: "QC_APPROVED",
      dat: input.qcPassedKg,
      lamLai: input.reworkKg,
      phe: input.scrapKg,
      viPhamHaccp: input.haccpViolationCount,
    },
    reason: input.qcNote ?? null,
    ...meta,
  });

  if (input.haccpViolationCount > 0) {
    await sendCeoAlert({
      title: `Vi phạm an toàn thực phẩm tại xưởng: ${input.haccpViolationCount} vụ`,
      details: `Ca ${log.shiftType} ngày ${log.shiftDate.toLocaleDateString("vi-VN")}, mã ${log.sku.skuCode}. KCS ${actor.fullName} ghi nhận. ${input.qcNote ?? ""}`,
      actionPath: `/production/${logId}`,
    });
  }

  // Báo Ban Giám đốc vào khoá số
  const ceos = await prisma.user.findMany({
    where: { role: "CEO", isActive: true },
  });
  for (const c of ceos) {
    await notify({
      userId: c.id,
      title: `Ca sản xuất chờ khoá số: ${updated.sku.skuName}`,
      body: `KCS ${actor.fullName} đã xác nhận. Đạt ${input.qcPassedKg} kg, phế ${input.scrapKg} kg, làm lại ${input.reworkKg} kg.`,
      level: "INFO",
      linkUrl: `/production/${logId}`,
    });
  }

  return updated;
}

/* ============================== BƯỚC 3 — BAN GIÁM ĐỐC KHOÁ SỐ & CHẤM ĐIỂM */

export async function lockAndTriggerKpi(
  actor: SessionUser,
  logId: string,
  input: {
    targetOutputKg: number;
    /** Đính chính số nguyên liệu nếu kho khai sai — bắt buộc kèm lý do */
    rawMaterialInputKg?: number;
    targetOverrideReason?: string | null;
    materialOverrideReason?: string | null;
    ceoNote?: string | null;
  },
  meta: Meta = {}
) {
  if (!canLock(actor)) {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Chỉ Ban Giám đốc mới khoá được số liệu ca sản xuất.",
      403
    );
  }

  const log = await prisma.productionShiftLog.findUnique({
    where: { id: logId },
    include: { sku: true, participants: { include: { user: true } } },
  });
  if (!log) {
    throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy ca sản xuất.", 404);
  }
  if (log.status !== "QC_APPROVED") {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      "Ca phải được KCS xác nhận trước khi Ban Giám đốc khoá số.",
      409
    );
  }

  /* --- Chống thao túng: đặt chỉ tiêu khác chuẩn SKU thì phải nói vì sao ---
     Bản thiết kế để Ban Giám đốc gõ chỉ tiêu SAU khi đã thấy sản lượng thực tế.
     Ai đặt đích sau khi bắn thì luôn trúng. Nên chuẩn của SKU là mốc, lệch khỏi
     mốc thì phải ghi lý do và vào nhật ký. */
  const standardTarget = log.sku.targetOutputKg;
  const targetChanged =
    Math.abs(input.targetOutputKg - standardTarget) > 0.01;
  if (targetChanged && !input.targetOverrideReason?.trim()) {
    throw new BusinessError(
      ERR.REASON_REQUIRED,
      `Chỉ tiêu chuẩn của mã ${log.sku.skuCode} là ${standardTarget} kg. Bạn đặt ${input.targetOutputKg} kg — khác chuẩn thì bắt buộc ghi lý do.`,
      400
    );
  }

  const materialChanged =
    input.rawMaterialInputKg !== undefined &&
    Math.abs(input.rawMaterialInputKg - log.rawMaterialInputKg) > 0.01;
  if (materialChanged && !input.materialOverrideReason?.trim()) {
    throw new BusinessError(
      ERR.REASON_REQUIRED,
      `Kho khai nguyên liệu cấp vào là ${log.rawMaterialInputKg} kg. Sửa khác số đó thì bắt buộc ghi lý do.`,
      400
    );
  }

  const rawMaterialInputKg =
    input.rawMaterialInputKg ?? log.rawMaterialInputKg;
  const stdMaterialNormKg = computeStdMaterialNorm(
    input.targetOutputKg,
    log.sku.stdMaterialLossRate
  );

  const facts: ShiftFacts = {
    rawOutputKg: log.rawOutputKg,
    qcPassedKg: log.qcPassedKg,
    reworkKg: log.reworkKg,
    scrapKg: log.scrapKg,
    haccpViolationCount: log.haccpViolationCount,
    totalLaborHours: log.totalLaborHours,
    downtimeHours: log.downtimeHours,
    targetOutputKg: input.targetOutputKg,
    rawMaterialInputKg,
    stdMaterialNormKg,
  };

  const loss = computeQualityLoss(facts, log.sku.unitPriceVnd);

  const locked = await prisma.productionShiftLog.update({
    where: { id: logId },
    data: {
      targetOutputKg: input.targetOutputKg,
      rawMaterialInputKg,
      stdMaterialNormKg,
      qualityLossVnd: loss.qualityLossVnd,
      targetOverrideReason: targetChanged
        ? input.targetOverrideReason
        : null,
      materialOverrideReason: materialChanged
        ? input.materialOverrideReason
        : null,
      ceoNote: input.ceoNote ?? null,
      lockedById: actor.id,
      lockedAt: new Date(),
      status: "LOCKED",
    },
  });

  await writeAudit({
    actor,
    action: "PRODUCTION_SHIFT_LOCK",
    entityName: "production_shift_logs",
    entityId: logId,
    before: {
      chiTieuChuanCuaSku: standardTarget,
      nvlKhoKhai: log.rawMaterialInputKg,
    },
    after: {
      chiTieuDaDat: input.targetOutputKg,
      nvlChot: rawMaterialInputKg,
      dinhMucNvl: stdMaterialNormKg,
      tonThatVnd: loss.qualityLossVnd,
      suaChiTieu: targetChanged,
      suaNvl: materialChanged,
    },
    reason:
      [input.targetOverrideReason, input.materialOverrideReason]
        .filter(Boolean)
        .join(" | ") || null,
    ...meta,
  });

  // Chấm điểm và quét chống chạy chỉ tiêu — chỉ chạy ở đây, không sớm hơn
  const result = await executeCalculationAndAudit(logId);

  return { log: locked, ...result };
}

/* ============================================ CHẤM ĐIỂM & QUÉT BẤT THƯỜNG */

export async function executeCalculationAndAudit(logId: string) {
  const log = await prisma.productionShiftLog.findUnique({
    where: { id: logId },
    include: { sku: true, participants: { include: { user: true } } },
  });
  if (!log) {
    throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy ca sản xuất.", 404);
  }
  if (log.status !== "LOCKED") {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      "Chỉ chấm điểm khi ca đã khoá số.",
      409
    );
  }

  const facts: ShiftFacts = {
    rawOutputKg: log.rawOutputKg,
    qcPassedKg: log.qcPassedKg,
    reworkKg: log.reworkKg,
    scrapKg: log.scrapKg,
    haccpViolationCount: log.haccpViolationCount,
    totalLaborHours: log.totalLaborHours,
    downtimeHours: log.downtimeHours,
    targetOutputKg: log.targetOutputKg,
    rawMaterialInputKg: log.rawMaterialInputKg,
    stdMaterialNormKg: log.stdMaterialNormKg,
  };

  const metrics = computeShiftMetrics(facts);
  const tier2 = computeTier2(metrics, facts);

  const totalHours =
    log.participants.reduce((s, p) => s + p.hoursWorked, 0) ||
    log.totalLaborHours;

  /* --- Quét chống chạy chỉ tiêu TRƯỚC, để biết có phải khoá thưởng không --- */
  const findings = runAntiGamingRules(facts, metrics);

  // Xoá bản quét cũ chưa ai đụng tới, giữ lại bản đã có người giải trình
  await prisma.antiGamingAudit.deleteMany({
    where: { shiftLogId: logId, status: "PENDING_EXPLANATION" },
  });
  if (findings.length > 0) {
    await prisma.antiGamingAudit.createMany({
      data: findings.map((f) => ({ ...f, shiftLogId: logId })),
    });
  }

  const stillOpen = await prisma.antiGamingAudit.count({
    where: {
      shiftLogId: logId,
      status: { in: ["PENDING_EXPLANATION", "EXPLAINED"] },
    },
  });
  const bonusLocked = stillOpen > 0;

  /* --- Chấm điểm từng người --- */
  const results = [];
  for (const p of log.participants) {
    const pf: ParticipantFacts = {
      userId: p.userId,
      stage: p.stage,
      hoursWorked: p.hoursWorked,
      scheduledHours: p.scheduledHours,
      personalDefectKg: p.personalDefectKg,
      violationCount: p.violationCount,
    };
    const { weights, tier1Components } = tierWeightsFor(p.user.employmentType);
    const score = computeFinalScore(
      pf,
      facts,
      totalHours,
      tier2,
      weights,
      tier1Components
    );

    const saved = await prisma.dailyKpiResult.upsert({
      where: { shiftLogId_userId: { shiftLogId: logId, userId: p.userId } },
      update: {
        tier1Score: score.tier1Score,
        tier2Score: score.tier2Score,
        finalWeightedScore: score.finalWeightedScore,
        bonusMultiplier: score.bonusMultiplier,
        finalBonusVnd: bonusLocked ? 0 : score.finalBonusVnd,
        isBonusLocked: bonusLocked,
        breakdownJson: JSON.stringify(score.breakdown),
      },
      create: {
        shiftLogId: logId,
        userId: p.userId,
        tier1Score: score.tier1Score,
        tier2Score: score.tier2Score,
        finalWeightedScore: score.finalWeightedScore,
        bonusMultiplier: score.bonusMultiplier,
        finalBonusVnd: bonusLocked ? 0 : score.finalBonusVnd,
        isBonusLocked: bonusLocked,
        breakdownJson: JSON.stringify(score.breakdown),
      },
    });
    results.push(saved);

    await notify({
      userId: p.userId,
      title: `Điểm KPI ca ${log.shiftType} ngày ${log.shiftDate.toLocaleDateString("vi-VN")}`,
      body: bonusLocked
        ? `Bạn được ${score.finalWeightedScore} điểm (cá nhân ${score.tier1Score}, toàn xưởng ${score.tier2Score}). Thưởng ca đang tạm khoá vì có cảnh báo cần giải trình.`
        : `Bạn được ${score.finalWeightedScore} điểm (cá nhân ${score.tier1Score}, toàn xưởng ${score.tier2Score}).`,
      level: bonusLocked ? "WARNING" : "INFO",
      linkUrl: `/production/${logId}`,
    });
  }

  /* --- Báo Ban Giám đốc nếu có bất thường --- */
  if (findings.length > 0) {
    await sendCeoAlert({
      title: `Cảnh báo chạy chỉ tiêu: ${findings.length} dấu hiệu ở ca ${log.shiftType}`,
      details: findings
        .map((f) => `${BEHAVIOR_LABEL[f.behaviorType] ?? f.behaviorType}`)
        .join(" · ") + ` — đã tạm khoá thưởng của ${results.length} người, chờ quản đốc giải trình.`,
      actionPath: `/production/audits`,
    });

    const supervisors = await prisma.user.findMany({
      where: {
        productionRole: { in: ["SUPERVISOR", "PRODUCTION_DIRECTOR"] },
        isActive: true,
      },
    });
    for (const s of supervisors) {
      await notify({
        userId: s.id,
        title: `Cần giải trình ca ${log.shiftType} ngày ${log.shiftDate.toLocaleDateString("vi-VN")}`,
        body: `Hệ thống phát hiện ${findings.length} dấu hiệu bất thường. Thưởng ca đang khoá cho tới khi Ban Giám đốc xem giải trình.`,
        level: "WARNING",
        linkUrl: `/production/audits`,
      });
    }
  }

  await writeAudit({
    actor: null,
    action: "PRODUCTION_KPI_CALCULATED",
    entityName: "production_shift_logs",
    entityId: logId,
    after: {
      diemToanXuong: tier2.score,
      soNguoiDuocCham: results.length,
      canhBao: findings.length,
      khoaThuong: bonusLocked,
    },
  });

  return {
    metrics,
    tier2,
    results,
    findings,
    bonusLocked,
  };
}

/* ================================================== GIẢI TRÌNH & DUYỆT TAY */

export async function submitExplanation(
  actor: SessionUser & { productionRole?: string | null },
  auditId: string,
  explanationText: string,
  meta: Meta = {}
) {
  const allowed =
    actor.role === "CEO" ||
    ["SUPERVISOR", "PRODUCTION_DIRECTOR", "TEAM_LEADER"].includes(
      actor.productionRole ?? ""
    );
  if (!allowed) {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Chỉ tổ trưởng, quản đốc và Giám đốc Sản xuất mới được giải trình.",
      403
    );
  }
  if (explanationText.trim().length < 20) {
    throw new BusinessError(
      ERR.REASON_REQUIRED,
      "Giải trình phải nói rõ nguyên nhân, tối thiểu 20 ký tự.",
      400
    );
  }

  const audit = await prisma.antiGamingAudit.findUnique({
    where: { id: auditId },
  });
  if (!audit) {
    throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy cảnh báo.", 404);
  }
  if (audit.status !== "PENDING_EXPLANATION") {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      "Cảnh báo này đã qua bước giải trình rồi.",
      409
    );
  }

  const updated = await prisma.antiGamingAudit.update({
    where: { id: auditId },
    data: {
      explanationText,
      explainedById: actor.id,
      explainedAt: new Date(),
      status: "EXPLAINED",
    },
  });

  await writeAudit({
    actor,
    action: "ANTI_GAMING_EXPLAIN",
    entityName: "anti_gaming_audits",
    entityId: auditId,
    reason: explanationText,
    ...meta,
  });

  await sendCeoAlert({
    title: "Quản đốc đã giải trình cảnh báo chạy chỉ tiêu",
    details: `${actor.fullName}: ${explanationText.slice(0, 200)}`,
    actionPath: "/production/audits",
  });

  return updated;
}

export async function reviewAudit(
  actor: SessionUser,
  auditId: string,
  input: { approved: boolean; reviewNote: string },
  meta: Meta = {}
) {
  if (actor.role !== "CEO") {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Chỉ Ban Giám đốc mới duyệt được giải trình.",
      403
    );
  }
  if (input.reviewNote.trim().length < 10) {
    throw new BusinessError(
      ERR.REASON_REQUIRED,
      "Ghi rõ ý kiến của bạn, tối thiểu 10 ký tự — người bị khoá thưởng cần biết vì sao.",
      400
    );
  }

  const audit = await prisma.antiGamingAudit.findUnique({
    where: { id: auditId },
    include: { shiftLog: { include: { sku: true } } },
  });
  if (!audit) {
    throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy cảnh báo.", 404);
  }
  if (audit.status === "CEO_APPROVED" || audit.status === "REJECTED") {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      "Cảnh báo này đã được xử lý rồi.",
      409
    );
  }

  const updated = await prisma.antiGamingAudit.update({
    where: { id: auditId },
    data: {
      status: input.approved ? "CEO_APPROVED" : "REJECTED",
      ceoReviewNote: input.reviewNote,
      reviewedById: actor.id,
      reviewedAt: new Date(),
    },
  });

  // Chỉ mở khoá thưởng khi KHÔNG còn cảnh báo nào treo trên ca đó.
  // Duyệt một cảnh báo mà ca còn hai cái khác đang chờ thì vẫn phải khoá.
  const stillOpen = await prisma.antiGamingAudit.count({
    where: {
      shiftLogId: audit.shiftLogId,
      status: { in: ["PENDING_EXPLANATION", "EXPLAINED"] },
    },
  });
  const anyRejected = await prisma.antiGamingAudit.count({
    where: { shiftLogId: audit.shiftLogId, status: "REJECTED" },
  });

  const unlock = stillOpen === 0 && anyRejected === 0;

  if (unlock) {
    const rows = await prisma.dailyKpiResult.findMany({
      where: { shiftLogId: audit.shiftLogId },
    });
    for (const r of rows) {
      await prisma.dailyKpiResult.update({
        where: { id: r.id },
        data: {
          isBonusLocked: false,
          finalBonusVnd: r.bonusMultiplier * 0 + r.finalBonusVnd,
        },
      });
      await notify({
        userId: r.userId,
        title: "Đã mở khoá thưởng ca sản xuất",
        body: `Ban Giám đốc chấp nhận giải trình. Ý kiến: ${input.reviewNote}`,
        level: "INFO",
        linkUrl: `/production/${audit.shiftLogId}`,
      });
    }
  }

  await writeAudit({
    actor,
    action: input.approved
      ? "ANTI_GAMING_CEO_APPROVE"
      : "ANTI_GAMING_CEO_REJECT",
    entityName: "anti_gaming_audits",
    entityId: auditId,
    before: { status: audit.status },
    after: {
      status: updated.status,
      moKhoaThuong: unlock,
      conCanhBaoTreo: stillOpen,
    },
    reason: input.reviewNote,
    ...meta,
  });

  return { audit: updated, bonusUnlocked: unlock, stillOpen };
}

/* ============================================== MỞ LẠI CA ĐÃ KHOÁ (hiếm) */

export async function reopenShift(
  actor: SessionUser,
  logId: string,
  reason: string,
  meta: Meta = {}
) {
  if (actor.role !== "CEO") {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Chỉ Ban Giám đốc mới mở lại được ca đã khoá.",
      403
    );
  }
  if (reason.trim().length < 10) {
    throw new BusinessError(
      ERR.REASON_REQUIRED,
      "Mở lại ca đã khoá bắt buộc ghi lý do rõ ràng.",
      400
    );
  }

  const log = await prisma.productionShiftLog.findUnique({
    where: { id: logId },
  });
  if (!log) {
    throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy ca sản xuất.", 404);
  }
  if (log.status !== "LOCKED") {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      "Ca này chưa khoá nên không cần mở lại.",
      409
    );
  }

  await prisma.dailyKpiResult.deleteMany({ where: { shiftLogId: logId } });
  const updated = await prisma.productionShiftLog.update({
    where: { id: logId },
    data: { status: "QC_APPROVED", lockedAt: null, lockedById: null },
  });

  await writeAudit({
    actor,
    action: "PRODUCTION_SHIFT_REOPEN",
    entityName: "production_shift_logs",
    entityId: logId,
    before: { status: "LOCKED" },
    after: { status: "QC_APPROVED", diemDaXoa: true },
    reason,
    ...meta,
  });

  return updated;
}
