import { describe, expect, it } from "vitest";
import { urgencyTone } from "@/lib/urgency";

describe("urgencyTone — màu theo thời gian còn lại", () => {
  const now = new Date("2026-10-15T09:00:00Z");
  const inHours = (h: number) => new Date(now.getTime() + h * 3_600_000);

  it("còn 18 ngày → trung tính, không đỏ", () => {
    expect(urgencyTone(inHours(18 * 24), now)).toBe("brand");
  });
  it("còn 2 ngày → vàng", () => {
    expect(urgencyTone(inHours(48), now)).toBe("amber");
  });
  it("còn dưới 24 giờ → đỏ", () => {
    expect(urgencyTone(inHours(5), now)).toBe("red");
  });
  it("đã quá hạn → đỏ", () => {
    expect(urgencyTone(inHours(-3), now)).toBe("red");
  });
});
