import { Prisma } from "@prisma/client";
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
import {
  BASE_BONUS_PER_SHIFT_VND,
  BEHAVIOR_LABEL,
} from "../production/constants";
import {
  MASS_GAP_MIN_REASON,
  MASS_GAP_REASON_KG,
  SHIFT_RETURN_MIN_REASON,
  SHIFT_RETURN_PREFIX,
  buildMassGapNoteLine,
  buildShiftReturnNote,
  extractShiftReturn,
  isShiftReturned,
  massGapKg,
  needsMassGapReason,
} from "../production/shift-flow";
import { fmtKg } from "../format";
import { formatVnDate, vnStartOfDay } from "../vn-time";
import type { SessionUser } from "../auth";

/**
 * LUỒNG DUYỆT SỐ LIỆU CA SẢN XUẤT — 3 BƯỚC BẮT BUỘC.
 *
 *   DRAFT          Sản xuất khai sản lượng, giờ công, NVL kho cấp
 *      ↓  ↺        (KCS có thể TRẢ VỀ: ca vẫn DRAFT, qcNote đánh dấu "[KCS trả
 *      ↓            về]" — người khai sửa rồi gửi lại, xem lib/production/shift-flow.ts)
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

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Ca đã bị người khác chuyển trạng thái trước (bấm đúp, hai người cùng thao tác). */
function shiftAlreadyHandled(message: string): never {
  throw new BusinessError(ERR.VALIDATION_FAILED, message, 409);
}

/** Lỗi P2002 có phải do khoá unique (ngày ca, loại ca, mã SKU) không. */
function isShiftUniqueViolation(e: Prisma.PrismaClientKnownRequestError) {
  const meta = e.meta as { target?: unknown; modelName?: unknown } | undefined;
  if (meta?.modelName === "ProductionShiftParticipant") return false;
  // Bảng ca chỉ có một khoá unique nghiệp vụ: (ngày, loại ca, mã SKU)
  if (meta?.modelName === "ProductionShiftLog") return true;
  const target = meta?.target;
  const fields = Array.isArray(target)
    ? target.map(String)
    : typeof target === "string"
      ? [target]
      : [];
  // Postgres trả mảng tên cột; đôi khi là tên index
  // "production_shift_logs_shiftDate_shiftType_skuId_key".
  return fields.some(
    (f) =>
      f === "shiftDate" ||
      f.includes("shiftDate_shiftType_skuId") ||
      (f.startsWith("production_shift_logs") && !f.includes("participants"))
  );
}

/** Trần tổn thất chất lượng ghi vào cột Int (int4 tối đa ~2,147 tỷ). */
export const MAX_QUALITY_LOSS_VND = 2_000_000_000;

/* ------------------------------------------------------------ PHÂN QUYỀN */

function canEnterDraft(u: { role: string; productionRole?: string | null }) {
  if (u.role === "CEO") return true;
  return ["WORKER", "TEAM_LEADER", "SUPERVISOR", "PRODUCTION_DIRECTOR"].includes(
    u.productionRole ?? ""
  );
}

/**
 * Tiền tố đánh dấu ghi chú KCS do Ban Giám đốc VƯỢT QUYỀN xác nhận thay KCS.
 * Không thêm cột vào schema — lý do nằm ngay trong qcNote (ai mở ca cũng
 * thấy) và trong nhật ký hệ thống.
 */
export const CEO_QC_OVERRIDE_PREFIX = "[BGĐ vượt quyền KCS]";
export const CEO_QC_OVERRIDE_MIN_REASON = 10;

/**
 * Tách lý do vượt quyền từ qcNote dạng "[BGĐ vượt quyền KCS] <lý do>\n<ghi chú>".
 * Lý do là phần trên dòng đầu sau tiền tố. Không có tiền tố → null.
 */
export function extractCeoQcOverrideReason(qcNote?: string | null): string | null {
  const t = (qcNote ?? "").trim();
  if (!t.startsWith(CEO_QC_OVERRIDE_PREFIX)) return null;
  return t.slice(CEO_QC_OVERRIDE_PREFIX.length).split("\n")[0].trim();
}

/**
 * Ai được làm bước 2 (KCS) cho một ca, theo cách nào.
 *
 *   - KCS (QC_OFFICER): xác nhận bình thường, trừ ca do chính mình khai.
 *   - Ban Giám đốc KHÔNG phải KCS: chỉ được VƯỢT QUYỀN, bắt buộc ghi lý do
 *     (≥ 10 ký tự), và lý do vào nhật ký. Trước đây CEO được coi như KCS nên
 *     một người có thể tự khai → tự duyệt KCS → tự khoá — mất hẳn tách bạch
 *     trách nhiệm.
 *   - Người khai ca KHÔNG được tự xác nhận phẩm chất ca của mình — kể cả BGĐ.
 *
 * Trả về chế độ duyệt; sai quyền thì ném BusinessError. Hàm thuần, không đụng
 * DB — để kiểm thử được.
 */
export function resolveQcApproval(
  actor: { id: string; role: string; productionRole?: string | null },
  shiftCreatedById: string,
  input: { qcNote?: string | null; ceoOverrideReason?: string | null }
): { mode: "QC" } | { mode: "CEO_OVERRIDE"; reason: string } {
  const isQcOfficer = actor.productionRole === "QC_OFFICER";
  const isCeo = actor.role === "CEO";
  if (!isQcOfficer && !isCeo) {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Chỉ nhân viên KCS mới xác nhận được số liệu phẩm chất.",
      403
    );
  }

  // TÁCH BẠCH TRÁCH NHIỆM — điểm mấu chốt của cả luồng 3 bước.
  // Người khai sản lượng mà tự xác nhận phẩm chất thì bước KCS thành hình thức.
  if (shiftCreatedById === actor.id) {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Bạn là người khai ca này nên không được tự xác nhận phẩm chất. Phải là KCS khác vào duyệt.",
      403
    );
  }

  if (isQcOfficer) return { mode: "QC" };

  const reason = (
    input.ceoOverrideReason ?? extractCeoQcOverrideReason(input.qcNote) ?? ""
  ).trim();
  // (qcNote có tiền tố vẫn đọc được để tương thích; giao diện gửi trường riêng)
  if (reason.length < CEO_QC_OVERRIDE_MIN_REASON) {
    throw new BusinessError(
      ERR.REASON_REQUIRED,
      `Ban Giám đốc không phải KCS — muốn xác nhận thay KCS phải vượt quyền và ghi lý do (tối thiểu ${CEO_QC_OVERRIDE_MIN_REASON} ký tự). Lý do vào nhật ký hệ thống.`,
      400
    );
  }
  return { mode: "CEO_OVERRIDE", reason };
}

/**
 * Ghép qcNote khi BGĐ vượt quyền: dòng đầu luôn là "[BGĐ vượt quyền KCS] <lý do>",
 * phần ghi chú phẩm chất (nếu có) xuống dòng sau.
 */
export function buildCeoOverrideQcNote(reason: string, qcNote?: string | null) {
  const t = (qcNote ?? "").trim();
  // qcNote đã có tiền tố (giao diện gửi sẵn) → bỏ dòng đầu, chỉ giữ phần ghi chú
  const rest = t.startsWith(CEO_QC_OVERRIDE_PREFIX)
    ? t.split("\n").slice(1).join("\n").trim()
    : t;
  return `${CEO_QC_OVERRIDE_PREFIX} ${reason.trim()}${rest ? `\n${rest}` : ""}`;
}

/**
 * Lệch cân đối khối lượng lúc KCS phân loại: thô − (đạt + làm lại + phế).
 * Lệch quá ngưỡng (5 kg — cùng ngưỡng Luật 3 chống chạy chỉ tiêu) thì bắt buộc
 * ghi lý do ngay lúc cân; lý do thành một dòng trong ghi chú KCS và vào nhật
 * ký. Trước đây chỉ có ô tick "tôi xác nhận số lệch" — tick xong không còn lại
 * dấu vết gì, tới lúc bị cảnh báo thì không ai nhớ vì sao lệch.
 *
 * Trả về dòng ghi chú cần nối vào qcNote (null nếu không lệch đáng kể). Hàm
 * thuần, không đụng DB — để kiểm thử được.
 */
export function resolveMassGapReason(
  rawOutputKg: number,
  parts: { qcPassedKg: number; reworkKg: number; scrapKg: number },
  reason?: string | null
): { gapKg: number; noteLine: string | null } {
  const gapKg = massGapKg(rawOutputKg, parts);
  if (!needsMassGapReason(gapKg)) return { gapKg, noteLine: null };
  const why = (reason ?? "").replace(/\s+/g, " ").trim();
  if (why.length < MASS_GAP_MIN_REASON) {
    throw new BusinessError(
      ERR.REASON_REQUIRED,
      `Tổng phân loại lệch ${fmtKg(Math.abs(gapKg), { unit: "kg" })} so với sản lượng thô ${fmtKg(rawOutputKg, { unit: "kg" })} — lệch quá ${fmtKg(MASS_GAP_REASON_KG, { unit: "kg" })} thì phải ghi lý do (tối thiểu ${MASS_GAP_MIN_REASON} ký tự).`,
      400
    );
  }
  return { gapKg, noteLine: buildMassGapNoteLine(gapKg, why) };
}

/** Lọc sơ trước khi đọc ca: chỉ KCS hoặc BGĐ (vượt quyền) mới tới được bước 2. */
function canQcApprove(u: SessionUser & { productionRole?: string | null }) {
  return u.productionRole === "QC_OFFICER" || u.role === "CEO";
}

/**
 * Ai được viết giải trình cho cảnh báo của MỘT ca.
 *
 *   - Quản đốc (SUPERVISOR) và Giám đốc SX: phụ trách cả xưởng, được báo mọi
 *     cảnh báo → giải trình được mọi ca.
 *   - Tổ trưởng: CHỈ ca mình có làm hoặc mình khai. Trước đây tổ trưởng nào
 *     cũng giải trình được mọi ca — tổ khác "nói đỡ" để mở khoá thưởng.
 *   - Ban Giám đốc: KHÔNG giải trình — Ban Giám đốc là người PHÁN XỬ giải
 *     trình. Nếu BGĐ tự viết thì không ai còn quyền duyệt (assertCanReviewAudit
 *     cấm tự duyệt), cảnh báo kẹt vĩnh viễn và thưởng bị khoá mãi.
 */
export function canExplainAudit(
  actor: { id: string; role: string; productionRole?: string | null },
  shift: { createdById: string; participantUserIds: string[] }
) {
  if (actor.role === "CEO") return false;
  const pr = actor.productionRole ?? "";
  if (pr === "SUPERVISOR" || pr === "PRODUCTION_DIRECTOR") return true;
  if (pr === "TEAM_LEADER") {
    return (
      shift.createdById === actor.id ||
      shift.participantUserIds.includes(actor.id)
    );
  }
  return false;
}

/**
 * Ban Giám đốc quyết giải trình — nhưng không phải giải trình do CHÍNH MÌNH
 * viết. Vừa giải trình vừa phán xử là tự mở khoá thưởng cho mình.
 */
export function assertCanReviewAudit(
  actor: { id: string; role: string },
  audit: { explainedById: string | null }
) {
  if (actor.role !== "CEO") {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Chỉ Ban Giám đốc mới duyệt được giải trình.",
      403
    );
  }
  if (audit.explainedById && audit.explainedById === actor.id) {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Bạn là người viết giải trình này nên không tự quyết được. Cần một thành viên Ban Giám đốc khác xem xét.",
      403
    );
  }
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

/**
 * Gỡ các trường chỉ Ban Giám đốc / Giám đốc SX được xem (tiền và lý do sửa
 * chỉ tiêu) khỏi một ca trước khi trả ra ngoài. Dùng cho MỌI chỗ trả ca sản
 * xuất ra API, để không có đường nào lọt đơn giá hay tổn thất quy ra tiền.
 */
export function redactShiftForViewer<
  T extends {
    qualityLossVnd?: number;
    targetOverrideReason?: string | null;
    materialOverrideReason?: string | null;
    sku?: { unitPriceVnd?: number } | null;
  },
>(shift: T, viewer: SessionUser & { productionRole?: string | null }): T {
  if (canSeeMoney(viewer)) return shift;
  const { qualityLossVnd: _q, targetOverrideReason: _t, materialOverrideReason: _m, ...rest } =
    shift;
  const out = { ...rest } as T;
  if (shift.sku) {
    const { unitPriceVnd: _p, ...sku } = shift.sku;
    (out as { sku?: unknown }).sku = sku;
  }
  return out;
}

/** Nạp thêm vai trò trong xưởng cho phiên đăng nhập. */
export async function withProductionRole(user: SessionUser) {
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { productionRole: true },
  });
  return { ...user, productionRole: row?.productionRole ?? null };
}

/* ------------------------------------------- CA ĐANG CHỜ VAI TRÒ CỦA TÔI */

/** Ca chờ KCS: DRAFT và chưa bị trả về sản xuất */
export const WAITING_QC_WHERE = {
  status: "DRAFT",
  OR: [{ qcNote: null }, { NOT: { qcNote: { startsWith: SHIFT_RETURN_PREFIX } } }],
} satisfies Prisma.ProductionShiftLogWhereInput;

/** Ca KCS đã trả về, đang chờ người khai sửa */
export const RETURNED_WHERE = {
  status: "DRAFT",
  qcNote: { startsWith: SHIFT_RETURN_PREFIX },
} satisfies Prisma.ProductionShiftLogWhereInput;

/**
 * Điều kiện lọc những ca đang chờ ĐÚNG bước của người này — để danh sách xưởng
 * đưa việc của họ lên đầu thay vì bắt họ dò trong 60 ca theo ngày:
 *
 *   - KCS: ca chờ KCS, trừ ca chính mình khai (không được tự xác nhận).
 *   - Ban Giám đốc: ca KCS đã xác nhận, chờ khoá số. (Vượt quyền KCS là ngoại
 *     lệ, không đưa ca DRAFT vào "việc của BGĐ".)
 *   - Người khai ca (công nhân, tổ trưởng, quản đốc, GĐ SX, BGĐ): ca của chính
 *     mình bị KCS trả về, chờ sửa và gửi lại.
 *
 * Không có bước nào chờ người này → null. Hàm thuần — để kiểm thử được.
 */
export function awaitingMyStepWhere(user: {
  id: string;
  role: string;
  productionRole?: string | null;
}): Prisma.ProductionShiftLogWhereInput | null {
  const or: Prisma.ProductionShiftLogWhereInput[] = [];
  if (user.productionRole === "QC_OFFICER") {
    or.push({ ...WAITING_QC_WHERE, createdById: { not: user.id } });
  }
  if (user.role === "CEO") {
    or.push({ status: "QC_APPROVED" });
  }
  if (canEnterDraft(user)) {
    or.push({ ...RETURNED_WHERE, createdById: user.id });
  }
  if (or.length === 0) return null;
  return or.length === 1 ? or[0] : { OR: or };
}

/* ======================================================= BƯỚC 1 — DRAFT */

type DraftInput = {
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
};

/**
 * Kiểm tra một bản khai ca — dùng chung cho khai mới và gửi lại ca bị KCS trả
 * về. `excludeLogId`: ca đang sửa, để kiểm tra trùng (ngày, ca, mã) không tự
 * va vào chính nó.
 */
async function validateDraftInput(input: DraftInput, excludeLogId?: string) {
  if (input.participants.length === 0) {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      "Phải khai ít nhất một người làm ca này — không có người thì không chấm điểm cho ai được.",
      400
    );
  }

  // Mỗi người chỉ xuất hiện MỘT lần trong ca — DB có unique (ca, người), để
  // lọt xuống đó thì người dùng nhận thông báo "ca đã khai rồi" rất khó hiểu.
  const seen = new Set<string>();
  const dupUsers = new Set<string>();
  for (const p of input.participants) {
    if (seen.has(p.userId)) dupUsers.add(p.userId);
    seen.add(p.userId);
  }
  if (dupUsers.size > 0) {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      `Có ${dupUsers.size} người bị khai trùng trong danh sách làm ca. Mỗi người chỉ khai một dòng (cộng gộp giờ công nếu làm nhiều công đoạn).`,
      400
    );
  }
  const activeUsers = await prisma.user.findMany({
    where: { id: { in: [...seen] }, isActive: true },
    select: { id: true },
  });
  if (activeUsers.length !== seen.size) {
    const ok = new Set(activeUsers.map((u) => u.id));
    const missing = [...seen].filter((id) => !ok.has(id));
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      `${missing.length} người trong danh sách làm ca không tồn tại hoặc đã nghỉ việc. Tải lại danh sách nhân sự rồi khai lại.`,
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

  // Ngày ca = 00:00 giờ VN của ngày đó. Không dùng setHours() — phụ thuộc
  // múi giờ server (Vercel chạy UTC → ca bị lùi một ngày).
  const day = vnStartOfDay(input.shiftDate);

  const dup = await prisma.productionShiftLog.findUnique({
    where: {
      shiftDate_shiftType_skuId: {
        shiftDate: day,
        shiftType: input.shiftType,
        skuId: input.skuId,
      },
    },
  });
  if (dup && dup.id !== excludeLogId) {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      `Ca ${input.shiftType} ngày ${formatVnDate(day)} cho mã ${sku.skuCode} đã được khai rồi.`,
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

  return { sku, day };
}

/** Lỗi ghi DB của bản khai ca → thông báo dễ hiểu thay vì lỗi 500. */
function draftWriteError(
  e: unknown,
  ctx: { shiftType: string; day: Date; skuCode: string }
): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    // Hai người khai cùng ca cùng lúc: kiểm tra trùng ở trên đều lọt, ràng
    // buộc unique của DB chặn người thứ hai — trả 409 thay vì lỗi 500.
    // CHỈ khi đúng là khoá (ngày, ca, mã) — trùng ở bảng người làm ca là
    // chuyện khác, không được báo nhầm thành "ca đã khai".
    if (e.code === "P2002" && isShiftUniqueViolation(e)) {
      shiftAlreadyHandled(
        `Ca ${ctx.shiftType} ngày ${formatVnDate(ctx.day)} cho mã ${ctx.skuCode} đã được khai rồi.`
      );
    }
    if (e.code === "P2002") {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        "Danh sách người làm ca bị trùng người. Mỗi người chỉ khai một dòng.",
        400
      );
    }
    // Tham chiếu tới người / mã sản phẩm vừa bị xoá giữa lúc kiểm tra và lúc ghi
    if (e.code === "P2003") {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        "Có người làm ca hoặc mã sản phẩm không còn tồn tại trong hệ thống. Tải lại trang rồi khai lại.",
        400
      );
    }
  }
  throw e;
}

/** Báo các KCS đang làm việc vào xác nhận một ca. */
async function notifyQcOfficers(title: string, body: string, logId: string) {
  const qcOfficers = await prisma.user.findMany({
    where: { productionRole: "QC_OFFICER", isActive: true },
    select: { id: true },
  });
  for (const qc of qcOfficers) {
    await notify({
      userId: qc.id,
      title,
      body,
      level: "INFO",
      linkUrl: `/production/${logId}`,
    });
  }
}

export async function submitShiftDraft(
  actor: SessionUser & { productionRole?: string | null },
  input: DraftInput,
  meta: Meta = {}
) {
  if (!canEnterDraft(actor)) {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Bạn không có vai trò trong xưởng để khai báo ca sản xuất.",
      403
    );
  }

  const { sku, day } = await validateDraftInput(input);

  const log = await prisma.productionShiftLog
    .create({
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
    })
    .catch((e: unknown) =>
      draftWriteError(e, { shiftType: input.shiftType, day, skuCode: sku.skuCode })
    );

  await writeAudit({
    actor,
    action: "PRODUCTION_SHIFT_DRAFT",
    entityName: "production_shift_logs",
    entityId: log.id,
    after: {
      ca: `${input.shiftType} ${formatVnDate(day)}`,
      sku: sku.skuCode,
      sanLuongTho: input.rawOutputKg,
      nvlCapVao: input.rawMaterialInputKg,
      soNguoi: input.participants.length,
    },
    ...meta,
  });

  // Báo KCS vào xác nhận
  await notifyQcOfficers(
    `Ca sản xuất chờ KCS xác nhận: ${sku.skuName}`,
    `${actor.fullName} vừa khai ca ${input.shiftType} ngày ${formatVnDate(day)}, sản lượng thô ${fmtKg(input.rawOutputKg)}.`,
    log.id
  );

  return log;
}

/* ============================ BƯỚC 1 ↺ — KCS TRẢ VỀ, SẢN XUẤT SỬA RỒI GỬI LẠI */

/**
 * KCS (hoặc BGĐ) trả một ca đang chờ KCS về cho sản xuất sửa — số thô khai
 * sai, thiếu người, nhầm mã... Trước đây KCS chỉ có một nút "Xác nhận": gặp
 * ca khai sai thì hoặc xác nhận cho qua (số sai đi thẳng vào điểm), hoặc bỏ
 * mặc ca nằm đó. Ca vẫn DRAFT (xem lib/production/shift-flow.ts), lý do vào
 * qcNote và nhật ký, người khai nhận thông báo.
 */
export async function returnShiftToProduction(
  actor: SessionUser & { productionRole?: string | null },
  logId: string,
  reason: string,
  meta: Meta = {}
) {
  if (!canQcApprove(actor)) {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Chỉ KCS (hoặc Ban Giám đốc) mới trả ca về sản xuất được.",
      403
    );
  }
  const why = reason.replace(/\s+/g, " ").trim();
  if (why.length < SHIFT_RETURN_MIN_REASON) {
    throw new BusinessError(
      ERR.REASON_REQUIRED,
      `Trả ca về sản xuất phải ghi rõ cần sửa gì (tối thiểu ${SHIFT_RETURN_MIN_REASON} ký tự).`,
      400
    );
  }

  const log = await prisma.productionShiftLog.findUnique({
    where: { id: logId },
    include: { sku: true },
  });
  if (!log) {
    throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy ca sản xuất.", 404);
  }
  if (log.status !== "DRAFT") {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      "Chỉ ca đang chờ KCS mới trả về sản xuất được. Ca đã qua KCS muốn sửa thì Ban Giám đốc xử lý.",
      409
    );
  }
  if (isShiftReturned(log)) {
    shiftAlreadyHandled("Ca này đã được trả về sản xuất rồi, đang chờ người khai sửa.");
  }

  // Có điều kiện: chỉ ca DRAFT chưa bị trả về. KCS khác vừa xác nhận / vừa trả
  // về cùng lúc thì lệnh này nhận 409.
  const res = await prisma.productionShiftLog.updateMany({
    where: {
      id: logId,
      status: "DRAFT",
      OR: [{ qcNote: null }, { NOT: { qcNote: { startsWith: SHIFT_RETURN_PREFIX } } }],
    },
    data: { qcNote: buildShiftReturnNote(actor.fullName, why) },
  });
  if (res.count !== 1) {
    shiftAlreadyHandled("Ca này vừa được người khác xử lý (xác nhận hoặc trả về).");
  }

  await writeAudit({
    actor,
    action: "PRODUCTION_SHIFT_RETURN",
    entityName: "production_shift_logs",
    entityId: logId,
    before: { status: "DRAFT" },
    after: { status: "DRAFT", traVeSanXuat: true },
    reason: why,
    ...meta,
  });

  await notify({
    userId: log.createdById,
    title: `KCS trả ca về để sửa: ${log.sku.skuName}`,
    body: `${actor.fullName} trả lại ca ${log.shiftType} ngày ${formatVnDate(log.shiftDate)}. Cần sửa: ${why}`,
    level: "WARNING",
    linkUrl: `/production/${logId}/edit`,
  });

  return { id: logId };
}

/**
 * Người khai sửa ca bị trả về rồi gửi lại cho KCS. Chỉ CHÍNH người khai — để
 * "người khai ca" (createdById) vẫn đúng là người chịu trách nhiệm số liệu,
 * và luật "không tự xác nhận ca mình khai" ở bước 2 vẫn còn nghĩa.
 */
export async function resubmitShiftDraft(
  actor: SessionUser & { productionRole?: string | null },
  logId: string,
  input: DraftInput,
  meta: Meta = {}
) {
  if (!canEnterDraft(actor)) {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Bạn không có vai trò trong xưởng để khai báo ca sản xuất.",
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
  if (log.createdById !== actor.id) {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Chỉ người đã khai ca này mới sửa và gửi lại được.",
      403
    );
  }
  const returned = extractShiftReturn(log.qcNote);
  if (log.status !== "DRAFT" || !returned) {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      "Chỉ sửa được ca đang bị KCS trả về.",
      409
    );
  }

  const { sku, day } = await validateDraftInput(input, logId);

  await prisma
    .$transaction(async (tx) => {
      // Có điều kiện: ca vẫn đang ở trạng thái "trả về" — bấm gửi hai lần thì
      // lần sau nhận 409, không ghi đè danh sách người hai lần.
      const res = await tx.productionShiftLog.updateMany({
        where: {
          id: logId,
          status: "DRAFT",
          qcNote: { startsWith: SHIFT_RETURN_PREFIX },
        },
        data: {
          shiftDate: day,
          shiftType: input.shiftType,
          skuId: input.skuId,
          rawOutputKg: input.rawOutputKg,
          totalLaborHours: input.totalLaborHours,
          downtimeHours: input.downtimeHours,
          rawMaterialInputKg: input.rawMaterialInputKg,
          draftNote: input.draftNote ?? null,
          // Xoá dấu "trả về" — ca lại chờ KCS như mới khai
          qcNote: null,
        },
      });
      if (res.count !== 1) {
        shiftAlreadyHandled("Ca này vừa được gửi lại rồi.");
      }
      await tx.productionShiftParticipant.deleteMany({ where: { shiftLogId: logId } });
      await tx.productionShiftParticipant.createMany({
        data: input.participants.map((p) => ({
          shiftLogId: logId,
          userId: p.userId,
          stage: p.stage,
          hoursWorked: p.hoursWorked,
          scheduledHours: p.scheduledHours,
        })),
      });
    })
    .catch((e: unknown) =>
      draftWriteError(e, { shiftType: input.shiftType, day, skuCode: sku.skuCode })
    );

  await writeAudit({
    actor,
    action: "PRODUCTION_SHIFT_RESUBMIT",
    entityName: "production_shift_logs",
    entityId: logId,
    before: {
      ca: `${log.shiftType} ${formatVnDate(log.shiftDate)}`,
      sku: log.sku.skuCode,
      sanLuongTho: log.rawOutputKg,
      nvlCapVao: log.rawMaterialInputKg,
      soNguoi: log.participants.length,
    },
    after: {
      ca: `${input.shiftType} ${formatVnDate(day)}`,
      sku: sku.skuCode,
      sanLuongTho: input.rawOutputKg,
      nvlCapVao: input.rawMaterialInputKg,
      soNguoi: input.participants.length,
    },
    reason: `Sửa theo yêu cầu KCS (${returned.by}): ${returned.reason}`.slice(0, 1000),
    ...meta,
  });

  await notifyQcOfficers(
    `Ca đã sửa, chờ KCS xác nhận lại: ${sku.skuName}`,
    `${actor.fullName} đã sửa và gửi lại ca ${input.shiftType} ngày ${formatVnDate(day)}, sản lượng thô ${fmtKg(input.rawOutputKg)}.`,
    logId
  );

  return { id: logId };
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
    /**
     * Lý do BGĐ vượt quyền KCS. Không truyền thì đọc từ dòng đầu qcNote dạng
     * "[BGĐ vượt quyền KCS] <lý do>" (giao diện gửi theo cách này).
     */
    ceoOverrideReason?: string | null;
    /** Lý do lệch cân đối — bắt buộc khi lệch quá 5 kg (resolveMassGapReason) */
    massBalanceReason?: string | null;
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
  if (isShiftReturned(log)) {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      "Ca này đã được trả về sản xuất để sửa — chờ người khai gửi lại rồi mới xác nhận được.",
      409
    );
  }

  // Tách bạch trách nhiệm + BGĐ chỉ được vượt quyền có lý do (xem resolveQcApproval)
  const approval = resolveQcApproval(actor, log.createdById, input);
  const isOverride = approval.mode === "CEO_OVERRIDE";
  // KCS thường không được tự gắn tiền tố "vượt quyền" vào ghi chú — tiền tố
  // đó chỉ máy chủ ghi, nếu không trang chi tiết và nhật ký khoá sẽ báo sai
  // là Ban Giám đốc đã vượt quyền.
  const plainNote = input.qcNote?.startsWith(CEO_QC_OVERRIDE_PREFIX)
    ? input.qcNote.slice(CEO_QC_OVERRIDE_PREFIX.length).trim() || null
    : (input.qcNote ?? null);
  const baseNote = isOverride
    ? buildCeoOverrideQcNote(approval.reason, input.qcNote)
    : plainNote;

  const accounted = input.qcPassedKg + input.reworkKg + input.scrapKg;
  if (accounted > log.rawOutputKg * 1.5) {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      `Tổng KCS xác nhận ${fmtKg(accounted, { unit: "kg" })} vượt quá 150% sản lượng thô đã khai (${fmtKg(log.rawOutputKg, { unit: "kg" })}). Kiểm tra lại số cân.`,
      400
    );
  }

  // Lệch cân đối quá ngưỡng → bắt buộc lý do; lý do nối thành dòng cuối ghi
  // chú KCS (dòng đầu vẫn dành cho tiền tố vượt quyền nếu có).
  const gap = resolveMassGapReason(log.rawOutputKg, input, input.massBalanceReason);
  const qcNote =
    [baseNote, gap.noteLine].filter((x): x is string => !!x).join("\n") || null;

  // Chuyển trạng thái có điều kiện (status = DRAFT) — hai KCS bấm cùng lúc
  // thì chỉ một người ghi được.
  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.productionShiftLog.updateMany({
      // ...và chưa bị KCS khác trả về sản xuất trong lúc đang nhập
      where: {
        id: logId,
        status: "DRAFT",
        OR: [{ qcNote: null }, { NOT: { qcNote: { startsWith: SHIFT_RETURN_PREFIX } } }],
      },
      data: {
        qcPassedKg: input.qcPassedKg,
        reworkKg: input.reworkKg,
        scrapKg: input.scrapKg,
        haccpViolationCount: input.haccpViolationCount,
        qcNote,
        qcOfficerId: actor.id,
        qcApprovedAt: new Date(),
        status: "QC_APPROVED",
      },
    });
    if (res.count !== 1) {
      shiftAlreadyHandled("Ca này vừa được người khác xác nhận KCS hoặc trả về sản xuất.");
    }

    for (const d of input.participantDefects ?? []) {
      await tx.productionShiftParticipant.updateMany({
        where: { shiftLogId: logId, userId: d.userId },
        data: {
          personalDefectKg: d.personalDefectKg,
          violationCount: d.violationCount,
          note: d.note ?? null,
        },
      });
    }

    return tx.productionShiftLog.findUniqueOrThrow({
      where: { id: logId },
      include: { sku: true },
    });
  });

  await writeAudit({
    actor,
    // Vượt quyền ghi mã hành động riêng — tra nhật ký là thấy ngay, không lẫn
    // vào hàng nghìn dòng KCS duyệt bình thường.
    action: isOverride
      ? "PRODUCTION_SHIFT_QC_CEO_OVERRIDE"
      : "PRODUCTION_SHIFT_QC_APPROVE",
    entityName: "production_shift_logs",
    entityId: logId,
    before: { status: "DRAFT" },
    after: {
      status: "QC_APPROVED",
      dat: input.qcPassedKg,
      lamLai: input.reworkKg,
      phe: input.scrapKg,
      viPhamHaccp: input.haccpViolationCount,
      vuotQuyenKcs: isOverride,
      lechCanDoiKg: gap.gapKg,
    },
    reason:
      [
        isOverride ? `${CEO_QC_OVERRIDE_PREFIX} ${approval.reason}` : plainNote,
        gap.noteLine,
      ]
        .filter(Boolean)
        .join(" | ") || null,
    ...meta,
  });

  if (input.haccpViolationCount > 0) {
    await sendCeoAlert({
      title: `Vi phạm an toàn thực phẩm tại xưởng: ${input.haccpViolationCount} vụ`,
      details: `Ca ${log.shiftType} ngày ${formatVnDate(log.shiftDate)}, mã ${log.sku.skuCode}. ${isOverride ? "BGĐ (vượt quyền KCS)" : "KCS"} ${actor.fullName} ghi nhận. ${qcNote ?? ""}`,
      actionPath: `/production/${logId}`,
    });
  }

  // Báo Ban Giám đốc vào khoá số
  const ceos = await prisma.user.findMany({
    where: { role: "CEO", isActive: true },
    select: { id: true },
  });
  for (const c of ceos) {
    await notify({
      userId: c.id,
      title: `Ca sản xuất chờ khoá số: ${updated.sku.skuName}`,
      body: isOverride
        ? `${actor.fullName} (Ban Giám đốc) đã VƯỢT QUYỀN KCS xác nhận. Lý do: ${approval.reason}. Đạt ${fmtKg(input.qcPassedKg)}, phế ${fmtKg(input.scrapKg)}, làm lại ${fmtKg(input.reworkKg)}.`
        : `KCS ${actor.fullName} đã xác nhận. Đạt ${fmtKg(input.qcPassedKg)}, phế ${fmtKg(input.scrapKg)}, làm lại ${fmtKg(input.reworkKg)}.`,
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
    include: { sku: true },
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
  // Cột qualityLossVnd là Int (int4) — số tràn sẽ làm hỏng cả transaction khoá
  // với lỗi khó hiểu. Chặn trước, báo rõ số nào bất thường.
  if (
    !Number.isFinite(loss.qualityLossVnd) ||
    loss.qualityLossVnd < 0 ||
    loss.qualityLossVnd > MAX_QUALITY_LOSS_VND
  ) {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      `Tổn thất chất lượng tính ra ${Number.isFinite(loss.qualityLossVnd) ? new Intl.NumberFormat("vi-VN").format(loss.qualityLossVnd) : "không xác định"} VNĐ — vượt trần ${new Intl.NumberFormat("vi-VN").format(MAX_QUALITY_LOSS_VND)} VNĐ. Kiểm tra lại số nguyên liệu, phế phẩm, làm lại và đơn giá SKU.`,
      400
    );
  }

  /* --- Khoá NGUYÊN TỬ ---
     Kiểm tra status ở trên chỉ là đọc trước. Bấm đúp hoặc hai người trong
     BGĐ cùng khoá thì cả hai đều qua bước đọc — nếu không chặn ở đây, chấm
     điểm và trừ kho chạy hai lần. updateMany có điều kiện status =
     QC_APPROVED: chỉ đúng một lệnh ghi được, lệnh còn lại nhận 409. Trừ kho
     nằm chung transaction để khoá và trừ kho cùng thành công hoặc cùng huỷ. */
  const { locked, inventory } = await prisma.$transaction(async (tx) => {
    const res = await tx.productionShiftLog.updateMany({
      where: { id: logId, status: "QC_APPROVED" },
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
    if (res.count !== 1) {
      shiftAlreadyHandled("Ca này vừa được khoá (hoặc đổi trạng thái) bởi người khác.");
    }
    const inventory = await deductRawMaterialForShift(
      tx,
      logId,
      log.skuId,
      stdMaterialNormKg,
      actor.id
    );
    const locked = await tx.productionShiftLog.findUniqueOrThrow({
      where: { id: logId },
    });
    return { locked, inventory };
  });

  // Cùng một người BGĐ vừa vượt quyền KCS vừa khoá số: không chặn (xưởng nhỏ
  // có lúc chỉ một người trực), nhưng BẮT BUỘC để lại dấu vết trên dòng nhật ký
  // khoá — kèm lý do vượt quyền — để soát lại không phải lục hai chỗ.
  const qcOverrideReason = extractCeoQcOverrideReason(log.qcNote);
  const sameActorQcAndLock = log.qcOfficerId === actor.id;

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
      kcsVuotQuyenBoiBgd: qcOverrideReason !== null,
      cungNguoiDuyetKcsVaKhoa: sameActorQcAndLock,
    },
    reason:
      [
        sameActorQcAndLock && qcOverrideReason !== null
          ? `${CEO_QC_OVERRIDE_PREFIX} cùng người khoá số — ${qcOverrideReason}`
          : null,
        input.targetOverrideReason,
        input.materialOverrideReason,
      ]
        .filter(Boolean)
        .join(" | ") || null,
    ...meta,
  });

  // Chấm điểm và quét chống chạy chỉ tiêu — chỉ chạy ở đây, không sớm hơn.
  // Chỉ người khoá thắng ở transaction trên mới tới được đây → chạy đúng 1 lần.
  // Khoá đã commit ở trên: nếu chấm điểm lỗi, ca vẫn LOCKED nhưng chưa có điểm.
  // Lượt chạy nền tự chấm lại (rescoreLockedShiftsWithoutResults) — báo rõ cho
  // người bấm khoá thay vì một lỗi 500 trống trơn.
  let result: Awaited<ReturnType<typeof executeCalculationAndAudit>>;
  try {
    result = await executeCalculationAndAudit(logId);
  } catch (e) {
    console.error(`[PRODUCTION] Chấm điểm ca ${logId} lỗi sau khi khoá:`, e);
    throw new BusinessError(
      "SCORING_DEFERRED",
      "Ca đã khoá số thành công nhưng bước chấm điểm bị lỗi. Hệ thống sẽ tự chấm lại ở lượt chạy nền kế tiếp — không cần khoá lại.",
      500
    );
  }

  return { log: locked, ...result, inventory };
}

/**
 * TỰ CHỮA LÀNH: ca đã LOCKED mà chưa có dòng điểm nào (chấm điểm lỗi sau khi
 * khoá commit — mất mạng, timeout, deploy giữa chừng). Chạy lại bước chấm
 * điểm cho những ca đó. Idempotent: executeCalculationAndAudit upsert theo
 * (ca, người), ca đã có điểm thì không bị lọc vào đây.
 *
 * Gọi từ cron (lib/production/bridge.ts) TRƯỚC khi gộp số tháng, để điểm ca
 * kịp vào số liệu KPI tháng.
 */
export async function rescoreLockedShiftsWithoutResults(limit = 20) {
  const pending = await prisma.productionShiftLog.findMany({
    where: {
      status: "LOCKED",
      participants: { some: {} },
      kpiResults: { none: {} },
    },
    select: { id: true },
    orderBy: { lockedAt: "asc" },
    // Giới hạn mỗi lượt để không ăn hết 60 giây của cron; lượt sau làm tiếp
    take: limit,
  });

  const rescored: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const s of pending) {
    try {
      await executeCalculationAndAudit(s.id);
      rescored.push(s.id);
    } catch (e) {
      console.error(`[PRODUCTION] Chấm lại ca ${s.id} vẫn lỗi:`, e);
      failed.push({ id: s.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (rescored.length > 0 || failed.length > 0) {
    await writeAudit({
      actor: null,
      action: "PRODUCTION_KPI_RESCORE",
      entityName: "production_shift_logs",
      entityId: "cron",
      after: { caDaChamLai: rescored, caVanLoi: failed },
    });
  }

  return { found: pending.length, rescored: rescored.length, failed };
}

/**
 * Trừ kho NVL lý thuyết theo ĐỊNH MỨC (không phải số thực tế đã dùng) khi một
 * ca khoá số — xem chú thích ở model RawMaterial trong schema.prisma.
 *
 * Chạy TRONG transaction khoá ca. Trừ bằng `decrement` (nguyên tử ở DB) chứ
 * không ghi đè số dư tính từ một lần đọc cũ — hai ca khoá cùng lúc trên cùng
 * một NVL không làm mất lượt trừ của nhau. Số dư sau giao dịch đọc lại từ
 * kết quả update.
 *
 * Bỏ qua im lặng (trả `null`) nếu SKU chưa gán NVL nào — không phải lỗi, chỉ
 * là mã đó chưa bật theo dõi kho.
 */
async function deductRawMaterialForShift(
  tx: Prisma.TransactionClient,
  shiftLogId: string,
  skuId: string,
  stdMaterialNormKg: number,
  actorId: string
) {
  if (!(stdMaterialNormKg > 0)) return null;
  const sku = await tx.productSku.findUnique({
    where: { id: skuId },
    select: { rawMaterialId: true },
  });
  if (!sku?.rawMaterialId) return null;

  const material = await tx.rawMaterial.findUnique({
    where: { id: sku.rawMaterialId },
    select: { id: true, name: true, isActive: true },
  });
  if (!material || !material.isActive) return null;

  const after = await tx.rawMaterial.update({
    where: { id: material.id },
    data: { currentStockKg: { decrement: stdMaterialNormKg } },
    select: { currentStockKg: true },
  });
  const balanceAfter = round2(after.currentStockKg);

  await tx.rawMaterialTransaction.create({
    data: {
      rawMaterialId: material.id,
      type: "SHIFT_DEDUCTION",
      quantityKg: -stdMaterialNormKg,
      balanceAfterKg: balanceAfter,
      shiftLogId,
      createdById: actorId,
      note: "Trừ tự động theo định mức SKU khi khoá ca",
    },
  });

  return {
    materialId: material.id,
    materialName: material.name,
    deductedKg: stdMaterialNormKg,
    balanceAfterKg: balanceAfter,
  };
}

/**
 * Hoàn lại kho NVL đã trừ cho một ca khi mở lại ca. Tính theo SỔ GIAO DỊCH
 * của chính ca đó (tổng các dòng trừ + hoàn trước đây), nên mở/khoá nhiều lần
 * vẫn đúng và không hoàn khống nếu lần khoá trước không trừ kho.
 */
async function reverseRawMaterialForShift(
  tx: Prisma.TransactionClient,
  shiftLogId: string,
  actorId: string,
  reason: string
) {
  const rows = await tx.rawMaterialTransaction.groupBy({
    by: ["rawMaterialId"],
    where: {
      shiftLogId,
      type: { in: ["SHIFT_DEDUCTION", "SHIFT_REVERSAL"] },
    },
    _sum: { quantityKg: true },
  });

  const reversed: { materialId: string; returnedKg: number; balanceAfterKg: number }[] = [];
  for (const r of rows) {
    const net = round2(r._sum.quantityKg ?? 0); // âm = ca đang giữ phần đã trừ
    if (net >= 0) continue;
    const returnKg = -net;
    const after = await tx.rawMaterial.update({
      where: { id: r.rawMaterialId },
      data: { currentStockKg: { increment: returnKg } },
      select: { currentStockKg: true },
    });
    const balanceAfter = round2(after.currentStockKg);
    await tx.rawMaterialTransaction.create({
      data: {
        rawMaterialId: r.rawMaterialId,
        type: "SHIFT_REVERSAL",
        quantityKg: returnKg,
        balanceAfterKg: balanceAfter,
        shiftLogId,
        createdById: actorId,
        note: `Hoàn kho do mở lại ca đã khoá. Lý do: ${reason}`.slice(0, 500),
      },
    });
    reversed.push({ materialId: r.rawMaterialId, returnedKg: returnKg, balanceAfterKg: balanceAfter });
  }
  return reversed;
}

/* ============================================ CHẤM ĐIỂM & QUÉT BẤT THƯỜNG */

export async function executeCalculationAndAudit(logId: string) {
  const log = await prisma.productionShiftLog.findUnique({
    where: { id: logId },
    include: {
      sku: true,
      participants: { include: { user: { select: { employmentType: true } } } },
    },
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

  // Xoá bản quét cũ chưa ai đụng tới, giữ lại bản đã có người giải trình /
  // BGĐ đã xử lý. Khi khoá lại sau lần mở lại ca, KHÔNG tạo lại cảnh báo cùng
  // luật (behaviorType) đã có — nếu không, cảnh báo BGĐ đã chấp nhận sẽ mọc
  // lại và khoá thưởng thêm lần nữa cho cùng một vấn đề.
  await prisma.antiGamingAudit.deleteMany({
    where: { shiftLogId: logId, status: "PENDING_EXPLANATION" },
  });
  const handled = await prisma.antiGamingAudit.findMany({
    where: { shiftLogId: logId },
    select: { behaviorType: true },
  });
  const handledTypes = new Set(handled.map((a) => a.behaviorType));
  const newFindings = findings.filter((f) => !handledTypes.has(f.behaviorType));
  if (newFindings.length > 0) {
    await prisma.antiGamingAudit.createMany({
      data: newFindings.map((f) => ({ ...f, shiftLogId: logId })),
    });
  }

  // Khoá thưởng khi còn cảnh báo treo HOẶC có cảnh báo BGĐ đã từ chối — cùng
  // điều kiện với reviewAudit (trước đây chỗ này bỏ sót REJECTED, nên khoá
  // lại ca từng bị từ chối thì thưởng tự mở).
  const stillOpen = await prisma.antiGamingAudit.count({
    where: {
      shiftLogId: logId,
      status: { in: ["PENDING_EXPLANATION", "EXPLAINED", "REJECTED"] },
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
      title: `Điểm KPI ca ${log.shiftType} ngày ${formatVnDate(log.shiftDate)}`,
      body: bonusLocked
        ? `Bạn được ${score.finalWeightedScore} điểm (cá nhân ${score.tier1Score}, toàn xưởng ${score.tier2Score}). Thưởng ca đang tạm khoá vì có cảnh báo cần giải trình.`
        : `Bạn được ${score.finalWeightedScore} điểm (cá nhân ${score.tier1Score}, toàn xưởng ${score.tier2Score}).`,
      level: bonusLocked ? "WARNING" : "INFO",
      linkUrl: `/production/${logId}`,
    });
  }

  /* --- Báo Ban Giám đốc nếu có bất thường MỚI --- */
  if (newFindings.length > 0) {
    await sendCeoAlert({
      title: `Cảnh báo chạy chỉ tiêu: ${newFindings.length} dấu hiệu ở ca ${log.shiftType}`,
      details: newFindings
        .map((f) => `${BEHAVIOR_LABEL[f.behaviorType] ?? f.behaviorType}`)
        .join(" · ") + ` — đã tạm khoá thưởng của ${results.length} người, chờ quản đốc giải trình.`,
      actionPath: `/production/audits`,
    });

    const supervisors = await prisma.user.findMany({
      where: {
        productionRole: { in: ["SUPERVISOR", "PRODUCTION_DIRECTOR"] },
        isActive: true,
      },
      select: { id: true },
    });
    for (const s of supervisors) {
      await notify({
        userId: s.id,
        title: `Cần giải trình ca ${log.shiftType} ngày ${formatVnDate(log.shiftDate)}`,
        body: `Hệ thống phát hiện ${newFindings.length} dấu hiệu bất thường. Thưởng ca đang khoá cho tới khi Ban Giám đốc xem giải trình.`,
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
      canhBaoMoi: newFindings.length,
      khoaThuong: bonusLocked,
    },
  });

  return {
    metrics,
    tier2,
    results,
    findings: newFindings,
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
  const roleAllowed =
    actor.role === "CEO" ||
    ["SUPERVISOR", "PRODUCTION_DIRECTOR", "TEAM_LEADER"].includes(
      actor.productionRole ?? ""
    );
  if (!roleAllowed) {
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
    include: {
      shiftLog: {
        select: {
          createdById: true,
          participants: { select: { userId: true } },
        },
      },
    },
  });
  if (!audit) {
    throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy cảnh báo.", 404);
  }
  // Tổ trưởng chỉ giải trình ca mình có làm / mình khai — xem canExplainAudit
  if (
    !canExplainAudit(actor, {
      createdById: audit.shiftLog.createdById,
      participantUserIds: audit.shiftLog.participants.map((p) => p.userId),
    })
  ) {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Bạn không làm và không khai ca này nên không giải trình thay được. Để tổ trưởng của ca, quản đốc hoặc Giám đốc Sản xuất giải trình.",
      403
    );
  }
  if (audit.status !== "PENDING_EXPLANATION") {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      "Cảnh báo này đã qua bước giải trình rồi.",
      409
    );
  }

  const res = await prisma.antiGamingAudit.updateMany({
    where: { id: auditId, status: "PENDING_EXPLANATION" },
    data: {
      explanationText,
      explainedById: actor.id,
      explainedAt: new Date(),
      status: "EXPLAINED",
    },
  });
  if (res.count !== 1) {
    shiftAlreadyHandled("Cảnh báo này vừa được người khác giải trình.");
  }
  const updated = await prisma.antiGamingAudit.findUniqueOrThrow({
    where: { id: auditId },
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
  // Không tự quyết giải trình của chính mình
  assertCanReviewAudit(actor, audit);

  const res = await prisma.antiGamingAudit.updateMany({
    where: {
      id: auditId,
      status: { in: ["PENDING_EXPLANATION", "EXPLAINED"] },
      // Chặn cả lúc ghi: giữa lúc đọc và lúc ghi, chính người này vừa gửi
      // giải trình ở tab khác thì lệnh duyệt không được lọt qua.
      OR: [{ explainedById: null }, { explainedById: { not: actor.id } }],
    },
    data: {
      status: input.approved ? "CEO_APPROVED" : "REJECTED",
      ceoReviewNote: input.reviewNote,
      reviewedById: actor.id,
      reviewedAt: new Date(),
    },
  });
  if (res.count !== 1) {
    shiftAlreadyHandled("Cảnh báo này đã được xử lý rồi.");
  }
  const updated = await prisma.antiGamingAudit.findUniqueOrThrow({
    where: { id: auditId },
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
    // Chỉ những dòng đang khoá. Lúc khoá thưởng, finalBonusVnd bị ghi 0 nên
    // phải TÍNH LẠI theo đúng công thức lúc chấm (computeFinalScore):
    // thưởng nền × hệ số bậc — trước đây cộng lại chính số 0 nên không bao
    // giờ trả thưởng.
    const rows = await prisma.dailyKpiResult.findMany({
      where: { shiftLogId: audit.shiftLogId, isBonusLocked: true },
    });
    for (const r of rows) {
      await prisma.dailyKpiResult.update({
        where: { id: r.id },
        data: {
          isBonusLocked: false,
          finalBonusVnd: Math.round(BASE_BONUS_PER_SHIFT_VND * r.bonusMultiplier),
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

  // Nguyên tử: chuyển trạng thái có điều kiện, xoá điểm và HOÀN KHO phần đã
  // trừ khi khoá — cùng thành công hoặc cùng huỷ. Mở lại hai lần song song
  // thì lần sau nhận 409, không hoàn kho hai lần.
  const { updated, reversed } = await prisma.$transaction(async (tx) => {
    const res = await tx.productionShiftLog.updateMany({
      where: { id: logId, status: "LOCKED" },
      data: { status: "QC_APPROVED", lockedAt: null, lockedById: null },
    });
    if (res.count !== 1) {
      shiftAlreadyHandled("Ca này vừa được người khác mở lại.");
    }
    await tx.dailyKpiResult.deleteMany({ where: { shiftLogId: logId } });
    const reversed = await reverseRawMaterialForShift(tx, logId, actor.id, reason);
    const updated = await tx.productionShiftLog.findUniqueOrThrow({
      where: { id: logId },
    });
    return { updated, reversed };
  });

  await writeAudit({
    actor,
    action: "PRODUCTION_SHIFT_REOPEN",
    entityName: "production_shift_logs",
    entityId: logId,
    before: { status: "LOCKED" },
    after: { status: "QC_APPROVED", diemDaXoa: true, hoanKho: reversed },
    reason,
    ...meta,
  });

  return updated;
}
