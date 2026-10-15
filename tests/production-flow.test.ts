import { describe, expect, it } from "vitest";
import {
  CEO_QC_OVERRIDE_PREFIX,
  RETURNED_WHERE,
  WAITING_QC_WHERE,
  awaitingMyStepWhere,
  extractCeoQcOverrideReason,
  resolveMassGapReason,
} from "@/lib/services/production-service";
import {
  SHIFT_RETURN_PREFIX,
  buildMassGapNoteLine,
  buildShiftReturnNote,
  extractShiftReturn,
  isShiftReturned,
  massGapKg,
  needsMassGapReason,
} from "@/lib/production/shift-flow";
import { BusinessError } from "@/lib/rbac";

// Luồng phụ của bước 1–2: KCS trả ca về sản xuất (không thêm status — đánh
// dấu trong qcNote) và lý do bắt buộc khi lệch cân đối quá 5 kg.

function statusOf(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    if (e instanceof BusinessError) return e.statusCode;
    throw e;
  }
  return 200;
}

describe("KCS trả ca về sản xuất", () => {
  it("ghi và đọc lại người trả + lý do", () => {
    const note = buildShiftReturnNote("  Trần KCS ", "  Sản lượng thô khai thiếu lô 3 \n");
    expect(note.startsWith(SHIFT_RETURN_PREFIX)).toBe(true);
    expect(extractShiftReturn(note)).toEqual({
      by: "Trần KCS",
      reason: "Sản lượng thô khai thiếu lô 3",
    });
  });

  it("ghi chú KCS thường / vượt quyền BGĐ không bị hiểu nhầm là trả về", () => {
    expect(extractShiftReturn(null)).toBeNull();
    expect(extractShiftReturn("viên nứt nhẹ")).toBeNull();
    expect(extractShiftReturn(`${CEO_QC_OVERRIDE_PREFIX} KCS nghỉ ốm cả tuần`)).toBeNull();
  });

  it("dấu trả về không bị đọc thành BGĐ vượt quyền KCS", () => {
    expect(extractCeoQcOverrideReason(buildShiftReturnNote("A", "sửa lại số thô"))).toBeNull();
  });

  it("chỉ ca DRAFT mới tính là đang bị trả về", () => {
    const note = buildShiftReturnNote("A", "khai nhầm mã sản phẩm");
    expect(isShiftReturned({ status: "DRAFT", qcNote: note })).toBe(true);
    expect(isShiftReturned({ status: "QC_APPROVED", qcNote: note })).toBe(false);
    expect(isShiftReturned({ status: "DRAFT", qcNote: null })).toBe(false);
  });
});

describe("lệch cân đối khối lượng lúc KCS phân loại", () => {
  it("tính lệch = thô − (đạt + làm lại + phế), làm tròn 2 số", () => {
    expect(massGapKg(400, { qcPassedKg: 350, reworkKg: 5, scrapKg: 5 })).toBe(40);
    expect(massGapKg(100, { qcPassedKg: 100.1, reworkKg: 0.2, scrapKg: 0 })).toBe(-0.3);
  });

  it("ngưỡng 5 kg: đúng 5 kg chưa phải ghi lý do, trên 5 kg (cả thừa lẫn thiếu) thì phải", () => {
    expect(needsMassGapReason(5)).toBe(false);
    expect(needsMassGapReason(-5)).toBe(false);
    expect(needsMassGapReason(5.01)).toBe(true);
    expect(needsMassGapReason(-6)).toBe(true);
  });

  it("lệch nhỏ: không cần lý do, không thêm dòng ghi chú", () => {
    expect(
      resolveMassGapReason(400, { qcPassedKg: 380, reworkKg: 10, scrapKg: 7 })
    ).toEqual({ gapKg: 3, noteLine: null });
  });

  it("lệch lớn mà không ghi / ghi quá ngắn lý do: máy chủ chặn 400", () => {
    const parts = { qcPassedKg: 350, reworkKg: 5, scrapKg: 5 };
    expect(statusOf(() => resolveMassGapReason(400, parts))).toBe(400);
    expect(statusOf(() => resolveMassGapReason(400, parts, "   cân   "))).toBe(400);
  });

  it("lệch lớn có lý do: trả dòng ghi chú kèm hướng lệch", () => {
    const r = resolveMassGapReason(
      400,
      { qcPassedKg: 350, reworkKg: 5, scrapKg: 5 },
      "  Cân sót   lô 2, đã báo tổ trưởng "
    );
    expect(r.gapKg).toBe(40);
    expect(r.noteLine).toBe("[Lệch cân đối thiếu 40 kg] Cân sót lô 2, đã báo tổ trưởng");
    expect(buildMassGapNoteLine(-7.5, "cân dư do đá bám")).toBe(
      "[Lệch cân đối thừa 7,5 kg] cân dư do đá bám"
    );
  });
});

describe("ca đang chờ vai trò của tôi", () => {
  it("KCS: ca chờ KCS, trừ ca chính mình khai", () => {
    expect(
      awaitingMyStepWhere({ id: "qc1", role: "STAFF", productionRole: "QC_OFFICER" })
    ).toEqual({ ...WAITING_QC_WHERE, createdById: { not: "qc1" } });
  });

  it("tổ trưởng: ca của chính mình bị trả về", () => {
    expect(
      awaitingMyStepWhere({ id: "t1", role: "STAFF", productionRole: "TEAM_LEADER" })
    ).toEqual({ ...RETURNED_WHERE, createdById: "t1" });
  });

  it("Ban Giám đốc: ca chờ khoá số + ca mình khai bị trả về", () => {
    expect(awaitingMyStepWhere({ id: "c1", role: "CEO", productionRole: null })).toEqual({
      OR: [{ status: "QC_APPROVED" }, { ...RETURNED_WHERE, createdById: "c1" }],
    });
  });

  it("không có vai trò trong luồng: không có ca nào chờ", () => {
    expect(awaitingMyStepWhere({ id: "a1", role: "ADMIN", productionRole: null })).toBeNull();
  });
});
