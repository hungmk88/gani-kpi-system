import { describe, expect, it } from "vitest";
import { parseAiDueDate } from "@/lib/ai/task-parser";

const iso = (s: string) => parseAiDueDate(s)?.toISOString() ?? null;

describe("đọc hạn chót AI trả về", () => {
  it("không có múi giờ → hiểu là giờ Việt Nam (không theo giờ server)", () => {
    expect(iso("2026-10-20T17:00")).toBe("2026-10-20T10:00:00.000Z");
    expect(iso("2026-10-20T17:00:00")).toBe("2026-10-20T10:00:00.000Z");
    expect(iso("2026-10-20 09:30:15")).toBe("2026-10-20T02:30:15.000Z");
    expect(iso("2026-10-20T17:00:00.250")).toBe("2026-10-20T10:00:00.250Z");
    // 06:00 VN vẫn là ngày hôm trước theo UTC
    expect(iso("2026-10-21T06:00")).toBe("2026-10-20T23:00:00.000Z");
  });

  it("chỉ có ngày → 17:00 giờ VN ngày đó", () => {
    expect(iso("2026-10-20")).toBe("2026-10-20T10:00:00.000Z");
  });

  it("có múi giờ thì giữ nguyên thời điểm", () => {
    expect(iso("2026-10-20T17:00:00+07:00")).toBe("2026-10-20T10:00:00.000Z");
    expect(iso("2026-10-20T17:00:00+0700")).toBe("2026-10-20T10:00:00.000Z");
    expect(iso("2026-10-20T17:00+07")).toBe("2026-10-20T10:00:00.000Z");
    expect(iso("2026-10-20T10:00:00Z")).toBe("2026-10-20T10:00:00.000Z");
    expect(iso("2026-10-20T10:00:00.000z")).toBe("2026-10-20T10:00:00.000Z");
    expect(iso("2026-10-20T17:00:00-05:00")).toBe("2026-10-20T22:00:00.000Z");
  });

  it("bỏ khoảng trắng hai đầu", () => {
    expect(iso("  2026-10-20T17:00  ")).toBe("2026-10-20T10:00:00.000Z");
  });

  it("ngày giờ không có thật hoặc sai dạng → null, không đoán", () => {
    expect(iso("")).toBeNull();
    expect(iso("CẦN XÁC NHẬN")).toBeNull();
    expect(iso("2026-02-30T10:00")).toBeNull();
    expect(iso("2026-13-01")).toBeNull();
    expect(iso("2026-10-20T25:00")).toBeNull();
    expect(iso("2026-10-20T10:61:00+07:00")).toBeNull();
    expect(iso("20/10/2026 17:00")).toBeNull();
    expect(iso("tomorrow")).toBeNull();
  });

  it("29/02 chỉ hợp lệ ở năm nhuận", () => {
    expect(iso("2028-02-29T08:00")).toBe("2028-02-29T01:00:00.000Z");
    expect(iso("2027-02-29T08:00")).toBeNull();
  });
});
