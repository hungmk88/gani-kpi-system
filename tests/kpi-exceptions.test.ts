import { describe, expect, it } from "vitest";
import {
  exceptionRank,
  foldVn,
  groupFlags,
  initialOpen,
  matchesFilter,
  matchesSearch,
  rowNeedsViewer,
  sortByException,
  type ExceptionGroup,
  type ExceptionRow,
  type Viewer,
} from "@/app/(app)/kpi/[periodId]/exceptions";

const r = (status: string, over: Partial<ExceptionRow> = {}): ExceptionRow => ({
  status,
  hasMismatch: false,
  isCapped: false,
  isGatekeeper: false,
  ...over,
});

const g = (
  id: string,
  rows: ExceptionRow[],
  over: Partial<ExceptionGroup> = {}
): ExceptionGroup => ({
  employeeId: id,
  employeeName: `Người ${id}`,
  employeeEmail: `${id}@gani.vn`,
  employeeRole: "EMPLOYEE",
  jobTitle: "",
  departmentName: "Kinh doanh",
  rows,
  summary: { totalScore: 90 },
  ...over,
});

const ceo: Viewer = { userId: "ceo", role: "CEO", selfOpen: false, managerOpen: false };
const manager: Viewer = { userId: "tp", role: "MANAGER", selfOpen: true, managerOpen: true };
const emp: Viewer = { userId: "nv", role: "EMPLOYEE", selfOpen: true, managerOpen: true };

describe("chờ tôi xử lý", () => {
  it("nhân viên: dòng của mình chưa khai, còn hạn", () => {
    expect(rowNeedsViewer(r("DRAFT"), g("nv", []), emp)).toBe(true);
    expect(rowNeedsViewer(r("SELF_REVIEWED"), g("nv", []), emp)).toBe(false);
    expect(rowNeedsViewer(r("DRAFT"), g("nv", []), { ...emp, selfOpen: false })).toBe(false);
  });

  it("trưởng phòng: dòng nhân viên đã khai, còn hạn duyệt; không tính dòng của chính mình", () => {
    expect(rowNeedsViewer(r("SELF_REVIEWED"), g("a", []), manager)).toBe(true);
    expect(rowNeedsViewer(r("SELF_REVIEWED"), g("a", []), { ...manager, managerOpen: false })).toBe(false);
    expect(rowNeedsViewer(r("SELF_REVIEWED"), g("tp", []), manager)).toBe(false);
  });

  it("Ban Giám đốc: dòng sẵn sàng khoá (không lệch số) và KPI tự khai của trưởng phòng", () => {
    expect(rowNeedsViewer(r("MANAGER_REVIEWED"), g("a", []), ceo)).toBe(true);
    expect(rowNeedsViewer(r("MANAGER_REVIEWED", { hasMismatch: true }), g("a", []), ceo)).toBe(false);
    expect(rowNeedsViewer(r("SELF_REVIEWED"), g("a", []), ceo)).toBe(false);
    expect(rowNeedsViewer(r("SELF_REVIEWED"), g("a", [], { employeeRole: "MANAGER" }), ceo)).toBe(true);
    expect(rowNeedsViewer(r("FINALIZED"), g("a", []), ceo)).toBe(false);
  });
});

describe("cờ ngoại lệ & thứ tự", () => {
  it("gatekeeper không bao giờ tính là chạm trần", () => {
    const f = groupFlags(g("a", [r("SELF_REVIEWED", { isCapped: true, isGatekeeper: true })]), ceo, "PROVISIONAL");
    expect(f.capped).toBe(0);
  });

  it("dưới 70 chỉ báo khi đã khai đủ — đang khai dở thì không", () => {
    const low = { summary: { totalScore: 40 } };
    expect(groupFlags(g("a", [r("DRAFT"), r("SELF_REVIEWED")], low), ceo, "PROVISIONAL").below70).toBe(false);
    expect(groupFlags(g("a", [r("SELF_REVIEWED")], low), ceo, "PROVISIONAL").below70).toBe(true);
    expect(groupFlags(g("a", [r("DRAFT")], low), ceo, "UNSCORED").below70).toBe(false);
  });

  it("lệch số → chờ tôi → chạm trần → dưới 70 → còn lại; cùng mức giữ thứ tự tên", () => {
    const groups = [
      g("binh", [r("SELF_REVIEWED")]),
      g("cuong", [r("SELF_REVIEWED", { isCapped: true })]),
      g("dung", [r("MANAGER_REVIEWED")]),
      g("an", [r("SELF_REVIEWED")], { summary: { totalScore: 50 } }),
      g("em", [r("SELF_REVIEWED", { hasMismatch: true })]),
      g("giang", [r("MANAGER_REVIEWED")]),
    ];
    const ranked = groups.map((x) => ({ x, f: groupFlags(x, ceo, "PROVISIONAL") }));
    const sorted = sortByException(ranked, (y) => exceptionRank(y.f)).map((y) => y.x.employeeId);
    expect(sorted).toEqual(["em", "dung", "giang", "cuong", "an", "binh"]);
  });

  it("bộ lọc", () => {
    const f = groupFlags(g("a", [r("DRAFT"), r("MANAGER_REVIEWED", { isCapped: true })]), ceo, "PROVISIONAL");
    expect(matchesFilter(f, "all")).toBe(true);
    expect(matchesFilter(f, "mine")).toBe(true);
    expect(matchesFilter(f, "capped")).toBe(true);
    expect(matchesFilter(f, "draft")).toBe(true);
    expect(matchesFilter(f, "mismatch")).toBe(false);
    expect(matchesFilter(f, "below70")).toBe(false);
  });
});

describe("tìm kiếm & mở sẵn", () => {
  it("tìm không dấu, theo tên / email / phòng ban", () => {
    const x = g("x", [], { employeeName: "Đỗ Thị Hằng", employeeEmail: "hang.do@gani.vn" });
    expect(foldVn("Đỗ Thị Hằng")).toBe("do thi hang");
    expect(matchesSearch(x, "do thi")).toBe(true);
    expect(matchesSearch(x, "HANG.DO")).toBe(true);
    expect(matchesSearch(x, "kinh doanh")).toBe(true);
    expect(matchesSearch(x, "nguyen")).toBe(false);
    expect(matchesSearch(x, "  ")).toBe(true);
    expect(matchesSearch({ ...x, employeeCode: "NV0012" }, "nv0012")).toBe(true);
  });

  it("mở sẵn người đang chờ mình (tối đa 5); không ai chờ thì người lệch số / bảng của mình", () => {
    const flags = (needsMe: number, mismatch = 0) => ({ needsMe, mismatch, capped: 0, below70: false, draft: 0 });
    const many = Array.from({ length: 8 }, (_, i) => ({ employeeId: `e${i}`, flags: flags(1) }));
    expect(initialOpen(many, "ceo")).toEqual(["e0", "e1", "e2", "e3", "e4"]);
    expect(
      initialOpen([{ employeeId: "a", flags: flags(0) }, { employeeId: "b", flags: flags(0, 1) }], "a")
    ).toEqual(["b"]);
    expect(
      initialOpen([{ employeeId: "a", flags: flags(0) }, { employeeId: "me", flags: flags(0) }], "me")
    ).toEqual(["me"]);
    expect(initialOpen([], "me")).toEqual([]);
  });
});
