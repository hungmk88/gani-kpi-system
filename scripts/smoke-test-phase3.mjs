/**
 * KIỂM THỬ NGHIỆP VỤ PHASE 3 — INTEGRATION & AUTOMATION
 *
 * Chạy khi server đang bật:  npm run test:phase3
 *
 * Bám bảng test case Phase 3 trong tài liệu thiết kế, cộng thêm phần bảo mật mà
 * thiết kế gốc bỏ trống:
 *   1. Chữ ký webhook  — ký đúng thì vào, sai/thiếu/phát lại thì chặn
 *   2. Đối soát        — khớp thì tự đồng bộ, lệch thì TREO chứ không tự chọn
 *   3. Chốt số lệch    — bắt buộc có lý do, ghi tên người chốt vào nhật ký
 *   4. Khoá dữ liệu    — kỳ đã chốt thì webhook không đụng vào được
 *   5. Bot Telegram    — sai khoá webhook bị chặn, sai vai trò không duyệt được
 *   6. Nối tài khoản   — mã dùng một lần, hết hạn thì thôi
 */
import { assertLocalTarget } from "./lib/local-guard.mjs";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

try {
  process.loadEnvFile(".env");
} catch {
  /* dùng biến môi trường sẵn có */
}

const BASE = process.env.APP_URL || "http://localhost:3000";
const PASSWORD = process.env.SMOKE_PASSWORD || "Gani@2026";
assertLocalTarget({ appUrl: BASE });
const TEST_STARTED_AT = new Date();
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;

function check(name, condition, detail = "") {
  if (condition) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? `\n       ${detail}` : ""}`);
  }
}

async function login(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Đăng nhập ${email} thất bại: ${res.status}`);
  return (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
}

function api(cookie) {
  return async (path, options = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        cookie,
        ...(options.headers ?? {}),
      },
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  };
}

/** Ký y hệt cách lib/integrations/signature.ts quy định — kiểm tra chéo hợp đồng. */
function sign(rawBody, tsSeconds, secret) {
  const mac = crypto.createHmac("sha256", secret);
  mac.update(`${tsSeconds}.${rawBody}`, "utf8");
  return `sha256=${mac.digest("hex")}`;
}

async function postWebhook(sourceCode, items, secret, opts = {}) {
  const rawBody = JSON.stringify(items);
  const ts = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const headers = { "Content-Type": "application/json" };
  if (!opts.omitTimestamp) headers["X-Timestamp"] = String(ts);
  if (!opts.omitSignature) {
    headers["X-Signature"] = opts.badSignature
      ? "sha256=" + "0".repeat(64)
      : sign(rawBody, ts, secret);
  }
  const res = await fetch(`${BASE}/api/integrations/${sourceCode}/webhook`, {
    method: "POST",
    headers,
    body: rawBody,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function postTelegram(update, secret) {
  const headers = { "Content-Type": "application/json" };
  if (secret !== null) headers["X-Telegram-Bot-Api-Secret-Token"] = secret;
  const res = await fetch(`${BASE}/api/telegram/webhook`, {
    method: "POST",
    headers,
    body: JSON.stringify(update),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

const CLEANUP = { sourceIds: [], userIds: [] };

async function main() {
  console.log(`\n🔬 KIỂM THỬ PHASE 3 — ${BASE}\n`);

  for (let i = 0; i < 30; i++) {
    try {
      await fetch(`${BASE}/login`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const ceoCookie = await login("ceo@ganifoody.vn");
  const ceo = api(ceoCookie);
  const salesMgr = api(await login("tp.sales@ganifoody.vn"));
  const salesEmp = api(await login("nv.sales1@ganifoody.vn"));

  const hong = await prisma.user.findUnique({
    where: { email: "nv.sales1@ganifoody.vn" },
  });
  const ceoUser = await prisma.user.findUnique({
    where: { email: "ceo@ganifoody.vn" },
  });
  const period = await prisma.kpiPeriod.findFirst({
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  /* ---------------------------------------------------------------- TEST 1 */
  console.log("TEST 1 — Chữ ký webhook HMAC SHA256");

  const created = await ceo("/api/admin/integrations", {
    method: "POST",
    body: JSON.stringify({
      code: "test-ipos",
      name: "iPOS kiểm thử",
      kind: "IPOS",
      priority: 5,
    }),
  });
  check(
    "Tạo được nguồn tích hợp và nhận về khoá bí mật",
    created.status === 201 && !!created.body?.secret,
    `HTTP ${created.status} ${JSON.stringify(created.body).slice(0, 150)}`
  );
  const secret = created.body?.secret;
  const sourceId = created.body?.source?.id;
  if (sourceId) CLEANUP.sourceIds.push(sourceId);

  check(
    "Khoá bí mật KHÔNG bị lộ ra trong đối tượng nguồn trả về",
    created.body?.source?.secret === undefined,
    `source.secret = ${created.body?.source?.secret}`
  );

  const payload = [
    {
      kpiCode: "SALES_REV",
      employeeEmail: "nv.sales1@ganifoody.vn",
      month: period.month,
      year: period.year,
      value: 500_000_000,
    },
  ];

  const noSig = await postWebhook("test-ipos", payload, secret, {
    omitSignature: true,
  });
  check(
    "Thiếu chữ ký thì bị chặn 401",
    noSig.status === 401,
    `HTTP ${noSig.status} ${noSig.body?.message}`
  );

  const badSig = await postWebhook("test-ipos", payload, secret, {
    badSignature: true,
  });
  check(
    "Chữ ký sai thì bị chặn 401",
    badSig.status === 401,
    `HTTP ${badSig.status} ${badSig.body?.message}`
  );

  const noTs = await postWebhook("test-ipos", payload, secret, {
    omitTimestamp: true,
  });
  check(
    "Thiếu dấu thời gian thì bị chặn 401",
    noTs.status === 401,
    `HTTP ${noTs.status}`
  );

  const replay = await postWebhook("test-ipos", payload, secret, {
    timestamp: Math.floor(Date.now() / 1000) - 3600,
  });
  check(
    "Gói tin cũ 1 tiếng (phát lại) bị chặn 401",
    replay.status === 401 && /thời gian/i.test(replay.body?.message ?? ""),
    `HTTP ${replay.status} ${replay.body?.message}`
  );

  const unknown = await postWebhook("khong-ton-tai", payload, secret);
  check(
    "Gọi vào nguồn chưa đăng ký thì trả 404",
    unknown.status === 404,
    `HTTP ${unknown.status}`
  );

  const good = await postWebhook("test-ipos", payload, secret);
  check(
    "Ký đúng thì nhận dữ liệu thành công",
    good.status === 200 && good.body?.applied === 1,
    `HTTP ${good.status} ${JSON.stringify(good.body).slice(0, 200)}`
  );

  const logs = await prisma.webhookLog.findMany({
    where: { sourceCode: "test-ipos" },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  check(
    "Mọi lần gọi đều được ghi nhật ký, kể cả lần bị chặn",
    logs.length >= 5 && logs.some((l) => !l.signatureOk),
    `số bản ghi: ${logs.length}, có bản ghi bị chặn: ${logs.some((l) => !l.signatureOk)}`
  );

  /* ---------------------------------------------------------------- TEST 2 */
  console.log("\nTEST 2 — Đối soát: khớp thì đồng bộ, lệch thì treo");

  const def = await prisma.kpiDefinition.findUnique({
    where: { code: "SALES_REV" },
  });
  const cell = await prisma.kpiResult.findUnique({
    where: {
      periodId_employeeId_kpiDefinitionId: {
        periodId: period.id,
        employeeId: hong.id,
        kpiDefinitionId: def.id,
      },
    },
  });

  // Dọn số cũ để bài thử bắt đầu từ nền sạch
  await prisma.kpiActualFeed.deleteMany({
    where: { employeeEmail: hong.email, kpiDefinitionId: def.id },
  });
  await prisma.reconciliation.deleteMany({
    where: { employeeId: hong.id, kpiDefinitionId: def.id },
  });
  await prisma.kpiResult.update({
    where: { id: cell.id },
    data: { actualSystem: null, actualSelf: null, actualFinal: null },
  });

  // --- 2a. Hai nguồn lệch 1% -> coi như khớp ---
  const crm = await ceo("/api/admin/integrations", {
    method: "POST",
    body: JSON.stringify({
      code: "test-crm",
      name: "CRM kiểm thử",
      kind: "CRM",
      priority: 20,
    }),
  });
  const crmSecret = crm.body?.secret;
  if (crm.body?.source?.id) CLEANUP.sourceIds.push(crm.body.source.id);

  await postWebhook("test-ipos", payload, secret); // 500tr
  await postWebhook(
    "test-crm",
    [{ ...payload[0], value: 495_000_000 }],
    crmSecret
  ); // 495tr, lệch 1%

  const afterMatch = await prisma.kpiResult.findUnique({
    where: { id: cell.id },
  });
  const recMatch = await prisma.reconciliation.findUnique({
    where: {
      periodId_employeeId_kpiDefinitionId: {
        periodId: period.id,
        employeeId: hong.id,
        kpiDefinitionId: def.id,
      },
    },
  });
  check(
    "iPOS 500tr vs CRM 495tr (lệch 1%) → đánh dấu KHỚP",
    recMatch?.status === "MATCHED" && recMatch.variancePercent <= 5,
    `status=${recMatch?.status}, lệch=${recMatch?.variancePercent}%`
  );
  check(
    "Khớp thì tự đồng bộ vào Số hệ thống, lấy nguồn tin cậy hơn (iPOS)",
    afterMatch?.actualSystem === 500_000_000,
    `actualSystem = ${afterMatch?.actualSystem}`
  );

  // --- 2b. Nguồn thứ ba lệch xa -> treo lại ---
  await postWebhook(
    "test-crm",
    [{ ...payload[0], value: 420_000_000 }],
    crmSecret
  ); // lệch 16%

  const afterMismatch = await prisma.kpiResult.findUnique({
    where: { id: cell.id },
  });
  const recMismatch = await prisma.reconciliation.findUnique({
    where: {
      periodId_employeeId_kpiDefinitionId: {
        periodId: period.id,
        employeeId: hong.id,
        kpiDefinitionId: def.id,
      },
    },
  });
  check(
    "iPOS 500tr vs CRM 420tr (lệch 16%) → đánh dấu LỆCH",
    recMismatch?.status === "MISMATCH" && recMismatch.variancePercent > 5,
    `status=${recMismatch?.status}, lệch=${recMismatch?.variancePercent}%`
  );
  check(
    "LỆCH thì hệ thống KHÔNG tự chọn số nào — giữ nguyên số cũ, không đè bừa",
    afterMismatch?.actualSystem === 500_000_000,
    `actualSystem = ${afterMismatch?.actualSystem} (phải giữ nguyên 500tr chứ không nhảy sang 420tr)`
  );

  const sourcesJson = JSON.parse(recMismatch?.sourcesJson ?? "[]");
  check(
    "Lưu đủ số của từng nguồn để người quyết nhìn được cả hai bên",
    sourcesJson.length >= 2 &&
      sourcesJson.some((s) => s.value === 500_000_000) &&
      sourcesJson.some((s) => s.value === 420_000_000),
    JSON.stringify(sourcesJson)
  );

  /* ---------------------------------------------------------------- TEST 3 */
  console.log("\nTEST 3 — Chốt số khi các nguồn đá nhau");

  const noReason = await ceo(`/api/reconciliation/${recMismatch.id}`, {
    method: "POST",
    body: JSON.stringify({
      value: 500_000_000,
      sourceCode: "test-ipos",
      reason: "ok",
    }),
  });
  check(
    "Chốt số mà lý do quá ngắn thì bị từ chối",
    noReason.status === 422 || noReason.status === 400,
    `HTTP ${noReason.status}`
  );

  const empResolve = await salesEmp(`/api/reconciliation/${recMismatch.id}`, {
    method: "POST",
    body: JSON.stringify({
      value: 500_000_000,
      sourceCode: "test-ipos",
      reason: "Nhân viên tự chốt số của chính mình",
    }),
  });
  check(
    "Nhân viên không tự chốt được số liệu của mình",
    empResolve.status === 403,
    `HTTP ${empResolve.status}`
  );

  const auditBefore = await prisma.auditLog.count({
    where: { action: "RECONCILIATION_RESOLVE" },
  });
  const resolved = await ceo(`/api/reconciliation/${recMismatch.id}`, {
    method: "POST",
    body: JSON.stringify({
      value: 500_000_000,
      sourceCode: "test-ipos",
      reason: "Đã đối chiếu hoá đơn giấy với kế toán, số iPOS mới là số đúng",
    }),
  });
  check(
    "Ban Giám đốc chốt được khi có lý do rõ ràng",
    resolved.status === 200,
    `HTTP ${resolved.status} ${JSON.stringify(resolved.body).slice(0, 150)}`
  );

  const recAfter = await prisma.reconciliation.findUnique({
    where: { id: recMismatch.id },
  });
  check(
    "Bản đối soát chuyển sang ĐÃ CHỐT và ghi tên người chốt",
    recAfter?.status === "RESOLVED" && recAfter.resolvedById === ceoUser.id,
    `status=${recAfter?.status}, resolvedById=${recAfter?.resolvedById}`
  );

  const auditAfter = await prisma.auditLog.count({
    where: { action: "RECONCILIATION_RESOLVE" },
  });
  check(
    "Sinh bản ghi nhật ký cho lần chốt này",
    auditAfter === auditBefore + 1,
    `trước ${auditBefore}, sau ${auditAfter}`
  );

  /* ---------------------------------------------------------------- TEST 4 */
  console.log("\nTEST 4 — An toàn khoá dữ liệu");

  const lockCell = await prisma.kpiResult.findFirst({
    where: { periodId: period.id, employeeId: hong.id, id: { not: cell.id } },
    include: { kpiDefinition: true },
  });
  await prisma.kpiResult.update({
    where: { id: lockCell.id },
    data: { status: "FINALIZED", actualFinal: 123, finalizedAt: new Date() },
  });

  const afterLock = await postWebhook(
    "test-ipos",
    [
      {
        kpiCode: lockCell.kpiDefinition.code,
        employeeEmail: hong.email,
        month: period.month,
        year: period.year,
        value: 999_999,
      },
    ],
    secret
  );
  const lockedRow = await prisma.kpiResult.findUnique({
    where: { id: lockCell.id },
  });
  check(
    "Dòng KPI đã chốt thì webhook không ghi đè được",
    lockedRow?.actualFinal === 123 &&
      /đã chốt/i.test((afterLock.body?.errors ?? []).join(" ")),
    `actualFinal=${lockedRow?.actualFinal}, errors=${JSON.stringify(afterLock.body?.errors)}`
  );

  const rawKept = await prisma.kpiActualFeed.findFirst({
    where: {
      kpiDefinitionId: lockCell.kpiDefinitionId,
      employeeEmail: hong.email,
      value: 999_999,
    },
  });
  check(
    "Nhưng dữ liệu thô vẫn được lưu lại để sau này tra cứu",
    !!rawKept,
    "không tìm thấy bản ghi thô"
  );

  await prisma.kpiResult.update({
    where: { id: lockCell.id },
    data: { status: "DRAFT", actualFinal: null, finalizedAt: null },
  });

  // Nguồn bị tạm ngưng thì chặn luôn
  await ceo(`/api/admin/integrations?id=${sourceId}`, {
    method: "PATCH",
    body: JSON.stringify({ isActive: false }),
  });
  const paused = await postWebhook("test-ipos", payload, secret);
  check(
    "Nguồn bị tạm ngưng thì webhook bị chặn 403",
    paused.status === 403,
    `HTTP ${paused.status}`
  );
  await ceo(`/api/admin/integrations?id=${sourceId}`, {
    method: "PATCH",
    body: JSON.stringify({ isActive: true }),
  });

  // Đổi khoá thì khoá cũ chết ngay
  const rotated = await ceo(`/api/admin/integrations?id=${sourceId}`, {
    method: "PATCH",
    body: JSON.stringify({ rotateSecret: true }),
  });
  const oldKey = await postWebhook("test-ipos", payload, secret);
  check(
    "Đổi khoá xong thì khoá cũ hết hiệu lực ngay",
    oldKey.status === 401 && !!rotated.body?.secret,
    `HTTP ${oldKey.status}`
  );
  const newKey = await postWebhook("test-ipos", payload, rotated.body.secret);
  check(
    "Khoá mới dùng được ngay",
    newKey.status === 200,
    `HTTP ${newKey.status}`
  );

  /* ---------------------------------------------------------------- TEST 5 */
  console.log("\nTEST 5 — Bot Telegram: chặn giả mạo, chặn sai vai trò");

  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  check(
    "Đã sinh sẵn khoá bí mật cho webhook Telegram",
    !!webhookSecret,
    "TELEGRAM_WEBHOOK_SECRET đang trống"
  );

  const noSecret = await postTelegram({ message: { text: "/start" } }, null);
  check(
    "Gói tin không có khoá bí mật bị chặn 401",
    noSecret.status === 401,
    `HTTP ${noSecret.status}`
  );

  const wrongSecret = await postTelegram(
    { message: { text: "/start" } },
    "khoa-gia-mao"
  );
  check(
    "Gói tin sai khoá bí mật bị chặn 401",
    wrongSecret.status === 401,
    `HTTP ${wrongSecret.status}`
  );

  // Gắn tạm chat id để thử phân quyền
  const FAKE_CEO_CHAT = "900000001";
  const FAKE_EMP_CHAT = "900000002";
  await prisma.user.update({
    where: { id: ceoUser.id },
    data: { telegramChatId: FAKE_CEO_CHAT },
  });
  await prisma.user.update({
    where: { id: hong.id },
    data: { telegramChatId: FAKE_EMP_CHAT },
  });
  CLEANUP.userIds.push(ceoUser.id, hong.id);

  // Dựng một dòng KPI để thử duyệt
  const approvalRow = await prisma.kpiResult.findFirst({
    where: {
      periodId: period.id,
      employeeId: hong.id,
      status: { not: "FINALIZED" },
    },
  });
  await prisma.kpiResult.update({
    where: { id: approvalRow.id },
    data: { status: "MANAGER_REVIEWED", actualFinal: 100 },
  });

  // Người lạ chưa nối tài khoản
  const stranger = await postTelegram(
    {
      callback_query: {
        id: "cb1",
        data: `KPI_APPROVE:${approvalRow.id}`,
        from: { id: 777777777, first_name: "Người lạ" },
        message: { chat: { id: 777777777, type: "private" }, message_id: 1, text: "x" },
      },
    },
    webhookSecret
  );
  const afterStranger = await prisma.kpiResult.findUnique({
    where: { id: approvalRow.id },
  });
  check(
    "Người chưa nối tài khoản bấm duyệt → bị từ chối, KPI không đổi",
    stranger.body?.denied === true && afterStranger.status !== "FINALIZED",
    `denied=${stranger.body?.denied}, status=${afterStranger.status}`
  );

  // Nhân viên bấm duyệt KPI của chính mình
  const empApprove = await postTelegram(
    {
      callback_query: {
        id: "cb2",
        data: `KPI_APPROVE:${approvalRow.id}`,
        from: { id: Number(FAKE_EMP_CHAT), first_name: "Hồng" },
        message: { chat: { id: Number(FAKE_EMP_CHAT), type: "private" }, message_id: 2, text: "x" },
      },
    },
    webhookSecret
  );
  const afterEmp = await prisma.kpiResult.findUnique({
    where: { id: approvalRow.id },
  });
  check(
    "Nhân viên bấm duyệt KPI của chính mình → bị chặn vì sai vai trò",
    empApprove.body?.denied === true && afterEmp.status !== "FINALIZED",
    `denied=${empApprove.body?.denied}, status=${afterEmp.status}`
  );

  const deniedLog = await prisma.auditLog.findFirst({
    where: { action: "TELEGRAM_APPROVE_DENIED" },
    orderBy: { createdAt: "desc" },
  });
  check(
    "Lần bấm sai vai trò được ghi vào nhật ký",
    !!deniedLog,
    "không thấy bản ghi TELEGRAM_APPROVE_DENIED"
  );

  // Ban Giám đốc bấm duyệt
  const ceoApprove = await postTelegram(
    {
      callback_query: {
        id: "cb3",
        data: `KPI_APPROVE:${approvalRow.id}`,
        from: { id: Number(FAKE_CEO_CHAT), first_name: "Gia" },
        message: { chat: { id: Number(FAKE_CEO_CHAT), type: "private" }, message_id: 3, text: "x" },
      },
    },
    webhookSecret
  );
  const afterCeo = await prisma.kpiResult.findUnique({
    where: { id: approvalRow.id },
  });
  check(
    "Ban Giám đốc bấm duyệt trên Telegram → KPI chuyển sang đã chốt",
    ceoApprove.body?.approved === true && afterCeo.status === "FINALIZED",
    `approved=${ceoApprove.body?.approved}, status=${afterCeo.status}`
  );

  const tgAudit = await prisma.auditLog.findFirst({
    where: { action: "KPI_CEO_APPROVE_LOCK", entityId: approvalRow.id },
    orderBy: { createdAt: "desc" },
  });
  check(
    "Duyệt qua Telegram vẫn ghi nhật ký y như duyệt trên web",
    !!tgAudit && tgAudit.userAgent === "telegram-bot",
    `userAgent=${tgAudit?.userAgent}`
  );

  const reApprove = await postTelegram(
    {
      callback_query: {
        id: "cb4",
        data: `KPI_APPROVE:${approvalRow.id}`,
        from: { id: Number(FAKE_CEO_CHAT), first_name: "Gia" },
        message: { chat: { id: Number(FAKE_CEO_CHAT), type: "private" }, message_id: 4, text: "x" },
      },
    },
    webhookSecret
  );
  check(
    "Bấm duyệt lần hai không tạo ra thay đổi gì thêm",
    reApprove.status === 200 && reApprove.body?.approved !== true,
    `approved=${reApprove.body?.approved}`
  );

  /* ---------------------------------------------------------------- TEST 6 */
  console.log("\nTEST 6 — Tự nối tài khoản Telegram bằng mã một lần");

  // Ngắt nối trước để thử lại từ đầu
  await prisma.user.update({
    where: { id: hong.id },
    data: { telegramChatId: null },
  });

  const empCookie = await login("nv.sales1@ganifoody.vn");
  const emp2 = api(empCookie);
  const codeRes = await emp2("/api/telegram/link", { method: "POST" });
  check(
    "Nhân viên tự lấy được mã nối 6 số",
    codeRes.status === 200 && /^\d{6}$/.test(codeRes.body?.code ?? ""),
    `HTTP ${codeRes.status}, code=${codeRes.body?.code}`
  );
  const linkCode = codeRes.body?.code;

  const wrongCode = await postTelegram(
    {
      message: {
        chat: { id: 900000003, type: "private" },
        from: { id: 900000003 },
        text: "/start 000000",
      },
    },
    webhookSecret
  );
  const notLinked = await prisma.user.findUnique({ where: { id: hong.id } });
  check(
    "Mã sai thì không nối được",
    wrongCode.body?.linked !== true && !notLinked.telegramChatId,
    `linked=${wrongCode.body?.linked}`
  );

  const linkOk = await postTelegram(
    {
      message: {
        chat: { id: 900000004, type: "private" },
        from: { id: 900000004 },
        text: `/start ${linkCode}`,
      },
    },
    webhookSecret
  );
  const linkedUser = await prisma.user.findUnique({ where: { id: hong.id } });
  check(
    "Mã đúng thì nối được đúng tài khoản",
    linkOk.body?.linked === true && linkedUser.telegramChatId === "900000004",
    `linked=${linkOk.body?.linked}, chatId=${linkedUser.telegramChatId}`
  );

  const reuse = await postTelegram(
    {
      message: {
        chat: { id: 900000005, type: "private" },
        from: { id: 900000005 },
        text: `/start ${linkCode}`,
      },
    },
    webhookSecret
  );
  const stillSame = await prisma.user.findUnique({ where: { id: hong.id } });
  check(
    "Mã đã dùng thì không dùng lại được",
    reuse.body?.linked !== true && stillSame.telegramChatId === "900000004",
    `linked=${reuse.body?.linked}, chatId=${stillSame.telegramChatId}`
  );

  const expiredCode = "111111";
  await prisma.telegramLink.create({
    data: {
      code: expiredCode,
      userId: hong.id,
      expiresAt: new Date(Date.now() - 60_000),
    },
  });
  const expired = await postTelegram(
    {
      message: {
        chat: { id: 900000006, type: "private" },
        from: { id: 900000006 },
        text: `/start ${expiredCode}`,
      },
    },
    webhookSecret
  );
  check(
    "Mã hết hạn thì không nối được",
    expired.body?.linked !== true,
    `linked=${expired.body?.linked}`
  );

  /* ---------------------------------------------------------------- DỌN */
  console.log("\nDọn dữ liệu kiểm thử...");
  await prisma.webhookLog.deleteMany({
    where: { sourceCode: { in: ["test-ipos", "test-crm", "khong-ton-tai"] } },
  });
  await prisma.integrationSource.deleteMany({
    where: { code: { in: ["test-ipos", "test-crm"] } },
  });
  await prisma.kpiActualFeed.deleteMany({
    where: { sourceCode: { in: ["test-ipos", "test-crm"] } },
  });
  await prisma.telegramLink.deleteMany({ where: { createdAt: { gte: TEST_STARTED_AT } } });
  for (const id of new Set(CLEANUP.userIds)) {
    await prisma.user.update({
      where: { id },
      data: { telegramChatId: null },
    });
  }
  console.log("  · đã xoá nguồn, nhật ký webhook và các liên kết Telegram tạm");

  console.log(`\n${"─".repeat(56)}`);
  console.log(`KẾT QUẢ PHASE 3: ${pass} đạt · ${fail} hỏng`);
  console.log("─".repeat(56) + "\n");

  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("\n❌ Bộ kiểm thử gặp lỗi:", e);
  await prisma.$disconnect();
  process.exit(1);
});
