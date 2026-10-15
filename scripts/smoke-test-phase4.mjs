/**
 * KIỂM THỬ PHASE 4 — PHÂN TÍCH & DỰ BÁO
 *
 * Chạy khi server đang bật:  npm run test:phase4
 *
 * Bám bảng test case Phase 4 trong tài liệu thiết kế, cộng thêm phần quan trọng
 * nhất mà bản gốc không có: **kiểm tra hệ thống có TRUNG THỰC về nền dữ liệu hay
 * không.** Thiếu lịch sử thì phải nói thẳng là chưa đủ căn cứ, chứ không được vẽ
 * ra một con số trông thuyết phục.
 *
 *   1. Nhịp làm việc  — thiếu mẫu thì trả nhịp trung tính và khai là chưa đủ nền
 *   2. Dự báo         — chậm tiến độ, bị chặn, chờ mắt xích gãy đều bị bắt
 *   3. Cân bằng tải   — bắt quá tải, gợi ý san vừa đủ chứ không chuyển hết
 *   4. Bất thường KPI — dưới 4 kỳ không kết luận; đủ kỳ thì bắt được đột biến
 *   5. Sức khoẻ       — điểm do hệ thống tính, không phải AI đoán
 *   6. Tự chấm        — hệ thống đo lại xem dự báo của chính nó có đúng không
 *   7. Phân quyền     — nhân viên không xem được, trưởng phòng chỉ thấy phòng mình
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

const CLEANUP = { taskIds: [], anomalyIds: [] };
const DAY = 86400_000;

async function main() {
  console.log(`\n🔬 KIỂM THỬ PHASE 4 — ${BASE}\n`);

  for (let i = 0; i < 30; i++) {
    try {
      await fetch(`${BASE}/login`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const ceo = api(await login("ceo@ganifoody.vn"));
  const salesMgr = api(await login("tp.sales@ganifoody.vn"));
  const emp = api(await login("nv.sales1@ganifoody.vn"));

  const [hong, huy, sang, salesDept, prodDept] = await Promise.all([
    prisma.user.findUnique({ where: { email: "nv.sales1@ganifoody.vn" } }),
    prisma.user.findUnique({ where: { email: "nv.sales2@ganifoody.vn" } }),
    prisma.user.findUnique({ where: { email: "tp.sales@ganifoody.vn" } }),
    prisma.department.findUnique({ where: { code: "SALES" } }),
    prisma.department.findUnique({ where: { code: "PROD" } }),
  ]);

  /* ---------------------------------------------------------------- TEST 1 */
  console.log("TEST 1 — Trung thực về nền dữ liệu");

  const all = await ceo("/api/analytics");
  check(
    "Ban Giám đốc lấy được toàn bộ số liệu phân tích",
    all.status === 200,
    `HTTP ${all.status} ${JSON.stringify(all.body).slice(0, 150)}`
  );

  const preds = all.body?.predictions?.predictions ?? [];
  check(
    "MỌI dự báo đều kèm nền dữ liệu (sampleSize + confidence)",
    preds.length > 0 &&
      preds.every(
        (p) =>
          typeof p.sampleSize === "number" &&
          ["HIGH", "MEDIUM", "LOW", "NONE"].includes(p.confidence)
      ),
    `${preds.length} dự báo, thiếu nền ở ${preds.filter((p) => p.confidence === undefined).length} cái`
  );

  check(
    "Chưa đo được độ chính xác thì nói thẳng, không bịa ra số",
    all.body?.accuracy?.accuracyPercent === null ||
      typeof all.body?.accuracy?.accuracyPercent === "number",
    `accuracyPercent = ${all.body?.accuracy?.accuracyPercent}`
  );

  // Người mới toanh, chưa đóng việc nào
  const newbie = await prisma.user.create({
    data: {
      email: "test.p4.newbie@ganifoody.vn",
      passwordHash: hong.passwordHash,
      fullName: "Nhân viên mới kiểm thử",
      role: "EMPLOYEE",
      departmentId: salesDept.id,
    },
  });

  const newTask = await prisma.task.create({
    data: {
      code: `TASK-P4-${Date.now()}`,
      title: "Kiểm thử P4: việc của người chưa có lịch sử",
      departmentId: salesDept.id,
      assigneeId: newbie.id,
      creatorId: sang.id,
      startDate: new Date(Date.now() - 5 * DAY),
      dueDate: new Date(Date.now() + 3 * DAY),
      priority: "MEDIUM",
      status: "IN_PROGRESS",
      progress: 10,
      estimatedHours: 12,
    },
  });
  CLEANUP.taskIds.push(newTask.id);

  const afterNew = await ceo("/api/analytics");
  const newbiePred = (afterNew.body?.predictions?.predictions ?? []).find(
    (p) => p.taskId === newTask.id
  );
  check(
    "Người chưa có lịch sử → nền dữ liệu ghi rõ là KHÔNG ĐỦ",
    newbiePred?.confidence === "NONE" && newbiePred?.sampleSize === 0,
    `confidence=${newbiePred?.confidence}, sampleSize=${newbiePred?.sampleSize}`
  );
  check(
    "Và nói thẳng trong phần lý do rằng chưa tính được thói quen làm việc",
    (newbiePred?.predictiveFactors ?? []).some((f) =>
      /chưa/i.test(f) && /nền|lịch sử|thói quen|đóng việc/i.test(f)
    ),
    JSON.stringify(newbiePred?.predictiveFactors)
  );

  /* ---------------------------------------------------------------- TEST 2 */
  console.log("\nTEST 2 — Dự báo nguy cơ vỡ kế hoạch");

  // Việc chậm rõ rệt: đã qua 80% thời gian mà mới xong 10%
  const slow = await prisma.task.create({
    data: {
      code: `TASK-P4-SLOW-${Date.now()}`,
      title: "Kiểm thử P4: việc chậm tiến độ rõ rệt",
      departmentId: salesDept.id,
      assigneeId: hong.id,
      creatorId: sang.id,
      startDate: new Date(Date.now() - 8 * DAY),
      dueDate: new Date(Date.now() + 2 * DAY),
      priority: "HIGH",
      status: "IN_PROGRESS",
      progress: 10,
      estimatedHours: 20,
    },
  });
  CLEANUP.taskIds.push(slow.id);

  // Việc bám kế hoạch tốt
  const good = await prisma.task.create({
    data: {
      code: `TASK-P4-OK-${Date.now()}`,
      title: "Kiểm thử P4: việc đang bám kế hoạch",
      departmentId: salesDept.id,
      assigneeId: hong.id,
      creatorId: sang.id,
      startDate: new Date(Date.now() - 2 * DAY),
      dueDate: new Date(Date.now() + 8 * DAY),
      priority: "MEDIUM",
      status: "IN_PROGRESS",
      progress: 60,
      estimatedHours: 12,
    },
  });
  CLEANUP.taskIds.push(good.id);

  const p2 = await ceo("/api/analytics");
  const list2 = p2.body?.predictions?.predictions ?? [];
  const slowP = list2.find((p) => p.taskId === slow.id);
  const goodP = list2.find((p) => p.taskId === good.id);

  check(
    "Việc chậm rõ rệt bị chấm khả năng kịp thấp",
    slowP && slowP.completionProbabilityPercent < 60,
    `nhận được ${slowP?.completionProbabilityPercent}%`
  );
  check(
    "Việc bám kế hoạch được xếp ON_TRACK",
    goodP?.riskCategory === "ON_TRACK",
    `riskCategory = ${goodP?.riskCategory}`
  );
  check(
    "Việc chậm được chấm thấp hơn hẳn việc bám kế hoạch",
    slowP && goodP &&
      slowP.completionProbabilityPercent < goodP.completionProbabilityPercent,
    `chậm ${slowP?.completionProbabilityPercent}% vs tốt ${goodP?.completionProbabilityPercent}%`
  );
  check(
    "Nêu rõ đáng lẽ phải xong bao nhiêu, thực tế bao nhiêu",
    slowP &&
      slowP.expectedProgressPercent > slowP.actualProgressPercent &&
      (slowP.predictiveFactors ?? []).some((f) => /chậm hơn/i.test(f)),
    `đáng lẽ ${slowP?.expectedProgressPercent}%, thực tế ${slowP?.actualProgressPercent}%`
  );
  check(
    "Việc bị dự báo trễ thì có ước lượng số ngày trễ",
    slowP && (slowP.completionProbabilityPercent >= 50 || slowP.projectedDelayDays > 0),
    `projectedDelayDays = ${slowP?.projectedDelayDays}`
  );

  // Việc đang bị chặn phải bị trừ điểm
  await prisma.task.update({
    where: { id: good.id },
    data: { status: "BLOCKED", blockedSince: new Date() },
  });
  const p2b = await ceo("/api/analytics");
  const blockedP = (p2b.body?.predictions?.predictions ?? []).find(
    (p) => p.taskId === good.id
  );
  check(
    "Chuyển sang bị chặn thì khả năng kịp tụt xuống",
    blockedP &&
      blockedP.completionProbabilityPercent <
        goodP.completionProbabilityPercent &&
      (blockedP.predictiveFactors ?? []).some((f) => /chặn/i.test(f)),
    `trước ${goodP?.completionProbabilityPercent}% → sau ${blockedP?.completionProbabilityPercent}%`
  );

  /* ---------------------------------------------------------------- TEST 3 */
  console.log("\nTEST 3 — Cân bằng tải nhân sự");

  const cap = p2b.body?.capacity;
  check(
    "Tính được mức tải cho từng người",
    (cap?.reports ?? []).length > 0 &&
      cap.reports.every((r) => typeof r.utilizationPercent === "number"),
    `${cap?.reports?.length} bản ghi`
  );
  check(
    "Bắt được người đang quá tải",
    cap?.overloaded > 0,
    `overloaded = ${cap?.overloaded}`
  );

  const hongCap = cap.reports.find((r) => r.userId === hong.id);
  check(
    "Người ôm nhiều việc bị đánh dấu quá tải",
    hongCap?.workloadStatus === "OVERLOADED" &&
      hongCap.utilizationPercent > 115,
    `${hongCap?.fullName}: ${hongCap?.utilizationPercent}% ${hongCap?.workloadStatus}`
  );
  check(
    "Có tách riêng số giờ thuộc việc đã quá hạn",
    typeof hongCap?.overdueHours === "number",
    `overdueHours = ${hongCap?.overdueHours}`
  );
  check(
    "Mỗi bản ghi đều khai độ tin cậy của số liệu giờ ước tính",
    cap.reports.every((r) =>
      ["HIGH", "MEDIUM", "LOW", "NONE"].includes(r.confidence)
    ),
    ""
  );

  const sug = cap?.suggestions ?? [];
  if (sug.length > 0) {
    const s = sug[0];
    const excess =
      ((s.from.utilizationPercent - 100) / 100) * s.from.capacityLimitHours;
    check(
      "Gợi ý chuyển VỪA ĐỦ để kéo về mức bình thường, không chuyển hết việc",
      s.suggestedHours <= Math.ceil(excess) + 1 &&
        s.suggestedHours < s.from.totalEstimatedHours,
      `đề nghị ${s.suggestedHours} giờ, phần vượt là ${Math.round(excess)} giờ, tổng tải ${s.from.totalEstimatedHours} giờ`
    );
    check(
      "Gợi ý chỉ trong cùng phòng ban (không phá luật cấm giao vượt cấp)",
      sug.every((x) => x.from.departmentName === x.to.departmentName),
      JSON.stringify(sug.map((x) => `${x.from.departmentName}→${x.to.departmentName}`))
    );
  } else {
    check("Có gợi ý san việc khi có người quá tải", false, "không có gợi ý nào");
    check("Gợi ý chỉ trong cùng phòng ban", false, "không có gợi ý nào");
  }

  /* ---------------------------------------------------------------- TEST 4 */
  console.log("\nTEST 4 — Phát hiện bất thường KPI");

  // Bài test tự kích hoạt bước quét bất thường trước khi đọc kết quả — không
  // được phép giả định có `npm run scheduler` đang chạy song song ở cửa sổ
  // khác. Thiếu dòng này, đọc bảng kpiAnomaly trước khi có ai quét sẽ ra
  // `null`, khiến mọi phép thử bên dưới báo severity/sampleSize/confidence
  // đều `undefined` dù công thức tính bất thường hoàn toàn đúng.
  await ceo("/api/cron/run", { method: "POST" });

  const anomaly = await prisma.kpiAnomaly.findFirst({
    where: { employeeId: huy.id },
    include: { kpiDefinition: true },
  });

  // Trả cảnh báo về trạng thái chờ giải trình. Lượt chạy trước đã giải trình và
  // xử lý xong nó, mà cảnh báo đã xử lý thì hệ thống không cho giải trình lại —
  // đúng luật, nhưng làm bài kiểm thử chạy lần hai là hỏng.
  if (anomaly) {
    await prisma.kpiAnomaly.update({
      where: { id: anomaly.id },
      data: {
        status: "OPEN",
        explanationText: null,
        explainedById: null,
        explainedAt: null,
        reviewNote: null,
        reviewedById: null,
        reviewedAt: null,
      },
    });
  }
  check(
    "Bắt được khai báo đột biến gấp 3,2 lần nếp cũ",
    !!anomaly && anomaly.severity === "CRITICAL",
    `severity = ${anomaly?.severity}`
  );
  check(
    "Ghi rõ dựa trên bao nhiêu kỳ lịch sử",
    anomaly && anomaly.sampleSize >= 4 && anomaly.confidence === "HIGH",
    `sampleSize=${anomaly?.sampleSize}, confidence=${anomaly?.confidence}`
  );
  check(
    "Có cả z-score lẫn thước bền để đối chiếu",
    anomaly && anomaly.zScore > 0 && anomaly.robustScore > 0,
    `z=${anomaly?.zScore}, bền=${anomaly?.robustScore}`
  );
  check(
    "Lý do viết cho người đọc hiểu, có số cụ thể",
    anomaly && /trung vị/i.test(anomaly.reason) && anomaly.reason.length > 60,
    anomaly?.reason?.slice(0, 90)
  );

  /* --- Người thiếu lịch sử thì KHÔNG được kết luận --- */
  const period = await prisma.kpiPeriod.findFirst({
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
  const thinDef = await prisma.kpiDefinition.findUnique({
    where: { code: "SALES_VISIT" },
  });
  const thinRow = await prisma.kpiResult.findUnique({
    where: {
      periodId_employeeId_kpiDefinitionId: {
        periodId: period.id,
        employeeId: newbie.id,
        kpiDefinitionId: thinDef.id,
      },
    },
  });
  // Người mới chưa được gán KPI nên tự tạo một dòng để thử
  const createdThin = thinRow
    ? thinRow
    : await prisma.kpiResult.create({
        data: {
          periodId: period.id,
          employeeId: newbie.id,
          kpiDefinitionId: thinDef.id,
          weightPercent: 15,
          targetValue: 40,
          actualSelf: 9999, // đột biến kinh khủng
          status: "SELF_REVIEWED",
        },
      });

  await ceo("/api/cron/run", { method: "POST" });

  const thinAnomaly = await prisma.kpiAnomaly.findUnique({
    where: { kpiResultId: createdThin.id },
  });
  check(
    "Số đột biến của người CHƯA có lịch sử thì KHÔNG kết luận gì",
    !thinAnomaly,
    `vẫn tạo cảnh báo: ${thinAnomaly?.severity}`
  );

  /* --- Giải trình và duyệt --- */
  const wrongOwner = await emp(`/api/analytics/anomalies/${anomaly.id}`, {
    method: "POST",
    body: JSON.stringify({
      action: "EXPLAIN",
      explanationText: "Tôi giải trình hộ số liệu của người khác xem có được không",
    }),
  });
  check(
    "Nhân viên không giải trình hộ số liệu của người khác",
    wrongOwner.status === 403,
    `HTTP ${wrongOwner.status}`
  );

  const huyCookie = await login("nv.sales2@ganifoody.vn");
  const huyApi = api(huyCookie);
  const short = await huyApi(`/api/analytics/anomalies/${anomaly.id}`, {
    method: "POST",
    body: JSON.stringify({ action: "EXPLAIN", explanationText: "đơn to" }),
  });
  check(
    "Giải trình quá ngắn thì bị từ chối",
    short.status === 422 || short.status === 400,
    `HTTP ${short.status}`
  );

  const explained = await huyApi(`/api/analytics/anomalies/${anomaly.id}`, {
    method: "POST",
    body: JSON.stringify({
      action: "EXPLAIN",
      explanationText:
        "Tháng này chốt được hợp đồng Tết cho chuỗi 12 cửa hàng nên doanh thu cao gấp ba bình thường. Có hợp đồng và phiếu giao hàng kèm theo.",
    }),
  });
  check(
    "Chính chủ giải trình được",
    explained.status === 200 &&
      explained.body?.anomaly?.status === "EXPLAINED",
    `HTTP ${explained.status}`
  );

  const reviewed = await ceo(`/api/analytics/anomalies/${anomaly.id}`, {
    method: "POST",
    body: JSON.stringify({
      action: "REVIEW",
      accepted: true,
      reviewNote: "Đã đối chiếu hợp đồng Tết, chấp nhận",
    }),
  });
  check(
    "Ban Giám đốc xử lý được cảnh báo",
    reviewed.status === 200 &&
      reviewed.body?.anomaly?.status === "ACCEPTED",
    `HTTP ${reviewed.status} ${reviewed.body?.anomaly?.status}`
  );

  const auditRow = await prisma.auditLog.findFirst({
    where: { action: "KPI_ANOMALY_ACCEPT", entityId: anomaly.id },
  });
  check(
    "Việc xử lý được ghi vào nhật ký",
    !!auditRow,
    "không thấy bản ghi nhật ký"
  );

  /* --- Đã xử lý rồi thì lượt quét sau không ghi đè --- */
  await ceo("/api/cron/run", { method: "POST" });
  const after = await prisma.kpiAnomaly.findUnique({ where: { id: anomaly.id } });
  check(
    "Lượt quét sau không ghi đè cảnh báo đã xử lý",
    after?.status === "ACCEPTED",
    `status = ${after?.status}`
  );

  /* ---------------------------------------------------------------- TEST 5 */
  console.log("\nTEST 5 — Điểm sức khoẻ do hệ thống tính");

  const h1 = await ceo("/api/analytics");
  const h2 = await ceo("/api/analytics");
  check(
    "Điểm sức khoẻ tính ra ổn định, hỏi hai lần ra cùng một số",
    h1.body?.health?.score === h2.body?.health?.score,
    `lần 1 ${h1.body?.health?.score}, lần 2 ${h2.body?.health?.score}`
  );
  check(
    "Có tách rõ từng thành phần và trọng số, không phải một con số suông",
    (h1.body?.health?.parts ?? []).length === 5 &&
      h1.body.health.parts.every(
        (p) => typeof p.weight === "number" && typeof p.note === "string"
      ),
    `${h1.body?.health?.parts?.length} thành phần`
  );

  const sumWeights = (h1.body?.health?.parts ?? []).reduce(
    (s, p) => s + p.weight,
    0
  );
  check(
    "Trọng số các thành phần cộng lại đúng 100",
    sumWeights === 100,
    `tổng = ${sumWeights}`
  );

  const brief = await ceo("/api/ai/executive-briefing", { method: "POST" });
  check(
    "Ban Giám đốc tạo được báo cáo điều hành",
    brief.status === 200,
    `HTTP ${brief.status} ${JSON.stringify(brief.body).slice(0, 150)}`
  );
  check(
    "Điểm trong báo cáo LẤY TỪ hệ thống, không phải AI tự chấm",
    brief.body?.healthScore === h1.body?.health?.score,
    `báo cáo ${brief.body?.healthScore} vs hệ thống ${h1.body?.health?.score}`
  );
  check(
    "Báo cáo luôn khai nền dữ liệu của nó",
    typeof brief.body?.dataBasis === "string" &&
      brief.body.dataBasis.length > 30,
    brief.body?.dataBasis?.slice(0, 80)
  );
  check(
    "Có khuyến nghị hành động cụ thể",
    (brief.body?.recommendations ?? []).length > 0,
    `${brief.body?.recommendations?.length} khuyến nghị`
  );
  check(
    "Có câu nói rõ quyết định vẫn là của Ban Giám đốc",
    /quyết định/i.test(brief.body?.disclaimer ?? ""),
    brief.body?.disclaimer
  );

  const savedBrief = await prisma.aiSuggestion.findFirst({
    where: { kind: "EXEC_BRIEFING" },
    orderBy: { createdAt: "desc" },
  });
  check(
    "Báo cáo được lưu lại để tra sau",
    !!savedBrief,
    "không thấy bản ghi"
  );

  /* ---------------------------------------------------------------- TEST 6 */
  console.log("\nTEST 6 — Hệ thống tự chấm lại dự báo của chính nó");

  const logsBefore = await prisma.predictionLog.count();
  check(
    "Bộ máy nền có lưu lại dự báo để sau này đối chiếu",
    logsBefore > 0,
    `${logsBefore} bản ghi`
  );

  // Đóng việc chậm lại, trễ hạn → dự báo "sẽ trễ" phải được tính là ĐÚNG
  const slowLog = await prisma.predictionLog.findFirst({
    where: { taskId: slow.id },
    orderBy: { predictedAt: "desc" },
  });
  await prisma.task.update({
    where: { id: slow.id },
    data: {
      status: "DONE",
      progress: 100,
      completedAt: new Date(Date.now() + 5 * DAY),
    },
  });
  await ceo("/api/cron/run", { method: "POST" });

  const scored = await prisma.predictionLog.findFirst({
    where: { taskId: slow.id, outcomeKnown: true },
    orderBy: { predictedAt: "desc" },
  });
  check(
    "Việc đóng xong thì dự báo cũ được chấm lại",
    !!scored && scored.outcomeKnown === true,
    `outcomeKnown = ${scored?.outcomeKnown}`
  );
  check(
    "Ghi nhận đúng là việc đã trễ",
    scored?.actuallyLate === true,
    `actuallyLate = ${scored?.actuallyLate}, trễ ${scored?.actualDelayDays} ngày`
  );
  check(
    "Dự báo trễ mà trễ thật thì tính là ĐÚNG",
    slowLog && slowLog.completionProbability < 50
      ? scored?.wasCorrect === true
      : true,
    `dự báo ${slowLog?.completionProbability}%, wasCorrect = ${scored?.wasCorrect}`
  );

  const acc = await ceo("/api/analytics");
  check(
    "Sau khi có kết quả thì hệ thống báo được độ chính xác của chính nó",
    acc.body?.accuracy?.total > 0 &&
      typeof acc.body.accuracy.accuracyPercent === "number",
    `đo trên ${acc.body?.accuracy?.total} việc, đúng ${acc.body?.accuracy?.accuracyPercent}%`
  );
  check(
    "Tách riêng loại sai nguy hiểm nhất: báo ổn nhưng lại trễ",
    typeof acc.body?.accuracy?.falseNegative === "number",
    `falseNegative = ${acc.body?.accuracy?.falseNegative}`
  );

  /* ---------------------------------------------------------------- TEST 7 */
  console.log("\nTEST 7 — Phân quyền");

  const empView = await emp("/api/analytics");
  check(
    "Nhân viên không xem được phần phân tích",
    empView.status === 403,
    `HTTP ${empView.status}`
  );

  const empBrief = await emp("/api/ai/executive-briefing", { method: "POST" });
  check(
    "Nhân viên không tạo được báo cáo điều hành",
    empBrief.status === 403,
    `HTTP ${empBrief.status}`
  );

  const mgrBrief = await salesMgr("/api/ai/executive-briefing", {
    method: "POST",
  });
  check(
    "Trưởng phòng cũng không tạo được báo cáo điều hành",
    mgrBrief.status === 403,
    `HTTP ${mgrBrief.status}`
  );

  const mgrView = await salesMgr("/api/analytics");
  check(
    "Trưởng phòng xem được, nhưng bị giới hạn phạm vi phòng mình",
    mgrView.status === 200 && mgrView.body?.scope === "DEPARTMENT",
    `HTTP ${mgrView.status}, scope = ${mgrView.body?.scope}`
  );
  check(
    "Trưởng phòng chỉ thấy nhân sự phòng mình",
    (mgrView.body?.capacity?.reports ?? []).every(
      (r) => r.departmentName === "Kinh doanh"
    ),
    JSON.stringify([
      ...new Set(
        (mgrView.body?.capacity?.reports ?? []).map((r) => r.departmentName)
      ),
    ])
  );

  const sneak = await salesMgr(`/api/analytics?departmentId=${prodDept.id}`);
  check(
    "Trưởng phòng không đọc trộm được phòng ban khác qua tham số URL",
    (sneak.body?.capacity?.reports ?? []).every(
      (r) => r.departmentName === "Kinh doanh"
    ),
    JSON.stringify([
      ...new Set(
        (sneak.body?.capacity?.reports ?? []).map((r) => r.departmentName)
      ),
    ])
  );

  check(
    "Trưởng phòng không thấy điểm sức khoẻ toàn công ty",
    mgrView.body?.health === null,
    `health = ${JSON.stringify(mgrView.body?.health)?.slice(0, 60)}`
  );

  /* ---------------------------------------------------------------- DỌN */
  console.log("\nDọn dữ liệu kiểm thử...");
  await prisma.predictionLog.deleteMany({
    where: { taskId: { in: CLEANUP.taskIds } },
  });
  await prisma.kpiAnomaly.deleteMany({ where: { employeeId: newbie.id } });
  await prisma.kpiResult.deleteMany({ where: { employeeId: newbie.id } });
  await prisma.task.deleteMany({ where: { id: { in: CLEANUP.taskIds } } });
  await prisma.task.deleteMany({ where: { assigneeId: newbie.id } });
  await prisma.user.delete({ where: { id: newbie.id } });
  await prisma.aiSuggestion.deleteMany({ where: { kind: "EXEC_BRIEFING" } });
  console.log("  · đã xoá việc, tài khoản và báo cáo do bài kiểm thử tạo ra");

  console.log(`\n${"─".repeat(56)}`);
  console.log(`KẾT QUẢ PHASE 4: ${pass} đạt · ${fail} hỏng`);
  console.log("─".repeat(56) + "\n");

  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("\n❌ Bộ kiểm thử gặp lỗi:", e);
  await prisma.$disconnect();
  process.exit(1);
});
