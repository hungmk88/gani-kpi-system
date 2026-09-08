/**
 * KIỂM THỬ NGHIỆP VỤ TỰ ĐỘNG — GANI FOODY KPI System
 *
 * Chạy khi server đang bật:  npm run test:smoke
 *
 * Bám đúng bảng TEST CASES trong tài liệu thiết kế:
 *   1. RBAC        — trưởng phòng giao việc vượt cấp → phải bị chặn 403
 *   2. KPI Engine  — đạt 200% chỉ tiêu → điểm phải bị chặn trần ở 150%
 *   3. KPI Locking — nhân viên khai sau hạn ngày 2 → phải bị chặn SLA_LOCKED
 *   4. Data Rec.   — số hệ thống lệch số tự khai > 5% → phải bật cờ lệch số
 *   5. Audit Log   — Ban Giám đốc sửa điểm đã chốt → phải sinh bản ghi audit
 */
import { PrismaClient } from "@prisma/client";

try {
  process.loadEnvFile(".env");
} catch {
  /* dùng biến môi trường sẵn có */
}

const BASE = process.env.APP_URL || "http://localhost:3000";
const PASSWORD = "Gani@2026";
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

/** Đăng nhập, trả về chuỗi cookie để dùng cho các lời gọi sau. */
async function login(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Đăng nhập ${email} thất bại: ${res.status}`);
  const raw = res.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(";")[0]).join("; ");
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

async function main() {
  console.log(`\n🔬 KIỂM THỬ NGHIỆP VỤ — ${BASE}\n`);

  // Chờ server sẵn sàng
  for (let i = 0; i < 30; i++) {
    try {
      await fetch(`${BASE}/login`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const ceoCookie = await login("ceo@ganifoody.vn");
  const salesMgrCookie = await login("tp.sales@ganifoody.vn");
  const salesEmpCookie = await login("nv.sales1@ganifoody.vn");

  const ceo = api(ceoCookie);
  const salesMgr = api(salesMgrCookie);
  const salesEmp = api(salesEmpCookie);

  const prodDept = await prisma.department.findUnique({ where: { code: "PROD" } });
  const salesDept = await prisma.department.findUnique({ where: { code: "SALES" } });
  const prodEmp = await prisma.user.findUnique({
    where: { email: "nv.prod1@ganifoody.vn" },
  });
  const salesEmpUser = await prisma.user.findUnique({
    where: { email: "nv.sales1@ganifoody.vn" },
  });

  const due = new Date(Date.now() + 3 * 86400000).toISOString();

  /* ---------------------------------------------------------------- TEST 1 */
  console.log("TEST 1 — RBAC: chặn giao việc vượt cấp");

  const crossDept = await salesMgr("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      title: "Kiểm thử: TP Kinh doanh giao việc thẳng cho nhân viên Sản xuất",
      departmentId: prodDept.id,
      assigneeId: prodEmp.id,
      dueDate: due,
      priority: "HIGH",
    }),
  });
  check(
    "Trưởng phòng Kinh doanh giao việc sang phòng Sản xuất bị chặn 403",
    crossDept.status === 403 &&
      crossDept.body?.errorCode === "CROSS_DEPT_ASSIGNMENT_FORBIDDEN",
    `Nhận được: ${crossDept.status} ${JSON.stringify(crossDept.body)}`
  );

  const sameDept = await salesMgr("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      title: "Kiểm thử: giao việc trong cùng phòng Kinh doanh",
      departmentId: salesDept.id,
      assigneeId: salesEmpUser.id,
      dueDate: due,
      priority: "MEDIUM",
    }),
  });
  check(
    "Giao việc trong cùng phòng ban thì được phép",
    sameDept.status === 201,
    `Nhận được: ${sameDept.status} ${JSON.stringify(sameDept.body)}`
  );

  const ceoCross = await ceo("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      title: "Kiểm thử: Ban Giám đốc giao việc xuyên phòng ban",
      departmentId: prodDept.id,
      assigneeId: prodEmp.id,
      dueDate: due,
      priority: "LOW",
    }),
  });
  check(
    "Ban Giám đốc giao việc được cho mọi phòng ban",
    ceoCross.status === 201,
    `Nhận được: ${ceoCross.status} ${JSON.stringify(ceoCross.body)}`
  );

  const empAssign = await salesEmp("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      title: "Kiểm thử: nhân viên tự giao việc cho người khác",
      departmentId: salesDept.id,
      assigneeId: salesEmpUser.id,
      dueDate: due,
    }),
  });
  check(
    "Nhân viên không được giao việc cho người khác",
    empAssign.status === 403,
    `Nhận được: ${empAssign.status} ${JSON.stringify(empAssign.body)}`
  );

  /* ---------------------------------------------------------------- TEST 2 */
  console.log("\nTEST 2 — KPI Engine: chặn trần 150%");

  const period = await prisma.kpiPeriod.findFirst({
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
  const capRow = await prisma.kpiResult.findFirst({
    where: { periodId: period.id, employeeId: salesEmpUser.id },
    include: { kpiDefinition: true },
  });

  // Đặt chỉ tiêu 100, thực tế 200 → đạt 200% nhưng phải cắt còn 150%
  //
  // Phải trả cả TRẠNG THÁI về, không chỉ mấy con số: lượt chạy trước đã đẩy dòng
  // này lên FINALIZED, mà dòng đã chốt thì hệ thống từ chối duyệt lại (409) —
  // đúng luật, nhưng làm bài kiểm thử chạy lần hai là hỏng.
  await prisma.kpiResult.update({
    where: { id: capRow.id },
    data: {
      targetValue: 100,
      actualSelf: null,
      actualFinal: null,
      achievementPercent: 0,
      weightedScore: 0,
      isCapped: false,
      status: "SELF_REVIEWED",
      managerReviewedAt: null,
      finalizedAt: null,
    },
  });

  const capRes = await ceo(`/api/kpi/results/${capRow.id}`, {
    method: "POST",
    body: JSON.stringify({
      action: "MANAGER_REVIEW",
      actualFinal: 200,
      reason: "Kiểm thử chặn trần điểm",
    }),
  });
  const capped = await prisma.kpiResult.findUnique({ where: { id: capRow.id } });
  check(
    "Đạt 200% chỉ tiêu nhưng mức đạt bị cắt còn đúng 150%",
    capped.achievementPercent === 150 && capped.isCapped === true,
    `achievement=${capped.achievementPercent}, isCapped=${capped.isCapped}, http=${capRes.status}`
  );
  const expectedScore = Math.round(150 * capped.weightPercent) / 100;
  check(
    `Điểm có trọng số tính đúng: 150% × ${capped.weightPercent}% = ${expectedScore}`,
    Math.abs(capped.weightedScore - expectedScore) < 0.01,
    `weightedScore=${capped.weightedScore}`
  );

  /* ---------------------------------------------------------------- TEST 3 */
  console.log("\nTEST 3 — Khoá theo lịch: nhân viên khai sau hạn ngày 2");

  const lockRow = await prisma.kpiResult.findFirst({
    where: {
      periodId: period.id,
      employeeId: salesEmpUser.id,
      id: { not: capRow.id },
    },
  });

  const originalDeadline = period.selfReviewDeadline;
  // Đẩy hạn tự khai về quá khứ để mô phỏng "hôm nay là ngày 3"
  await prisma.kpiPeriod.update({
    where: { id: period.id },
    data: { selfReviewDeadline: new Date(Date.now() - 86400000) },
  });

  const lateSelf = await salesEmp(`/api/kpi/results/${lockRow.id}`, {
    method: "POST",
    body: JSON.stringify({ action: "SELF_REVIEW", actualSelf: 999 }),
  });
  check(
    "Nhân viên khai sau hạn bị chặn với mã SLA_LOCKED",
    lateSelf.status === 400 && lateSelf.body?.errorCode === "SLA_LOCKED",
    `Nhận được: ${lateSelf.status} ${JSON.stringify(lateSelf.body)}`
  );

  // Đẩy hạn về tương lai rồi khai lại, lần này phải được ghi nhận
  await prisma.kpiPeriod.update({
    where: { id: period.id },
    data: {
      selfReviewDeadline: new Date(Date.now() + 7 * 86400000),
      status: "OPEN",
    },
  });
  const inTimeSelf = await salesEmp(`/api/kpi/results/${lockRow.id}`, {
    method: "POST",
    body: JSON.stringify({
      action: "SELF_REVIEW",
      actualSelf: 100,
      selfNote: "Kiểm thử tự khai đúng hạn",
    }),
  });
  check(
    "Nhân viên khai trong hạn thì được ghi nhận",
    inTimeSelf.status === 200,
    `Nhận được: ${inTimeSelf.status} ${JSON.stringify(inTimeSelf.body)}`
  );

  /* ---------------------------------------------------------------- TEST 4 */
  console.log("\nTEST 4 — Đối soát: lệch số hệ thống và số tự khai quá 5%");

  const mmRow = await prisma.kpiResult.findFirst({
    where: {
      periodId: period.id,
      employeeId: salesEmpUser.id,
      id: { notIn: [capRow.id, lockRow.id] },
    },
  });
  await prisma.kpiResult.update({
    where: { id: mmRow.id },
    data: {
      targetValue: 500,
      actualSystem: 470,
      actualSelf: null,
      actualFinal: null,
      status: "DRAFT",
    },
  });

  // Nhân viên khai 500 trong khi hệ thống báo 470 → lệch 6,38%
  await salesEmp(`/api/kpi/results/${mmRow.id}`, {
    method: "POST",
    body: JSON.stringify({ action: "SELF_REVIEW", actualSelf: 500 }),
  });
  const mm = await prisma.kpiResult.findUnique({ where: { id: mmRow.id } });
  check(
    "Lệch 6,38% (>5%) thì hệ thống tự bật cờ cảnh báo lệch số",
    mm.hasMismatch === true && Math.abs(mm.mismatchPercent - 6.38) < 0.1,
    `hasMismatch=${mm.hasMismatch}, mismatchPercent=${mm.mismatchPercent}`
  );

  // Khai đúng bằng số hệ thống → không được báo lệch
  await prisma.kpiResult.update({
    where: { id: mmRow.id },
    data: { status: "DRAFT" },
  });
  await salesEmp(`/api/kpi/results/${mmRow.id}`, {
    method: "POST",
    body: JSON.stringify({ action: "SELF_REVIEW", actualSelf: 470 }),
  });
  const mm2 = await prisma.kpiResult.findUnique({ where: { id: mmRow.id } });
  check(
    "Khai khớp số hệ thống thì không báo lệch",
    mm2.hasMismatch === false,
    `hasMismatch=${mm2.hasMismatch}`
  );

  /* ---------------------------------------------------------------- TEST 5 */
  console.log("\nTEST 5 — Nhật ký: Ban Giám đốc sửa điểm KPI đã chốt");

  await ceo("/api/kpi/approve", {
    method: "POST",
    body: JSON.stringify({ resultIds: [mmRow.id] }),
  });
  const locked = await prisma.kpiResult.findUnique({ where: { id: mmRow.id } });
  check(
    "Sau khi Ban Giám đốc duyệt, dòng KPI chuyển sang trạng thái khoá",
    locked.status === "FINALIZED",
    `status=${locked.status}`
  );

  // Trưởng phòng cố sửa dòng đã khoá → phải bị chặn
  const mgrAfterLock = await salesMgr(`/api/kpi/results/${mmRow.id}`, {
    method: "POST",
    body: JSON.stringify({ action: "MANAGER_REVIEW", actualFinal: 999 }),
  });
  check(
    "Trưởng phòng không sửa được KPI đã khoá",
    mgrAfterLock.status === 409 || mgrAfterLock.status === 403,
    `Nhận được: ${mgrAfterLock.status} ${JSON.stringify(mgrAfterLock.body)}`
  );

  // Ban Giám đốc sửa nhưng lý do quá ngắn → phải bị chặn
  const shortReason = await ceo(`/api/kpi/results/${mmRow.id}`, {
    method: "POST",
    body: JSON.stringify({
      action: "EDIT_LOCKED",
      actualFinal: 480,
      reason: "sai",
    }),
  });
  check(
    "Sửa KPI đã khoá mà lý do quá ngắn thì bị từ chối",
    shortReason.status === 422 || shortReason.status === 400,
    `Nhận được: ${shortReason.status} ${JSON.stringify(shortReason.body)}`
  );

  // Ban Giám đốc sửa có lý do đầy đủ → phải được, và phải có audit log
  const auditBefore = await prisma.auditLog.count({
    where: { action: "KPI_EDIT_AFTER_LOCK" },
  });
  const edited = await ceo(`/api/kpi/results/${mmRow.id}`, {
    method: "POST",
    body: JSON.stringify({
      action: "EDIT_LOCKED",
      actualFinal: 480,
      reason: "Đối soát lại hoá đơn thực tế với kế toán, số đúng là 480",
    }),
  });
  const auditAfter = await prisma.auditLog.count({
    where: { action: "KPI_EDIT_AFTER_LOCK" },
  });
  check(
    "Ban Giám đốc sửa được KPI đã khoá khi có lý do rõ ràng",
    edited.status === 200,
    `Nhận được: ${edited.status} ${JSON.stringify(edited.body)}`
  );

  const auditRow = await prisma.auditLog.findFirst({
    where: { action: "KPI_EDIT_AFTER_LOCK", entityId: mmRow.id },
    orderBy: { createdAt: "desc" },
  });
  check(
    "Sinh đúng 1 bản ghi nhật ký cho lần sửa này",
    auditAfter === auditBefore + 1,
    `trước=${auditBefore}, sau=${auditAfter}`
  );
  check(
    "Bản ghi nhật ký có đủ số cũ, số mới và lý do",
    !!auditRow &&
      JSON.parse(auditRow.beforePayload).actualFinal === 470 &&
      JSON.parse(auditRow.afterPayload).actualFinal === 480 &&
      auditRow.reason?.includes("480"),
    auditRow
      ? `before=${auditRow.beforePayload} after=${auditRow.afterPayload}`
      : "không tìm thấy bản ghi"
  );

  /* ---------------------------------------------------------------- TEST 6 */
  console.log("\nTEST 6 — Phạm vi dữ liệu theo vai trò");

  const empTasks = await salesEmp("/api/tasks");
  const mgrTasks = await salesMgr("/api/tasks");
  const ceoTasks = await ceo("/api/tasks");
  check(
    "Nhân viên thấy ít việc hơn trưởng phòng, trưởng phòng thấy ít hơn Ban Giám đốc",
    empTasks.body.count <= mgrTasks.body.count &&
      mgrTasks.body.count < ceoTasks.body.count,
    `NV=${empTasks.body.count}, TP=${mgrTasks.body.count}, BGĐ=${ceoTasks.body.count}`
  );

  const otherDeptTask = await prisma.task.findFirst({
    where: { departmentId: prodDept.id },
  });
  const peek = await salesEmp(`/api/tasks/${otherDeptTask.id}`);
  check(
    "Nhân viên không xem được việc của phòng ban khác",
    peek.status === 403,
    `Nhận được: ${peek.status}`
  );

  // Trả hạn tự khai về đúng như trước khi kiểm thử
  await prisma.kpiPeriod.update({
    where: { id: period.id },
    data: { selfReviewDeadline: originalDeadline },
  });

  /* ---------------------------------------------------------------- TỔNG KẾT */
  console.log(`\n${"─".repeat(56)}`);
  console.log(`KẾT QUẢ: ${pass} đạt · ${fail} hỏng`);
  console.log("─".repeat(56) + "\n");

  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("\n❌ Bộ kiểm thử gặp lỗi:", e);
  await prisma.$disconnect();
  process.exit(1);
});
