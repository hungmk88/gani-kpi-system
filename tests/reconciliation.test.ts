import { describe, expect, it } from "vitest";
import {
  computeVariance,
  latestSources,
  planCell,
  reconPeriodState,
  sourcesFingerprint,
  sourcesFingerprint as fp,
  staleResolutionAction,
} from "@/lib/services/reconciliation-service";

describe("đối soát — dấu vân tay nguồn", () => {
  it("bỏ qua thời điểm và thứ tự, chỉ so mã + giá trị", () => {
    const a = sourcesFingerprint([
      { code: "SELF", value: 10 },
      { code: "IPOS", value: 12 },
    ]);
    const b = sourcesFingerprint([
      { code: "IPOS", value: 12 },
      { code: "SELF", value: 10 },
    ]);
    expect(a).toBe(b);
    expect(sourcesFingerprint([{ code: "IPOS", value: 13 }])).not.toBe(
      sourcesFingerprint([{ code: "IPOS", value: 12 }])
    );
  });
});

describe("đối soát — planCell (quét hàng loạt chỉ ghi ô có thay đổi)", () => {
  const def = { id: "d1" };
  const row = (over: Partial<{ status: string; actualSelf: number | null; actualSystem: number | null }> = {}) => ({
    status: "SELF_REVIEWED",
    kpiDefinitionId: "d1",
    kpiDefinition: def,
    actualSelf: null,
    actualSystem: null,
    ...over,
  });
  const feed = (sourceCode: string, value: number, t = 0) => ({
    value,
    source: "EXTERNAL_API",
    sourceCode,
    createdAt: new Date(1_700_000_000_000 + t),
  });
  const existingFrom = (status: string, feeds: ReturnType<typeof feed>[], self: number | null = null) => {
    const sources = latestSources(feeds, self);
    const v = computeVariance(sources);
    return { status, sourcesJson: JSON.stringify(sources), ...v };
  };
  const priorities = new Map<string, number>();

  it("dòng đã chốt hoặc chưa gán chỉ tiêu thì bỏ qua", () => {
    expect(planCell({ row: row({ status: "FINALIZED" }), feeds: [feed("ipos", 10)], existing: null, priorities }).action).toBe("noop");
    expect(planCell({ row: { ...row(), kpiDefinitionId: null }, feeds: [feed("ipos", 10)], existing: null, priorities }).action).toBe("noop");
  });

  it("không có nguồn ngoài và chưa có bản đối soát thì không ghi gì", () => {
    expect(planCell({ row: row({ actualSelf: 5 }), feeds: [], existing: null, priorities }).action).toBe("noop");
  });

  it("có nguồn mới mà chưa có bản đối soát thì ghi", () => {
    expect(planCell({ row: row(), feeds: [feed("ipos", 10)], existing: null, priorities }).action).toBe("write");
  });

  it("vẫn lệch như cũ thì không ghi lại (đã cảnh báo rồi)", () => {
    const feeds = [feed("ipos", 100), feed("crm", 150, 1)];
    const existing = existingFrom("MISMATCH", feeds);
    expect(planCell({ row: row(), feeds, existing, priorities })).toEqual({ action: "noop", outcome: "mismatched" });
  });

  it("số nguồn đổi thì ghi lại", () => {
    const existing = existingFrom("MISMATCH", [feed("ipos", 100), feed("crm", 150)]);
    const feeds = [feed("ipos", 100), feed("crm", 101)];
    expect(planCell({ row: row(), feeds, existing, priorities }).action).toBe("write");
  });

  it("đã chốt tay và số nguồn không đổi thì giữ nguyên quyết định", () => {
    const feeds = [feed("ipos", 100), feed("crm", 150)];
    const existing = existingFrom("RESOLVED", feeds);
    expect(planCell({ row: row(), feeds, existing, priorities }).action).toBe("noop");
    expect(fp(JSON.parse(existing.sourcesJson))).toBe(fp(latestSources(feeds, null)));
  });
});

describe("đối soát — tình trạng kỳ trên màn hình", () => {
  it("kỳ chưa có ô đối soát nào là 'chưa có dữ liệu', không phải 'khớp'", () => {
    expect(reconPeriodState({ matched: 0, mismatched: 0, resolved: 0 })).toBe("no_data");
  });
  it("chỉ nói khớp khi đã có số và không còn ô lệch", () => {
    expect(reconPeriodState({ matched: 12, mismatched: 0, resolved: 0 })).toBe("all_matched");
    expect(reconPeriodState({ matched: 0, mismatched: 0, resolved: 3 })).toBe("all_matched");
  });
  it("còn ô lệch chưa chốt thì là có lệch", () => {
    expect(reconPeriodState({ matched: 12, mismatched: 1, resolved: 3 })).toBe("has_mismatch");
  });
});

describe("đối soát — số chốt cũ khi nguồn đổi sau lần chốt", () => {
  const resolved = { status: "RESOLVED", resolvedValue: 500 };
  const base = { existing: resolved, sourcesChanged: true, nextValue: null as number | null };

  it("dòng còn ở bước nhân viên: gỡ số chốt do lần chốt ghi", () => {
    expect(
      staleResolutionAction({ ...base, row: { status: "SELF_REVIEWED", actualFinal: 500 } })
    ).toBe("clear");
    expect(
      staleResolutionAction({ ...base, row: { status: "DRAFT", actualFinal: 500 } })
    ).toBe("clear");
  });

  it("dòng đã qua trưởng phòng: không tự đổi số, treo lại để chốt lại", () => {
    expect(
      staleResolutionAction({ ...base, row: { status: "MANAGER_REVIEWED", actualFinal: 500 } })
    ).toBe("flag");
    // Nguồn mới khớp nhau và đúng bằng số đã duyệt → không cần chốt lại
    expect(
      staleResolutionAction({
        ...base,
        nextValue: 500,
        row: { status: "MANAGER_REVIEWED", actualFinal: 500 },
      })
    ).toBe("none");
  });

  it("dòng đã khoá, nguồn không đổi, hoặc số chốt đã bị người khác sửa thì không đụng", () => {
    expect(
      staleResolutionAction({ ...base, row: { status: "FINALIZED", actualFinal: 500 } })
    ).toBe("none");
    expect(
      staleResolutionAction({
        ...base,
        sourcesChanged: false,
        row: { status: "SELF_REVIEWED", actualFinal: 500 },
      })
    ).toBe("none");
    expect(
      staleResolutionAction({ ...base, row: { status: "SELF_REVIEWED", actualFinal: 480 } })
    ).toBe("none");
    expect(
      staleResolutionAction({
        ...base,
        existing: { status: "MATCHED", resolvedValue: null },
        row: { status: "SELF_REVIEWED", actualFinal: 500 },
      })
    ).toBe("none");
  });

  it("ô đã treo lại (MISMATCH + số chốt cũ) thì vẫn treo, kể cả khi nguồn không đổi", () => {
    expect(
      staleResolutionAction({
        ...base,
        existing: { status: "MISMATCH", resolvedValue: 500 },
        sourcesChanged: false,
        row: { status: "MANAGER_REVIEWED", actualFinal: 500 },
      })
    ).toBe("flag");
  });

  it("quét hàng loạt: ô đã treo lại mà nguồn không đổi thì không ghi lại", () => {
    const feeds = [
      { value: 500, source: "EXTERNAL_API", sourceCode: "IPOS", createdAt: new Date(0) },
      { value: 505, source: "EXTERNAL_API", sourceCode: "CRM", createdAt: new Date(0) },
    ];
    const sources = latestSources(feeds, null);
    const stats = computeVariance(sources);
    const plan = planCell({
      row: {
        status: "MANAGER_REVIEWED",
        kpiDefinitionId: "d1",
        kpiDefinition: { id: "d1" },
        actualSelf: null,
        actualSystem: 500,
        actualFinal: 420,
      },
      feeds,
      existing: {
        status: "MISMATCH",
        sourcesJson: JSON.stringify(sources),
        ...stats,
        resolvedValue: 420,
      },
      priorities: new Map(),
    });
    expect(plan).toEqual({ action: "noop", outcome: "mismatched" });
  });
});
