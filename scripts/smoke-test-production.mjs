/**
 * KIỂM THỬ KPI XƯỞNG SẢN XUẤT — 2 TẦNG & LUỒNG DUYỆT 3 BƯỚC
 *
 * Chạy khi server đang bật:  npm run test:production
 *
 * Bám bản thiết kế "KPI Bộ phận sản xuất", cộng thêm những chỗ bản gốc để hở:
 *   1. Luồng 3 bước    — không được nhảy cóc, không được tự duyệt phần mình khai
 *   2. Chống thao túng — đặt chỉ tiêu khác chuẩn SKU thì bắt buộc ghi lý do
 *   3. Chấm điểm 2 tầng— công thức 60/40, chặn trần, chia cho 0 không ra NaN
 *   4. Anti-gaming     — đủ 3 luật, khoá thưởng, giải trình, BGĐ quyết
 *   5. Bảo mật trường  — công nhân không xem được số tiền
 *   6. Cầu nối KPI tháng— số ca đã khoá chảy sang cột Số hệ thống của KPI tháng
 */
import { assertLocalTarget } from "./lib/local-guard.mjs";
import { PrismaClient } from "@prisma/client";

try {
  process.loadEnvFile(".env");
} catch {
  /* dùng biến môi trường sẵn có */
}

const BASE = process.env.APP_URL || "http://localhost:3000";
const PASSWORD = process.env.SMOKE_PASSWORD || "Gani@2026";
assertLocalTarget({ appUrl: BASE });
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

const TEST_SKU = "TEST-KPI-SX";

async function main() {
  console.log(`\n🔬 KIỂM THỬ KPI XƯỞNG SẢN XUẤT — ${BASE}\n`);

  for (let i = 0; i < 30; i++) {
    try {
      await fetch(`${BASE}/login`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const ceo = api(await login("ceo@ganifoody.vn"));
  const quanDoc = api(await login("tp.prod@ganifoody.vn")); // SUPERVISOR
  const kcs = api(await login("nv.qc1@ganifoody.vn")); // QC_OFFICER
  const congNhan = api(await login("nv.prod2@ganifoody.vn")); // WORKER
  const sales = api(await login("nv.sales1@ganifoody.vn")); // ngoài xưởng

  const [lanh, tai, phuc] = await Promise.all([
    prisma.user.findUnique({ where: { email: "nv.prod1@ganifoody.vn" } }),
    prisma.user.findUnique({ where: { email: "nv.prod2@ganifoody.vn" } }),
    prisma.user.findUnique({ where: { email: "tp.prod@ganifoody.vn" } }),
  ]);

  /* ---------------------------------------------------------------- TEST 1 */
  console.log("TEST 1 — Danh mục SKU và chuẩn đặt trước");

  const skuRes = await ceo("/api/production/skus", {
    method: "POST",
    body: JSON.stringify({
      skuCode: TEST_SKU,
      skuName: "Mã kiểm thử",
      targetOutputKg: 400,
      stdMaterialLossRate: 8,
      stdKgPerLaborHour: 8,
      unitPriceVnd: 100000,
    }),
  });
  check(
    "Ban Giám đốc tạo được mã SKU kèm chuẩn",
    skuRes.status === 201,
    `HTTP ${skuRes.status} ${JSON.stringify(skuRes.body).slice(0, 150)}`
  );
  const skuId = skuRes.body?.sku?.id;

  const workerSku = await congNhan("/api/production/skus", {
    method: "POST",
    body: JSON.stringify({
      skuCode: "TEST-DENY",
      skuName: "x",
      targetOutputKg: 1,
      stdMaterialLossRate: 1,
      unitPriceVnd: 1,
    }),
  });
  check(
    "Công nhân không tạo được SKU",
    workerSku.status === 403,
    `HTTP ${workerSku.status}`
  );

  const changeNoReason = await ceo(`/api/production/skus?id=${skuId}`, {
    method: "PATCH",
    body: JSON.stringify({ targetOutputKg: 200 }),
  });
  check(
    "Đổi chuẩn sản lượng mà không ghi lý do thì bị chặn",
    changeNoReason.status === 400,
    `HTTP ${changeNoReason.status} ${changeNoReason.body?.message}`
  );

  /* ---------------------------------------------------------------- TEST 2 */
  console.log("\nTEST 2 — Luồng 3 bước, không nhảy cóc");

  const shiftDay = new Date();
  shiftDay.setDate(shiftDay.getDate() - 2);
  shiftDay.setHours(0, 0, 0, 0);

  const draft = await quanDoc("/api/production/shifts", {
    method: "POST",
    body: JSON.stringify({
      shiftDate: shiftDay.toISOString(),
      shiftType: "CA_2",
      skuId,
      rawOutputKg: 430,
      totalLaborHours: 20,
      downtimeHours: 1,
      rawMaterialInputKg: 470,
      participants: [
        { userId: lanh.id, stage: "TAO_HINH", hoursWorked: 10, scheduledHours: 10 },
        { userId: tai.id, stage: "DONG_GOI", hoursWorked: 10, scheduledHours: 10 },
      ],
    }),
  });
  check(
    "Quản đốc khai được ca (bước 1)",
    draft.status === 201 && draft.body?.shift?.status === "DRAFT",
    `HTTP ${draft.status} ${JSON.stringify(draft.body).slice(0, 200)}`
  );
  const shiftId = draft.body?.shift?.id;

  const salesDraft = await sales("/api/production/shifts", {
    method: "POST",
    body: JSON.stringify({
      shiftDate: shiftDay.toISOString(),
      shiftType: "CA_3",
      skuId,
      rawOutputKg: 100,
      totalLaborHours: 5,
      downtimeHours: 0,
      rawMaterialInputKg: 110,
      participants: [
        { userId: lanh.id, stage: "SO_CHE", hoursWorked: 5, scheduledHours: 5 },
      ],
    }),
  });
  check(
    "Người ngoài xưởng không khai được ca",
    salesDraft.status === 403,
    `HTTP ${salesDraft.status}`
  );

  const hourMismatch = await quanDoc("/api/production/shifts", {
    method: "POST",
    body: JSON.stringify({
      shiftDate: shiftDay.toISOString(),
      shiftType: "CA_3",
      skuId,
      rawOutputKg: 100,
      totalLaborHours: 99,
      downtimeHours: 0,
      rawMaterialInputKg: 110,
      participants: [
        { userId: lanh.id, stage: "SO_CHE", hoursWorked: 5, scheduledHours: 5 },
      ],
    }),
  });
  check(
    "Tổng giờ công không khớp với giờ từng người thì bị chặn",
    hourMismatch.status === 400,
    `HTTP ${hourMismatch.status} ${hourMismatch.body?.message}`
  );

  // Nhảy cóc: chưa qua KCS mà đòi khoá luôn
  const skipQc = await ceo(`/api/production/shifts/${shiftId}`, {
    method: "POST",
    body: JSON.stringify({ action: "CEO_LOCK", targetOutputKg: 400 }),
  });
  check(
    "Chưa qua KCS mà đòi khoá số thì bị chặn",
    skipQc.status === 409,
    `HTTP ${skipQc.status} ${skipQc.body?.message}`
  );

  // Tự duyệt phần mình khai
  const selfQc = await quanDoc(`/api/production/shifts/${shiftId}`, {
    method: "POST",
    body: JSON.stringify({
      action: "QC_APPROVE",
      qcPassedKg: 400,
      reworkKg: 20,
      scrapKg: 10,
      haccpViolationCount: 0,
    }),
  });
  check(
    "Người khai ca không tự xác nhận phẩm chất của mình được",
    selfQc.status === 403,
    `HTTP ${selfQc.status} ${selfQc.body?.message}`
  );

  // Lỗi công đoạn ghi cho người KHÔNG có tên trong ca: trước đây bị bỏ qua im
  // lặng (KCS tưởng đã ghi), giờ bị chặn để KCS biết mà sửa.
  const outsiderDefect = await kcs(`/api/production/shifts/${shiftId}`, {
    method: "POST",
    body: JSON.stringify({
      action: "QC_APPROVE",
      qcPassedKg: 400,
      reworkKg: 20,
      scrapKg: 10,
      haccpViolationCount: 0,
      participantDefects: [
        { userId: phuc.id, personalDefectKg: 1, violationCount: 0 },
      ],
    }),
  });
  check(
    "Ghi lỗi công đoạn cho người ngoài danh sách làm ca thì bị chặn",
    outsiderDefect.status === 400,
    `HTTP ${outsiderDefect.status} ${outsiderDefect.body?.message}`
  );

  const qcOk = await kcs(`/api/production/shifts/${shiftId}`, {
    method: "POST",
    body: JSON.stringify({
      action: "QC_APPROVE",
      qcPassedKg: 400,
      reworkKg: 20,
      scrapKg: 10,
      haccpViolationCount: 0,
      qcNote: "Viên đều, một số bị nứt nhẹ",
      participantDefects: [
        { userId: lanh.id, personalDefectKg: 2, violationCount: 0 },
        { userId: tai.id, personalDefectKg: 8, violationCount: 1 },
      ],
    }),
  });
  check(
    "KCS xác nhận được (bước 2)",
    qcOk.status === 200 && qcOk.body?.shift?.status === "QC_APPROVED",
    `HTTP ${qcOk.status} ${JSON.stringify(qcOk.body).slice(0, 200)}`
  );

  const workerLock = await congNhan(`/api/production/shifts/${shiftId}`, {
    method: "POST",
    body: JSON.stringify({ action: "CEO_LOCK", targetOutputKg: 400 }),
  });
  check(
    "Công nhân không khoá số được",
    workerLock.status === 403,
    `HTTP ${workerLock.status}`
  );

  /* ---------------------------------------------------------------- TEST 3 */
  console.log("\nTEST 3 — Chống thao túng chỉ tiêu");

  const noReason = await ceo(`/api/production/shifts/${shiftId}`, {
    method: "POST",
    body: JSON.stringify({ action: "CEO_LOCK", targetOutputKg: 250 }),
  });
  check(
    "Đặt chỉ tiêu khác chuẩn SKU mà không ghi lý do thì bị chặn",
    noReason.status === 400 && /chuẩn/i.test(noReason.body?.message ?? ""),
    `HTTP ${noReason.status} ${noReason.body?.message}`
  );

  const nvlNoReason = await ceo(`/api/production/shifts/${shiftId}`, {
    method: "POST",
    body: JSON.stringify({
      action: "CEO_LOCK",
      targetOutputKg: 400,
      rawMaterialInputKg: 300,
    }),
  });
  check(
    "Sửa số nguyên liệu khác số kho khai mà không ghi lý do thì bị chặn",
    nvlNoReason.status === 400,
    `HTTP ${nvlNoReason.status} ${nvlNoReason.body?.message}`
  );

  const lockOk = await ceo(`/api/production/shifts/${shiftId}`, {
    method: "POST",
    body: JSON.stringify({
      action: "CEO_LOCK",
      targetOutputKg: 400,
      rawMaterialInputKg: 470,
      ceoNote: "Chốt theo chuẩn",
    }),
  });
  check(
    "Đặt đúng chuẩn thì khoá được, không cần lý do (bước 3)",
    lockOk.status === 200,
    `HTTP ${lockOk.status} ${JSON.stringify(lockOk.body).slice(0, 200)}`
  );

  /* ---------------------------------------------------------------- TEST 4 */
  console.log("\nTEST 4 — Chấm điểm 2 tầng");

  const locked = await prisma.productionShiftLog.findUnique({
    where: { id: shiftId },
  });
  // Định mức = 400 × 1,08 = 432 kg
  check(
    "Định mức nguyên liệu tự tính đúng: 400 × (1 + 8%) = 432 kg",
    locked.stdMaterialNormKg === 432,
    `nhận được ${locked.stdMaterialNormKg}`
  );

  // Tổn thất = phế 10 + làm lại 20×0,3 = 6 + vượt định mức (470−432)=38 → 54 kg × 100.000
  check(
    "Tổn thất quy ra tiền đúng: (10 + 20×0,3 + 38) × 100.000 = 5.400.000 ₫",
    locked.qualityLossVnd === 5_400_000,
    `nhận được ${locked.qualityLossVnd}`
  );

  const scores = await prisma.dailyKpiResult.findMany({
    where: { shiftLogId: shiftId },
    include: { user: true },
  });
  check(
    "Chấm điểm cho đúng số người trong ca",
    scores.length === 2,
    `nhận được ${scores.length} bản ghi`
  );

  const sLanh = scores.find((s) => s.userId === lanh.id);
  const sTai = scores.find((s) => s.userId === tai.id);

  check(
    "Điểm tầng 2 giống nhau cho mọi người trong cùng ca",
    sLanh.tier2Score === sTai.tier2Score,
    `Lành ${sLanh.tier2Score} vs Tài ${sTai.tier2Score}`
  );
  check(
    "Điểm tầng 1 KHÁC nhau — người lỗi nhiều và có vi phạm phải thấp hơn",
    sTai.tier1Score < sLanh.tier1Score,
    `Lành ${sLanh.tier1Score} (lỗi 2kg) vs Tài ${sTai.tier1Score} (lỗi 8kg + 1 vi phạm)`
  );

  const expected =
    Math.round((sLanh.tier1Score * 0.6 + sLanh.tier2Score * 0.4) * 100) / 100;
  check(
    "Điểm cuối = tầng 1 × 60% + tầng 2 × 40%",
    Math.abs(sLanh.finalWeightedScore - expected) < 0.01,
    `nhận được ${sLanh.finalWeightedScore}, tính tay ra ${expected}`
  );
  check(
    "Điểm không vượt trần 150",
    scores.every((s) => s.finalWeightedScore <= 150),
    scores.map((s) => s.finalWeightedScore).join(", ")
  );
  check(
    "Có lưu chi tiết từng thành phần điểm để nhân viên mở ra xem",
    !!sLanh.breakdownJson && JSON.parse(sLanh.breakdownJson).tier1.parts.length === 3,
    "thiếu breakdown"
  );

  /* ---------------------------------------------------------------- TEST 5 */
  console.log("\nTEST 5 — Bảo mật cấp độ trường dữ liệu");

  const ceoView = await ceo(`/api/production/shifts/${shiftId}`);
  const workerView = await congNhan(`/api/production/shifts/${shiftId}`);

  check(
    "Ban Giám đốc xem được phần quy ra tiền",
    !!ceoView.body?.financialData?.qualityLossVnd,
    JSON.stringify(ceoView.body?.financialData)
  );
  check(
    "Công nhân KHÔNG xem được phần quy ra tiền",
    workerView.status === 200 && workerView.body?.financialData === undefined,
    `financialData = ${JSON.stringify(workerView.body?.financialData)}`
  );
  check(
    "Công nhân chỉ thấy điểm của chính mình, không thấy điểm người khác",
    workerView.body?.kpiScores?.length === 1 &&
      workerView.body.kpiScores[0].userId === tai.id,
    `thấy ${workerView.body?.kpiScores?.length} bản ghi`
  );
  check(
    "Người ngoài xưởng không xem được ca",
    (await sales(`/api/production/shifts/${shiftId}`)).status === 403,
    ""
  );

  /* ---------------------------------------------------------------- TEST 6 */
  console.log("\nTEST 6 — Ba luật chống chạy chỉ tiêu");

  // --- Luật 1: đạt sản lượng nhưng NVL vượt định mức > 8% ---
  const d1 = new Date();
  d1.setDate(d1.getDate() - 3);
  d1.setHours(0, 0, 0, 0);
  const s1 = await quanDoc("/api/production/shifts", {
    method: "POST",
    body: JSON.stringify({
      shiftDate: d1.toISOString(),
      shiftType: "CA_1",
      skuId,
      rawOutputKg: 420,
      totalLaborHours: 10,
      downtimeHours: 0,
      // định mức 432, cấp 500 → vượt 15,7%
      rawMaterialInputKg: 500,
      participants: [
        { userId: lanh.id, stage: "TAO_HINH", hoursWorked: 10, scheduledHours: 10 },
      ],
    }),
  });
  await kcs(`/api/production/shifts/${s1.body.shift.id}`, {
    method: "POST",
    body: JSON.stringify({
      action: "QC_APPROVE",
      qcPassedKg: 410, // đạt hơn chỉ tiêu 400
      reworkKg: 5,
      scrapKg: 5,
      haccpViolationCount: 0,
    }),
  });
  const lock1 = await ceo(`/api/production/shifts/${s1.body.shift.id}`, {
    method: "POST",
    body: JSON.stringify({ action: "CEO_LOCK", targetOutputKg: 400 }),
  });
  check(
    "Luật 1 — đạt sản lượng nhưng phá nguyên liệu bị bắt",
    (lock1.body?.findings ?? []).some(
      (f) => f.behaviorType === "PRODUCTIVITY_VS_MATERIAL_LOSS"
    ),
    JSON.stringify(lock1.body?.findings?.map((f) => f.behaviorType))
  );
  check(
    "Phát hiện bất thường thì khoá thưởng, không trừ điểm",
    lock1.body?.bonusLocked === true,
    `bonusLocked = ${lock1.body?.bonusLocked}`
  );

  // --- Luật 2: phế = 0 nhưng rework > 4% ---
  const d2 = new Date();
  d2.setDate(d2.getDate() - 4);
  d2.setHours(0, 0, 0, 0);
  const s2 = await quanDoc("/api/production/shifts", {
    method: "POST",
    body: JSON.stringify({
      shiftDate: d2.toISOString(),
      shiftType: "CA_1",
      skuId,
      rawOutputKg: 330,
      totalLaborHours: 10,
      downtimeHours: 0,
      rawMaterialInputKg: 430,
      participants: [
        { userId: lanh.id, stage: "TAO_HINH", hoursWorked: 10, scheduledHours: 10 },
      ],
    }),
  });
  await kcs(`/api/production/shifts/${s2.body.shift.id}`, {
    method: "POST",
    body: JSON.stringify({
      action: "QC_APPROVE",
      qcPassedKg: 300,
      reworkKg: 30, // 10% của 300, vượt ngưỡng 4%
      scrapKg: 0, // báo phế bằng 0
      haccpViolationCount: 0,
    }),
  });
  const lock2 = await ceo(`/api/production/shifts/${s2.body.shift.id}`, {
    method: "POST",
    body: JSON.stringify({ action: "CEO_LOCK", targetOutputKg: 400 }),
  });
  check(
    "Luật 2 — báo phế bằng 0 nhưng làm lại vọt cao bị bắt",
    (lock2.body?.findings ?? []).some(
      (f) => f.behaviorType === "REWORK_HIDING_SCRAP"
    ),
    JSON.stringify(lock2.body?.findings?.map((f) => f.behaviorType))
  );

  // --- Luật 3: lệch cân đối khối lượng ---
  const d3 = new Date();
  d3.setDate(d3.getDate() - 5);
  d3.setHours(0, 0, 0, 0);
  const s3 = await quanDoc("/api/production/shifts", {
    method: "POST",
    body: JSON.stringify({
      shiftDate: d3.toISOString(),
      shiftType: "CA_1",
      skuId,
      rawOutputKg: 400, // khai thô 400
      totalLaborHours: 10,
      downtimeHours: 0,
      rawMaterialInputKg: 432,
      participants: [
        { userId: lanh.id, stage: "TAO_HINH", hoursWorked: 10, scheduledHours: 10 },
      ],
    }),
  });
  await kcs(`/api/production/shifts/${s3.body.shift.id}`, {
    method: "POST",
    body: JSON.stringify({
      action: "QC_APPROVE",
      qcPassedKg: 350,
      reworkKg: 5,
      scrapKg: 5, // tổng 360, lệch 40 kg so với 400
      haccpViolationCount: 0,
      massBalanceReason: "Cân sót lô test luật 3", // lệch >5 kg bắt buộc ghi lý do
    }),
  });
  const lock3 = await ceo(`/api/production/shifts/${s3.body.shift.id}`, {
    method: "POST",
    body: JSON.stringify({ action: "CEO_LOCK", targetOutputKg: 400 }),
  });
  check(
    "Luật 3 — lệch cân đối khối lượng bị bắt",
    (lock3.body?.findings ?? []).some(
      (f) => f.behaviorType === "MASS_BALANCE_MISMATCH"
    ),
    JSON.stringify(lock3.body?.findings?.map((f) => f.behaviorType))
  );

  /* ---------------------------------------------------------------- TEST 7 */
  console.log("\nTEST 7 — Giải trình và Ban Giám đốc quyết");

  const audit = await prisma.antiGamingAudit.findFirst({
    where: { shiftLogId: s1.body.shift.id, status: "PENDING_EXPLANATION" },
  });

  const workerExplain = await congNhan(`/api/production/audits/${audit.id}`, {
    method: "POST",
    body: JSON.stringify({
      action: "EXPLAIN",
      explanationText: "Công nhân thử giải trình thay quản đốc xem có được không",
    }),
  });
  check(
    "Công nhân không giải trình được",
    workerExplain.status === 403,
    `HTTP ${workerExplain.status}`
  );

  const shortText = await quanDoc(`/api/production/audits/${audit.id}`, {
    method: "POST",
    body: JSON.stringify({ action: "EXPLAIN", explanationText: "do máy" }),
  });
  check(
    "Giải trình quá ngắn thì bị từ chối",
    shortText.status === 422 || shortText.status === 400,
    `HTTP ${shortText.status}`
  );

  const explained = await quanDoc(`/api/production/audits/${audit.id}`, {
    method: "POST",
    body: JSON.stringify({
      action: "EXPLAIN",
      explanationText:
        "Lô thịt đông ngày đó rã đông hao nước cao hơn thường lệ 3,5% nên phải cấp thêm nguyên liệu cho đủ kg thành phẩm. Có biên bản bàn giao kho kèm theo.",
    }),
  });
  check(
    "Quản đốc giải trình được",
    explained.status === 200 && explained.body?.audit?.status === "EXPLAINED",
    `HTTP ${explained.status}`
  );

  const quanDocReview = await quanDoc(`/api/production/audits/${audit.id}`, {
    method: "POST",
    body: JSON.stringify({
      action: "REVIEW",
      approved: true,
      reviewNote: "Tôi tự duyệt giải trình của chính tôi",
    }),
  });
  check(
    "Quản đốc không tự duyệt giải trình của mình được",
    quanDocReview.status === 403,
    `HTTP ${quanDocReview.status}`
  );

  const beforeUnlock = await prisma.dailyKpiResult.findFirst({
    where: { shiftLogId: s1.body.shift.id },
  });
  check(
    "Trước khi BGĐ quyết, thưởng vẫn đang khoá",
    beforeUnlock.isBonusLocked === true,
    `isBonusLocked = ${beforeUnlock.isBonusLocked}`
  );

  const reviewed = await ceo(`/api/production/audits/${audit.id}`, {
    method: "POST",
    body: JSON.stringify({
      action: "REVIEW",
      approved: true,
      reviewNote: "Chấp nhận, nhưng yêu cầu KCS kiểm soát khâu rã đông từ tuần sau",
    }),
  });
  check(
    "Ban Giám đốc duyệt được giải trình",
    reviewed.status === 200,
    `HTTP ${reviewed.status} ${JSON.stringify(reviewed.body)}`
  );

  const afterUnlock = await prisma.dailyKpiResult.findFirst({
    where: { shiftLogId: s1.body.shift.id },
  });
  check(
    "Duyệt xong thì mở khoá thưởng",
    afterUnlock.isBonusLocked === false && reviewed.body?.bonusUnlocked === true,
    `isBonusLocked = ${afterUnlock.isBonusLocked}, bonusUnlocked = ${reviewed.body?.bonusUnlocked}`
  );

  /* --- Ca lệch cân đối có 1 cảnh báo, thử từ chối --- */
  const audit3 = await prisma.antiGamingAudit.findFirst({
    where: { shiftLogId: s3.body.shift.id },
  });
  await quanDoc(`/api/production/audits/${audit3.id}`, {
    method: "POST",
    body: JSON.stringify({
      action: "EXPLAIN",
      explanationText:
        "Cân điện tử ở khâu đóng gói bị lệch, đã gọi thợ hiệu chuẩn lại vào hôm sau.",
    }),
  });
  const rejected = await ceo(`/api/production/audits/${audit3.id}`, {
    method: "POST",
    body: JSON.stringify({
      action: "REVIEW",
      approved: false,
      reviewNote: "Không chấp nhận, phải cân lại và khai đúng số",
    }),
  });
  const stillLocked = await prisma.dailyKpiResult.findFirst({
    where: { shiftLogId: s3.body.shift.id },
  });
  check(
    "Bị từ chối thì giữ nguyên khoá thưởng",
    rejected.body?.bonusUnlocked === false && stillLocked.isBonusLocked === true,
    `bonusUnlocked = ${rejected.body?.bonusUnlocked}, isBonusLocked = ${stillLocked.isBonusLocked}`
  );

  /* ---------------------------------------------------------------- TEST 8 */
  console.log("\nTEST 8 — Cầu nối sang KPI tháng");

  const feedsBefore = await prisma.kpiActualFeed.count({
    where: { sourceCode: "production" },
  });
  const cron = await ceo("/api/cron/run", { method: "POST" });
  const feedsAfter = await prisma.kpiActualFeed.count({
    where: { sourceCode: "production" },
  });

  check(
    "Bộ máy nền chạy được phần gộp ca sản xuất",
    cron.status === 200 && !!cron.body?.productionSync,
    `HTTP ${cron.status}`
  );
  check(
    "Ca đã khoá được gộp thành số liệu KPI tháng",
    feedsAfter > feedsBefore,
    `trước ${feedsBefore}, sau ${feedsAfter}`
  );

  const feed = await prisma.kpiActualFeed.findFirst({
    where: { sourceCode: "production", employeeEmail: lanh.email },
    include: { kpiDefinition: true },
    orderBy: { createdAt: "desc" },
  });
  check(
    "Số liệu ghi đúng nguồn để đối soát nhận ra",
    !!feed && feed.source === "PRODUCTION",
    `source = ${feed?.source}`
  );

  /* ---------------------------------------------------------------- TEST 9 */
  console.log("\nTEST 9 — Ca đã khoá thì đóng băng");

  const reQc = await kcs(`/api/production/shifts/${shiftId}`, {
    method: "POST",
    body: JSON.stringify({
      action: "QC_APPROVE",
      qcPassedKg: 999,
      reworkKg: 0,
      scrapKg: 0,
      haccpViolationCount: 0,
    }),
  });
  check(
    "KCS không sửa lại được ca đã khoá",
    reQc.status === 409,
    `HTTP ${reQc.status}`
  );

  const reopenNoReason = await ceo(`/api/production/shifts/${shiftId}`, {
    method: "POST",
    body: JSON.stringify({ action: "REOPEN", reason: "sai" }),
  });
  check(
    "Mở lại ca mà lý do quá ngắn thì bị chặn",
    reopenNoReason.status === 422 || reopenNoReason.status === 400,
    `HTTP ${reopenNoReason.status}`
  );

  const reopened = await ceo(`/api/production/shifts/${shiftId}`, {
    method: "POST",
    body: JSON.stringify({
      action: "REOPEN",
      reason: "KCS cân nhầm khối lượng phế, cần xác nhận lại từ đầu",
    }),
  });
  const afterReopen = await prisma.dailyKpiResult.count({
    where: { shiftLogId: shiftId },
  });
  check(
    "Ban Giám đốc mở lại được và điểm cũ bị xoá sạch",
    reopened.status === 200 && afterReopen === 0,
    `HTTP ${reopened.status}, còn ${afterReopen} bản ghi điểm`
  );

  /* ---------------------------------------------------------------- DỌN */
  console.log("\nDọn dữ liệu kiểm thử...");
  const testShiftIds = [shiftId, s1.body?.shift?.id, s2.body?.shift?.id, s3.body?.shift?.id].filter(Boolean);
  await prisma.dailyKpiResult.deleteMany({
    where: { shiftLogId: { in: testShiftIds } },
  });
  await prisma.antiGamingAudit.deleteMany({
    where: { shiftLogId: { in: testShiftIds } },
  });
  await prisma.productionShiftParticipant.deleteMany({
    where: { shiftLogId: { in: testShiftIds } },
  });
  await prisma.productionShiftLog.deleteMany({
    where: { id: { in: testShiftIds } },
  });
  await prisma.productSku.deleteMany({
    where: { skuCode: { in: [TEST_SKU, "TEST-DENY"] } },
  });
  await prisma.kpiActualFeed.deleteMany({ where: { sourceCode: "production" } });
  console.log("  · đã xoá ca, SKU và số liệu do bài kiểm thử tạo ra");

  console.log(`\n${"─".repeat(56)}`);
  console.log(`KẾT QUẢ KPI SẢN XUẤT: ${pass} đạt · ${fail} hỏng`);
  console.log("─".repeat(56) + "\n");

  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("\n❌ Bộ kiểm thử gặp lỗi:", e);
  await prisma.$disconnect();
  process.exit(1);
});
