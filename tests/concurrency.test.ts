import { describe, expect, it, vi } from "vitest";
import { forEachLimit } from "@/lib/concurrency";

describe("forEachLimit — gửi thông báo song song có giới hạn", () => {
  it("không bao giờ chạy quá `limit` việc cùng lúc và chạy đủ mọi phần tử", async () => {
    let running = 0;
    let peak = 0;
    const seen: number[] = [];
    await forEachLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 2));
      seen.push(n);
      running--;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("lỗi của một phần tử không làm hỏng cả lượt", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const done: number[] = [];
    const res = await forEachLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("Telegram chậm");
      done.push(n);
    });
    spy.mockRestore();
    expect(res.failed).toBe(1);
    expect(done.sort()).toEqual([1, 3]);
  });

  it("danh sách rỗng thì xong ngay", async () => {
    expect(await forEachLimit([], 5, async () => {})).toEqual({ failed: 0 });
  });
});
