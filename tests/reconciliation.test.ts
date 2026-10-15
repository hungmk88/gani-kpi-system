import { describe, expect, it } from "vitest";
import {
  computeVariance,
  latestSources,
  planCell,
  sourcesFingerprint,
  sourcesFingerprint as fp,
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
