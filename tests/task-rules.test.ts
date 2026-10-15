import { describe, expect, it } from "vitest";
import { isValidReason, reasonRequiredFor } from "@/lib/task-rules";

describe("reasonRequiredFor — đổi trạng thái nào phải ghi lý do", () => {
  it("báo tắc từ bất kỳ trạng thái nào", () => {
    expect(reasonRequiredFor("TO_DO", "BLOCKED")).toBe("BLOCK");
    expect(reasonRequiredFor("IN_PROGRESS", "BLOCKED")).toBe("BLOCK");
    expect(reasonRequiredFor("REVIEW", "BLOCKED")).toBe("BLOCK");
  });

  it("mở lại việc đã nghiệm thu / đã huỷ", () => {
    expect(reasonRequiredFor("DONE", "IN_PROGRESS")).toBe("REOPEN");
    expect(reasonRequiredFor("CANCELLED", "TO_DO")).toBe("REOPEN");
  });

  it("trả việc chờ duyệt về làm lại", () => {
    expect(reasonRequiredFor("REVIEW", "IN_PROGRESS")).toBe("REOPEN");
    expect(reasonRequiredFor("REVIEW", "TO_DO")).toBe("REOPEN");
  });

  it("các bước thường không cần lý do", () => {
    expect(reasonRequiredFor("TO_DO", "IN_PROGRESS")).toBeNull();
    expect(reasonRequiredFor("IN_PROGRESS", "REVIEW")).toBeNull();
    expect(reasonRequiredFor("REVIEW", "DONE")).toBeNull();
    expect(reasonRequiredFor("BLOCKED", "IN_PROGRESS")).toBeNull();
    // Gửi lại đúng trạng thái cũ không phải là đổi
    expect(reasonRequiredFor("BLOCKED", "BLOCKED")).toBeNull();
  });
});

describe("isValidReason", () => {
  it("tính sau khi bỏ khoảng trắng hai đầu, tối thiểu 5 ký tự", () => {
    expect(isValidReason(undefined)).toBe(false);
    expect(isValidReason("   abc   ")).toBe(false);
    expect(isValidReason(" chờ NVL ")).toBe(true);
  });
});
