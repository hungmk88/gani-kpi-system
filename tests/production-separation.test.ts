import { describe, expect, it } from "vitest";
import {
  CEO_QC_OVERRIDE_PREFIX,
  assertCanReviewAudit,
  buildCeoOverrideQcNote,
  canExplainAudit,
  extractCeoQcOverrideReason,
  resolveQcApproval,
} from "@/lib/services/production-service";
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
