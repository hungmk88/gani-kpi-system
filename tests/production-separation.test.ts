import { describe, expect, it } from "vitest";
import {
  CEO_QC_OVERRIDE_PREFIX,
  assertCanReviewAudit,
  assertParticipantDefectsValid,
  buildCeoOverrideQcNote,
  canExplainAudit,
  canOpenAuditPortal,
  canSeeAuditDetails,
  extractCeoQcOverrideReason,
  redactAuditForViewer,
  resolveQcApproval,
  sanitizeQcNoteInput,
} from "@/lib/services/production-service";
import { SHIFT_RETURN_PREFIX, isShiftReturned } from "@/lib/production/shift-flow";
import { BusinessError } from "@/lib/rbac";

// TÁCH BẠCH TRÁCH NHIỆM trong luồng 3 bước của xưởng: khai → KCS → BGĐ khoá.
// Một người không được tự đi hết cả luồng, và không ai tự phán xử giải trình
// của chính mình.

const qc = { id: "qc1", role: "STAFF", productionRole: "QC_OFFICER" };
const ceo = { id: "ceo1", role: "CEO", productionRole: null };
const worker = { id: "w1", role: "STAFF", productionRole: "WORKER" };

function statusOf(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    if (e instanceof BusinessError) return e.statusCode;
    throw e;
  }
  return 200;
}

describe("bước 2 — ai được xác nhận KCS", () => {
  it("KCS duyệt ca người khác khai: bình thường", () => {
    expect(resolveQcApproval(qc, "w1", {})).toEqual({ mode: "QC" });
  });

  it("KCS không tự duyệt ca mình khai", () => {
    expect(statusOf(() => resolveQcApproval(qc, "qc1", {}))).toBe(403);
  });

  it("người không phải KCS / BGĐ: cấm", () => {
    expect(statusOf(() => resolveQcApproval(worker, "x", {}))).toBe(403);
  });

  it("BGĐ không ghi lý do vượt quyền: bị chặn (không còn được coi như KCS)", () => {
    expect(statusOf(() => resolveQcApproval(ceo, "w1", {}))).toBe(400);
    expect(
      statusOf(() => resolveQcApproval(ceo, "w1", { qcNote: "viên nứt nhẹ ở lô 2" }))
    ).toBe(400);
  });

  it("BGĐ ghi lý do quá ngắn (< 10 ký tự): bị chặn", () => {
    expect(
      statusOf(() =>
        resolveQcApproval(ceo, "w1", { qcNote: `${CEO_QC_OVERRIDE_PREFIX} gấp` })
      )
    ).toBe(400);
    expect(
      statusOf(() => resolveQcApproval(ceo, "w1", { ceoOverrideReason: "   gấp    " }))
    ).toBe(400);
  });

  it("BGĐ vượt quyền có lý do đủ dài: được, trả lý do để ghi nhật ký", () => {
    const r = resolveQcApproval(ceo, "w1", {
      qcNote: `${CEO_QC_OVERRIDE_PREFIX} KCS ca đêm nghỉ ốm\nviên nứt nhẹ`,
    });
    expect(r).toEqual({ mode: "CEO_OVERRIDE", reason: "KCS ca đêm nghỉ ốm" });

    const r2 = resolveQcApproval(ceo, "w1", {
      ceoOverrideReason: "KCS nghỉ phép cả tuần",
    });
    expect(r2).toEqual({ mode: "CEO_OVERRIDE", reason: "KCS nghỉ phép cả tuần" });
  });

  it("BGĐ tự khai ca rồi vượt quyền KCS chính ca đó: cấm", () => {
    expect(
      statusOf(() =>
        resolveQcApproval(ceo, "ceo1", { ceoOverrideReason: "KCS nghỉ phép cả tuần" })
      )
    ).toBe(403);
  });

  it("BGĐ kiêm vai trò KCS: duyệt như KCS, không cần lý do vượt quyền", () => {
    const ceoQc = { id: "c2", role: "CEO", productionRole: "QC_OFFICER" };
    expect(resolveQcApproval(ceoQc, "w1", {})).toEqual({ mode: "QC" });
  });
});

describe("ghi chú KCS khi vượt quyền", () => {
  it("tách lý do ở dòng đầu, bỏ qua ghi chú phía sau", () => {
    expect(
      extractCeoQcOverrideReason(`${CEO_QC_OVERRIDE_PREFIX}  KCS nghỉ ốm \nghi chú`)
    ).toBe("KCS nghỉ ốm");
    expect(extractCeoQcOverrideReason("viên nứt")).toBeNull();
    expect(extractCeoQcOverrideReason(null)).toBeNull();
  });

  it("ghép qcNote: tiền tố + lý do, ghi chú xuống dòng; không nhân đôi tiền tố", () => {
    expect(buildCeoOverrideQcNote("KCS nghỉ ốm cả ca", "viên nứt")).toBe(
      `${CEO_QC_OVERRIDE_PREFIX} KCS nghỉ ốm cả ca\nviên nứt`
    );
    expect(
      buildCeoOverrideQcNote(
        "KCS nghỉ ốm cả ca",
        `${CEO_QC_OVERRIDE_PREFIX} KCS nghỉ ốm cả ca\nviên nứt`
      )
    ).toBe(`${CEO_QC_OVERRIDE_PREFIX} KCS nghỉ ốm cả ca\nviên nứt`);
    expect(buildCeoOverrideQcNote("KCS nghỉ ốm cả ca", null)).toBe(
      `${CEO_QC_OVERRIDE_PREFIX} KCS nghỉ ốm cả ca`
    );
  });
});

describe("ai được giải trình cảnh báo của một ca", () => {
  const shift = { createdById: "creator", participantUserIds: ["tl-in", "w1"] };
  const tl = (id: string) => ({ id, role: "STAFF", productionRole: "TEAM_LEADER" });

  it("tổ trưởng có làm ca / khai ca: được", () => {
    expect(canExplainAudit(tl("tl-in"), shift)).toBe(true);
    expect(canExplainAudit(tl("creator"), shift)).toBe(true);
  });

  it("tổ trưởng tổ khác (không làm, không khai): KHÔNG được", () => {
    expect(canExplainAudit(tl("tl-other"), shift)).toBe(false);
  });

  it("quản đốc, Giám đốc SX, BGĐ: được mọi ca", () => {
    expect(
      canExplainAudit({ id: "s", role: "STAFF", productionRole: "SUPERVISOR" }, shift)
    ).toBe(true);
    expect(
      canExplainAudit(
        { id: "d", role: "STAFF", productionRole: "PRODUCTION_DIRECTOR" },
        shift
      )
    ).toBe(true);
    // BGĐ là người phán xử — tự giải trình thì không ai duyệt được nữa
    expect(canExplainAudit(ceo, shift)).toBe(false);
  });

  it("công nhân, KCS: không giải trình", () => {
    expect(canExplainAudit({ ...worker, id: "w1" }, shift)).toBe(false);
    expect(canExplainAudit(qc, shift)).toBe(false);
  });
});

describe("BGĐ không tự quyết giải trình của chính mình", () => {
  it("giải trình do người khác viết: được quyết", () => {
    expect(statusOf(() => assertCanReviewAudit(ceo, { explainedById: "s1" }))).toBe(200);
    expect(statusOf(() => assertCanReviewAudit(ceo, { explainedById: null }))).toBe(200);
  });

  it("giải trình do chính mình viết: chặn", () => {
    expect(statusOf(() => assertCanReviewAudit(ceo, { explainedById: "ceo1" }))).toBe(
      403
    );
  });

  it("không phải BGĐ: chặn", () => {
    expect(statusOf(() => assertCanReviewAudit(qc, { explainedById: "s1" }))).toBe(403);
  });
});

describe("ghi chú KCS — tiền tố vượt quyền chỉ máy chủ được ghi", () => {
  it("lý do vượt quyền gửi ở trường riêng vẫn được chấp nhận", () => {
    const r = resolveQcApproval(ceo, "w1", {
      ceoOverrideReason: "KCS ca đêm nghỉ ốm đột xuất",
    });
    expect(r).toEqual({ mode: "CEO_OVERRIDE", reason: "KCS ca đêm nghỉ ốm đột xuất" });
  });
});

describe("bước 2 — người có tên làm ca không được xác nhận KCS", () => {
  const shift = { createdById: "w1", participantUserIds: ["w1", "w2", "qc1"] };

  it("KCS có tên trong ca: chặn (tự chấm lỗi công đoạn của mình)", () => {
    expect(statusOf(() => resolveQcApproval(qc, shift, {}))).toBe(403);
  });

  it("KCS không làm ca: duyệt bình thường", () => {
    expect(
      resolveQcApproval(qc, { createdById: "w1", participantUserIds: ["w1", "w2"] }, {})
    ).toEqual({ mode: "QC" });
  });

  it("BGĐ có tên trong ca: vượt quyền cũng bị chặn", () => {
    expect(
      statusOf(() =>
        resolveQcApproval(
          ceo,
          { createdById: "w1", participantUserIds: ["ceo1"] },
          { ceoOverrideReason: "KCS nghỉ phép cả tuần" }
        )
      )
    ).toBe(403);
  });

  it("BGĐ không làm ca vẫn vượt quyền được (ca có KCS duy nhất là người làm ca)", () => {
    expect(
      resolveQcApproval(ceo, shift, { ceoOverrideReason: "KCS duy nhất có tên làm ca" })
    ).toEqual({ mode: "CEO_OVERRIDE", reason: "KCS duy nhất có tên làm ca" });
  });
});

describe("ghi chú KCS — không giả được tiền tố trạng thái", () => {
  it("gỡ tiền tố vượt quyền ở mọi vị trí, kể cả có dấu cách phía trước", () => {
    const forged = sanitizeQcNoteInput(` ${CEO_QC_OVERRIDE_PREFIX} giả làm BGĐ\nviên nứt`);
    expect(forged).toBe("giả làm BGĐ\nviên nứt");
    expect(extractCeoQcOverrideReason(forged)).toBeNull();
  });

  it("gỡ tiền tố 'KCS trả về' — không giả được ca bị trả về", () => {
    const n = sanitizeQcNoteInput(`  ${SHIFT_RETURN_PREFIX} ai đó\nlý do`);
    expect(n).toBe("ai đó\nlý do");
    expect(isShiftReturned({ status: "DRAFT", qcNote: n })).toBe(false);
  });

  it("ghi chú rỗng / chỉ có tiền tố → null", () => {
    expect(sanitizeQcNoteInput("   ")).toBeNull();
    expect(sanitizeQcNoteInput(CEO_QC_OVERRIDE_PREFIX)).toBeNull();
    expect(sanitizeQcNoteInput(undefined)).toBeNull();
  });

  it("BGĐ vượt quyền: ghi chú phía sau không mang thêm tiền tố nào", () => {
    const note = buildCeoOverrideQcNote(
      "KCS nghỉ ốm cả ca",
      `${CEO_QC_OVERRIDE_PREFIX} KCS nghỉ ốm cả ca\n${SHIFT_RETURN_PREFIX} viên nứt`
    );
    expect(note).toBe(`${CEO_QC_OVERRIDE_PREFIX} KCS nghỉ ốm cả ca\nviên nứt`);
    expect(note.split(CEO_QC_OVERRIDE_PREFIX).length).toBe(2);
  });
});

describe("lỗi công đoạn KCS gán cho từng người", () => {
  it("đúng người trong ca, mỗi người một dòng: được", () => {
    expect(statusOf(() => assertParticipantDefectsValid([{ userId: "a" }], ["a", "b"]))).toBe(
      200
    );
    expect(statusOf(() => assertParticipantDefectsValid(undefined, ["a"]))).toBe(200);
  });

  it("trùng người: chặn", () => {
    expect(
      statusOf(() => assertParticipantDefectsValid([{ userId: "a" }, { userId: "a" }], ["a"]))
    ).toBe(400);
  });

  it("người ngoài ca: chặn thay vì bỏ qua im lặng", () => {
    expect(
      statusOf(() => assertParticipantDefectsValid([{ userId: "x" }], ["a", "b"]))
    ).toBe(400);
  });
});

describe("một luật xem cảnh báo cho trang và API chi tiết ca", () => {
  const audit = {
    id: "a1",
    behaviorType: "MATERIAL_OVERRUN",
    severity: "CRITICAL",
    status: "CEO_APPROVED",
    createdAt: new Date("2026-10-01T00:00:00Z"),
    auditNote: "NVL vượt định mức 12%",
    explanationText: "Lô thịt rã đông hao nước",
    explainedById: "sup1",
    explainedBy: { id: "sup1", fullName: "Quản đốc" },
    ceoReviewNote: "Chấp nhận, theo dõi tuần sau",
    reviewedBy: { id: "ceo1", fullName: "BGĐ" },
  };

  it("cấp quản lý xưởng (vào được cổng cảnh báo) thấy đủ", () => {
    const sup = { id: "s9", role: "STAFF", productionRole: "SUPERVISOR" };
    expect(canOpenAuditPortal(sup)).toBe(true);
    const r = redactAuditForViewer(audit, sup);
    expect(r.detailed).toBe(true);
    expect(r.auditNote).toBe(audit.auditNote);
    expect(r.explanationText).toBe(audit.explanationText);
  });

  it("công nhân làm ca: biết có cảnh báo + kết luận BGĐ, không thấy nội dung / giải trình người khác", () => {
    expect(canOpenAuditPortal(worker)).toBe(false);
    const r = redactAuditForViewer(audit, worker);
    expect(r.detailed).toBe(false);
    expect(r.behaviorType).toBe("MATERIAL_OVERRUN");
    expect(r.status).toBe("CEO_APPROVED");
    expect(r.auditNote).toBeNull();
    expect(r.explanationText).toBeNull();
    expect(r.ceoReviewNote).toBe(audit.ceoReviewNote);
  });

  it("người không vào được cổng nhưng chính mình viết giải trình: thấy giải trình của mình", () => {
    const r = redactAuditForViewer({ ...audit, explainedById: "w1" }, worker);
    expect(r.explanationText).toBe(audit.explanationText);
  });

  it("ADMIN không vào được cổng cảnh báo — không hiện liên kết", () => {
    expect(canOpenAuditPortal({ role: "ADMIN", productionRole: null })).toBe(false);
    expect(canSeeAuditDetails({ role: "ADMIN", productionRole: null })).toBe(false);
  });
});
