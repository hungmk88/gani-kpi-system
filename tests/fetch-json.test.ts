import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NETWORK_ERROR_MESSAGE,
  fetchJson,
  jsonInit,
  parseJsonBody,
  statusMessage,
  toResult,
} from "@/lib/fetch-json";

describe("fetch-json: ánh xạ mã HTTP", () => {
  it("các mã hay gặp có thông báo riêng", () => {
    expect(statusMessage(0)).toBe(NETWORK_ERROR_MESSAGE);
    expect(statusMessage(401)).toMatch(/hết hạn/);
    expect(statusMessage(403)).toMatch(/không có quyền/);
    expect(statusMessage(413)).toMatch(/^File quá lớn/);
    expect(statusMessage(429)).toMatch(/quá nhanh/);
    expect(statusMessage(502)).toMatch(/^Máy chủ xử lý quá lâu/);
    expect(statusMessage(504)).toMatch(/^Máy chủ xử lý quá lâu/);
    expect(statusMessage(500)).toMatch(/Lỗi hệ thống/);
    expect(statusMessage(418)).toContain("418");
  });

  it("body không phải JSON không làm nổ", () => {
    expect(parseJsonBody("")).toEqual({});
    expect(parseJsonBody("<html>413 Request Entity Too Large</html>")).toEqual({});
    expect(parseJsonBody('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonBody("[1,2]")).toEqual({ value: [1, 2] });
  });

  it("ưu tiên message của server, thiếu thì theo mã HTTP", () => {
    expect(toResult(422, { message: "Hạn chót không hợp lệ." }).message).toBe(
      "Hạn chót không hợp lệ."
    );
    expect(toResult(413, {}).message).toMatch(/^File quá lớn/);
    expect(toResult(504, { message: "  " }).message).toMatch(/^Máy chủ xử lý quá lâu/);
    const okRes = toResult(201, { id: "x", message: "đã tạo" });
    expect(okRes).toEqual({ ok: true, status: 201, data: { id: "x", message: "đã tạo" }, message: null });
  });

  it("jsonInit đặt Content-Type khi có body", () => {
    expect(jsonInit("DELETE")).toEqual({ method: "DELETE" });
    const i = jsonInit("POST", { a: 1 });
    expect(i.body).toBe('{"a":1}');
    expect((i.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });
});

describe("fetchJson", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mất mạng → status 0, không throw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const r = await fetchJson("/api/x");
    expect(r).toEqual({ ok: false, status: 0, data: {}, message: NETWORK_ERROR_MESSAGE });
  });

  it("trang lỗi HTML của proxy → thông báo theo mã", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>Gateway Timeout</html>", { status: 504 }))
    );
    const r = await fetchJson("/api/x");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(504);
    expect(r.message).toMatch(/^Máy chủ xử lý quá lâu/);
  });

  it("JSON thành công", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"done":3}', { status: 200 }))
    );
    const r = await fetchJson<{ done: number }>("/api/x");
    expect(r.ok).toBe(true);
    expect(r.data.done).toBe(3);
    expect(r.message).toBeNull();
  });
});
