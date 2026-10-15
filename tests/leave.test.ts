import { describe, expect, it } from "vitest";
import { allocateLeaveDays, leaveDaysBetween } from "@/lib/services/leave-service";
import { parseVnDate } from "@/lib/vn-time";

const d = (s: string) => parseVnDate(s);

describe("ngày phép", () => {
  it("nghỉ 1 ngày tính là 1 (trước đây ra 0)", () => {
    expect(leaveDaysBetween(d("2026-10-16"), d("2026-10-16"))).toBe(1);
    expect(leaveDaysBetween(d("2026-10-16"), d("2026-10-18"))).toBe(3);
  });

  it("đơn vắt qua hai nửa năm được tách đúng", () => {
    const a = allocateLeaveDays(d("2026-06-29"), d("2026-07-03"));
    expect(a.total).toBe(5);
    expect(a.byHalf.get("2026-H1")).toBe(2);
    expect(a.byHalf.get("2026-H2")).toBe(3);
  });

  it("đơn vắt qua năm mới được tách theo năm", () => {
    const a = allocateLeaveDays(d("2026-12-30"), d("2027-01-02"));
    expect(a.byYear.get(2026)).toBe(2);
    expect(a.byYear.get(2027)).toBe(2);
  });
});
