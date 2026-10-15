import { describe, expect, it } from "vitest";
import { sourcesFingerprint } from "@/lib/services/reconciliation-service";

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
