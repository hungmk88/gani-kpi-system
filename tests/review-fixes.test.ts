import { describe, expect, it } from "vitest";
import { csrfDecision, isCsrfExempt } from "@/lib/csrf";
import { runBounded, TimeBudget } from "@/lib/time-budget";
import { sessionTtlSeconds } from "@/lib/auth";
import {
  buildBriefingMessage,
  clipText,
  TELEGRAM_SAFE_LENGTH,
  type BriefingForTelegram,
} from "@/lib/telegram";
import { decideTaskAccess } from "@/lib/task-access";
import { formatTaskCode } from "@/lib/codes";
import { privilegedImportAlert } from "@/lib/services/user-import-service";

/* ------------------------------------------------------------------ CSRF */

describe("csrfDecision", () => {
  const base = {
    pathname: "/api/tasks",
    origin: null as string | null,
    secFetchSite: null as string | null,
    hosts: ["kpi.ganifoody.vn"],
    appUrl: "https://kpi.ganifoody.vn",
  };

  it("GET/HEAD/OPTIONS luôn qua", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "get"]) {
      expect(csrfDecision({ ...base, method, origin: "https://evil.example" }).allowed).toBe(true);
    }
  });

  it("POST cùng origin (fetch trong app gửi Origin) thì qua", () => {
    expect(
      csrfDecision({ ...base, method: "POST", origin: "https://kpi.ganifoody.vn" }).allowed
    ).toBe(true);
  });

  it("đăng nhập từ chính app vẫn qua", () => {
    expect(
      csrfDecision({
        ...base,
        method: "POST",
        pathname: "/api/auth/login",
        origin: "https://kpi.ganifoody.vn",
        secFetchSite: "same-origin",
      }).allowed
    ).toBe(true);
  });

  it("Origin khớp Host dù APP_URL khác (preview Vercel)", () => {
    expect(
      csrfDecision({
        ...base,
        method: "PATCH",
        hosts: ["gani-kpi-git-abc.vercel.app"],
        origin: "https://gani-kpi-git-abc.vercel.app",
      }).allowed
    ).toBe(true);
  });

  it("Origin lạ thì chặn", () => {
    const d = csrfDecision({ ...base, method: "POST", origin: "https://evil.example" });
    expect(d.allowed).toBe(false);
  });

  it('Origin "null" thì chặn', () => {
    expect(csrfDecision({ ...base, method: "DELETE", origin: "null" }).allowed).toBe(false);
  });

  it("không Origin: dựa vào Sec-Fetch-Site", () => {
    expect(csrfDecision({ ...base, method: "POST", secFetchSite: "same-origin" }).allowed).toBe(true);
    expect(csrfDecision({ ...base, method: "POST", secFetchSite: "cross-site" }).allowed).toBe(false);
    expect(csrfDecision({ ...base, method: "POST", secFetchSite: "same-site" }).allowed).toBe(false);
  });

  it("không có cả hai header (curl, script) thì để route tự xác thực", () => {
    expect(csrfDecision({ ...base, method: "POST" }).allowed).toBe(true);
  });

  it("endpoint máy (secret/HMAC) được miễn kể cả Origin lạ", () => {
    for (const pathname of [
      "/api/telegram/webhook",
      "/api/integrations/ipos/webhook",
      "/api/cron/run",
    ]) {
      expect(isCsrfExempt(pathname)).toBe(true);
      expect(
        csrfDecision({ ...base, method: "POST", pathname, origin: "https://api.telegram.org" })
          .allowed
      ).toBe(true);
    }
    expect(isCsrfExempt("/api/telegram/link")).toBe(false);
    expect(isCsrfExempt("/api/integrations/ipos/webhook/extra")).toBe(false);
    expect(isCsrfExempt("/api/admin/integrations")).toBe(false);
  });
});

/* ------------------------------------------------------------ TIME BUDGET */

describe("TimeBudget / runBounded", () => {
  it("hết giờ theo đồng hồ giả", () => {
    let t = 1000;
    const b = TimeBudget.fromNow(500, () => t);
    expect(b.expired()).toBe(false);
    expect(b.expired(600)).toBe(true);
    t = 1500;
    expect(b.expired()).toBe(true);
    expect(TimeBudget.unlimited().expired(1e12)).toBe(false);
  });

  it("chạy song song tối đa `limit`, lỗi từng việc không làm hỏng cả lượt", async () => {
    let running = 0;
    let peak = 0;
    const res = await runBounded(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      3,
      async (n) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 2));
        running--;
        if (n === 4) throw new Error("hỏng");
      },
      { label: "test" }
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(res).toEqual({ done: 9, failed: 1, skipped: 0 });
  });

  it("hết ngân sách thì không mở việc mới", async () => {
    let t = 0;
    const budget = TimeBudget.fromNow(100, () => t);
    const seen: number[] = [];
    const res = await runBounded(
      [1, 2, 3, 4, 5],
      1,
      async (n) => {
        seen.push(n);
        t += 60; // mỗi việc "tốn" 60ms
      },
      { budget, label: "test" }
    );
    expect(seen).toEqual([1, 2]);
    expect(res.skipped).toBe(3);
  });
});

/* ------------------------------------------------------------ SESSION TTL */

describe("sessionTtlSeconds", () => {
  it("một nguồn cho JWT và cookie, mặc định 12h", () => {
    expect(sessionTtlSeconds(undefined)).toBe(12 * 3600);
    expect(sessionTtlSeconds("")).toBe(12 * 3600);
    expect(sessionTtlSeconds("12h")).toBe(12 * 3600);
    expect(sessionTtlSeconds("30m")).toBe(1800);
    expect(sessionTtlSeconds("1d")).toBe(86400);
    expect(sessionTtlSeconds("3600")).toBe(3600);
    expect(sessionTtlSeconds("2 weeks")).toBe(12 * 3600);
    expect(sessionTtlSeconds("0h")).toBe(12 * 3600);
  });
});

/* ------------------------------------------------------- TELEGRAM BRIEFING */

describe("buildBriefingMessage", () => {
  const huge = (s: string, n: number) => s.repeat(n);
  const briefing: BriefingForTelegram = {
    healthScore: 42,
    healthLabel: "Cần chú ý",
    executiveSummary: huge("Doanh số giảm & chi phí <tăng> ", 400),
    keyRisks: Array.from({ length: 8 }, (_, i) => ({
      area: `Phòng <${i}> & co`,
      riskLevel: "CRITICAL" as const,
      impact: huge("ảnh hưởng & rủi ro <b> ", 60),
    })),
    recommendations: Array.from({ length: 8 }, () => huge("làm ngay & đúng hạn ", 60)),
    engine: "GEMINI",
  };
  const opts = {
    url: "https://kpi.ganifoody.vn/analytics",
    generatedAt: new Date("2026-10-05T03:00:00Z"),
  };

  it("bản HTML luôn dưới giới hạn và không cắt ngang entity/thẻ", () => {
    const msg = buildBriefingMessage(briefing, "Tháng 09/2026", { ...opts, html: true });
    expect(msg.length).toBeLessThanOrEqual(TELEGRAM_SAFE_LENGTH);
    // Mọi dấu & phải là đầu một entity hoàn chỉnh
    expect(msg.match(/&(?!amp;|lt;|gt;|quot;)/g)).toBeNull();
    // Thẻ mở/đóng cân bằng
    for (const tag of ["b", "i", "a"]) {
      const open = (msg.match(new RegExp(`<${tag}[ >]`, "g")) ?? []).length;
      const close = (msg.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
      expect(open).toBe(close);
    }
    // Không còn ký tự < > thô từ dữ liệu
    expect(msg).not.toContain("<tăng>");
  });

  it("bản chữ thường không có thẻ HTML", () => {
    const msg = buildBriefingMessage(briefing, "Tháng 09/2026", { ...opts, html: false });
    expect(msg.length).toBeLessThanOrEqual(TELEGRAM_SAFE_LENGTH);
    // Không có thẻ do hệ thống gắn (dữ liệu thô "<b>" thì giữ nguyên chữ)
    expect(msg).not.toContain("<b>BÁO CÁO");
    expect(msg).not.toContain("<a href");
    expect(msg).not.toContain("&amp;");
    expect(msg).toContain(opts.url);
  });

  it("tin ngắn giữ nguyên đủ nội dung", () => {
    const small: BriefingForTelegram = {
      ...briefing,
      executiveSummary: "Ổn định.",
      keyRisks: [{ area: "Kho", riskLevel: "HIGH", impact: "Tồn cao" }],
      recommendations: ["Giảm nhập"],
    };
    const msg = buildBriefingMessage(small, "Tháng 09/2026", { ...opts, html: true });
    expect(msg).toContain("Ổn định.");
    expect(msg).toContain("Tồn cao");
    expect(msg).toContain("1. Giảm nhập");
    expect(msg).not.toContain("còn nữa");
  });

  it("clipText không bẻ đôi emoji", () => {
    expect(clipText("😀😀😀", 2)).toBe("😀…");
    expect(clipText("abc", 5)).toBe("abc");
  });
});

/* ------------------------------------------------------------- TASK ACCESS */

describe("decideTaskAccess", () => {
  const task = { assigneeId: "emp1", creatorId: "mgrA", departmentId: "deptA" };
  const u = (id: string, role: string, departmentId: string | null) => ({ id, role, departmentId });

  it("CEO / trưởng phòng cùng phòng / người làm: được sửa", () => {
    expect(decideTaskAccess(task, u("ceo", "CEO", null), false)).toBe("EDIT");
    expect(decideTaskAccess(task, u("mgrA2", "MANAGER", "deptA"), false)).toBe("EDIT");
    expect(decideTaskAccess(task, u("emp1", "EMPLOYEE", "deptA"), false)).toBe("EDIT");
  });

  it("người gửi yêu cầu liên phòng ban: chỉ xem + trao đổi", () => {
    expect(decideTaskAccess(task, u("mgrB", "MANAGER", "deptB"), true)).toBe("COMMENT");
    expect(decideTaskAccess(task, u("mgrB", "MANAGER", "deptB"), false)).toBe("NONE");
  });

  it("ADMIN chỉ xem, không trao đổi", () => {
    expect(decideTaskAccess(task, u("adm", "ADMIN", null), false)).toBe("VIEW");
  });

  it("nhân viên không liên quan / phòng khác: không thấy", () => {
    expect(decideTaskAccess(task, u("emp2", "EMPLOYEE", "deptA"), false)).toBe("NONE");
    expect(decideTaskAccess(task, u("mgrB", "MANAGER", "deptB"), false)).toBe("NONE");
    // Không phòng ban không được coi là "cùng phòng" với task không phòng ban
    expect(
      decideTaskAccess({ ...task, departmentId: "" }, u("m", "MANAGER", null), false)
    ).toBe("NONE");
  });
});

/* ---------------------------------------------------------------- MÃ TASK */

describe("formatTaskCode", () => {
  it("tối thiểu 4 chữ số, quá 9.999 thì dài ra", () => {
    expect(formatTaskCode("TASK-2026-", 1)).toBe("TASK-2026-0001");
    expect(formatTaskCode("TASK-2026-", 9999)).toBe("TASK-2026-9999");
    expect(formatTaskCode("TASK-2026-", 10000)).toBe("TASK-2026-10000");
  });
});

/* ------------------------------------------------- BÁO ĐỘNG NẠP NHÂN SỰ */

describe("privilegedImportAlert", () => {
  it("không có trưởng phòng / vai trò xưởng thì không báo", () => {
    expect(
      privilegedImportAlert([{ email: "a@x.vn", role: "EMPLOYEE", productionRole: null }], "adm@x.vn")
    ).toBeNull();
  });

  it("một tin tóm tắt cho cả lần nạp", () => {
    const a = privilegedImportAlert(
      [
        { email: "m@x.vn", role: "MANAGER", productionRole: null },
        { email: "k@x.vn", role: "EMPLOYEE", productionRole: "QC" },
        { email: "e@x.vn", role: "EMPLOYEE", productionRole: null },
      ],
      "adm@x.vn"
    );
    expect(a).not.toBeNull();
    expect(a!.title).toContain("(2)");
    expect(a!.body).toContain("m@x.vn");
    expect(a!.body).toContain("k@x.vn (QC)");
    expect(a!.body).not.toContain("e@x.vn");
    expect(a!.body).toContain("adm@x.vn");
  });
});
