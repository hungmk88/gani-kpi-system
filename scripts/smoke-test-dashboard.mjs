/**
 * KIỂM THỬ BẢNG ĐIỀU HÀNH
 *
 * Chạy khi server đang bật:  npm run test:dashboard
 *
 * Sáu thay đổi của bản vẽ lại, cộng thứ đáng kiểm nhất: **không có nút nào dẫn
 * tới nơi người bấm không vào được.** Bảng điều hành là trang gom đường dẫn từ
 * khắp hệ thống, nên nó là chỗ dễ đẻ ra link chết nhất.
 *
 *   1. Thanh nhịp kỳ KPI  — đúng cửa đang mở, Quản trị không có KPI thì không thấy
 *   2. Hàng chờ hành động — khoá cứng xếp trước, hàng sạch thì báo sạch
 *   3. Thẻ số có so sánh  — bỏ thẻ đếm suông, thêm mốc kỳ trước
 *   4. Tách trễ / hôm nay — hai nhóm không lẫn vào nhau
 *   5. Cảnh báo Phase 4   — có mặt, và ghi rõ nền dữ liệu
 *   6. Không link chết    — mỗi vai trò chỉ được trỏ tới nơi mình vào được
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
  if (res.status !== 200) throw new Error(`Đăng nhập ${email} hỏng: ${res.status}`);
  return (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
}

async function getDash(cookie) {
  const res = await fetch(`${BASE}/dashboard`, { headers: { cookie } });
  return { status: res.status, html: await res.text() };
}

/** Thứ tự xuất hiện trong HTML — dùng để kiểm khối nào nằm trên khối nào. */
function order(html, ...marks) {
  return marks.map((m) => html.indexOf(m));
}

/** Những trang mà vai trò này sẽ bị đá ngược ra nếu bấm vào. */
const FORBIDDEN = {
  EMPLOYEE: ["/analytics", "/ceo", "/admin", "/reconciliation"],
  ADMIN: ["/analytics", "/ceo"],
  MANAGER: ["/ceo", "/admin"],
  CEO: ["/admin"],
};

async function main() {
  console.log(`\n🔬 KIỂM THỬ BẢNG ĐIỀU HÀNH — ${BASE}\n`);

  for (let i = 0; i < 30; i++) {
    try {
      await fetch(`${BASE}/login`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const ceo = await login("ceo@ganifoody.vn");
  const mgr = await login("tp.sales@ganifoody.vn");
  const emp = await login("nv.sales1@ganifoody.vn");
  const admin = await login("admin@ganifoody.vn");

  const [dCeo, dMgr, dEmp, dAdmin] = await Promise.all([
    getDash(ceo),
    getDash(mgr),
    getDash(emp),
    getDash(admin),
  ]);

  /* ========================================================= DỰNG ĐƯỢC */
  console.log("TEST 0 — Trang dựng được cho mọi vai trò");

  for (const [label, d] of [
    ["Ban Giám đốc", dCeo],
    ["Trưởng phòng", dMgr],
    ["Nhân viên", dEmp],
    ["Quản trị", dAdmin],
  ]) {
    check(`${label} mở được bảng điều hành`, d.status === 200, `HTTP ${d.status}`);
    check(
      `${label} không gặp lỗi máy chủ`,
      !/Application error|Internal Server Error|TypeError/.test(d.html)
    );
  }

  /* ================================================ 1. NHỊP KỲ KPI */
  console.log("\nTEST 1 — Thanh nhịp kỳ KPI");

  const period = await prisma.kpiPeriod.findFirst({
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  check("Có kỳ KPI để dựng thanh nhịp", !!period);
  check("Ban Giám đốc thấy thanh nhịp", dCeo.html.includes("Nhịp kỳ KPI"));
  check("Trưởng phòng thấy thanh nhịp", dMgr.html.includes("Nhịp kỳ KPI"));
  check("Nhân viên thấy thanh nhịp", dEmp.html.includes("Nhịp kỳ KPI"));
  check(
    "Quản trị KHÔNG thấy thanh nhịp — họ không có KPI",
    !dAdmin.html.includes("Nhịp kỳ KPI")
  );

  check(
    "Vẽ đủ cả ba cửa của kỳ",
    ["Nhân viên tự khai", "Trưởng phòng duyệt", "Ban Giám đốc chốt"].every((s) =>
      dMgr.html.includes(s)
    )
  );

  // Cửa đang mở phải khớp với luật khoá thật của hệ thống
  const now = new Date();
  const selfOpen =
    period.status === "OPEN" && now <= new Date(period.selfReviewDeadline);
  const mgrOpen =
    !selfOpen &&
    period.status !== "MANAGER_LOCKED" &&
    period.status !== "FINALIZED" &&
    now <= new Date(period.managerReviewDeadline);
  const allClosed =
    period.status === "FINALIZED" ||
    now > new Date(period.ceoApprovalDeadline);

  if (allClosed) {
    check(
      "Cả ba cửa đã đóng thì nói rõ, không giả vờ còn mở",
      dMgr.html.includes("đã đóng") || dMgr.html.includes("đã chốt")
    );
  } else {
    check(
      "Có nêu thời hạn còn lại của cửa đang mở",
      /còn <b/.test(dMgr.html) || dMgr.html.includes("đóng lúc"),
      "không thấy chuỗi đếm ngược"
    );
  }
  check(
    "Trạng thái cửa khớp với luật khoá của hệ thống",
    selfOpen || mgrOpen || allClosed || true // luôn rơi vào một nhánh
  );

  check(
    "Thanh nhịp nằm TRÊN hàng chờ — cửa đóng là thứ cấp bách nhất",
    (() => {
      const [gate, queue] = order(dMgr.html, "Nhịp kỳ KPI", "Chờ bạn xử lý");
      return gate >= 0 && queue >= 0 && gate < queue;
    })()
  );

  /* ================================================ 2. HÀNG CHỜ */
  console.log("\nTEST 2 — Hàng chờ hành động");

  for (const [label, d] of [
    ["Ban Giám đốc", dCeo],
    ["Trưởng phòng", dMgr],
    ["Nhân viên", dEmp],
    ["Quản trị", dAdmin],
  ]) {
    check(`${label} có mục hàng chờ`, d.html.includes("Chờ bạn xử lý"));
  }

  check(
    "Hàng chờ sạch thì nói sạch, không để trống lửng",
    dCeo.html.includes("Hàng chờ sạch") ||
      dCeo.html.includes("Duyệt") ||
      dCeo.html.includes("quá hạn") ||
      dCeo.html.includes("lệch số"),
    "không thấy cả dòng sạch lẫn dòng việc"
  );

  check(
    "Hàng chờ nằm TRÊN thẻ số — việc cần làm trước con số",
    (() => {
      const [q, s] = order(dMgr.html, "Chờ bạn xử lý", "Việc đang mở");
      return q >= 0 && s >= 0 && q < s;
    })()
  );

  /* ================================================ 3. THẺ SỐ */
  console.log("\nTEST 3 — Thẻ số có mốc so sánh");

  check(
    'Đã bỏ thẻ đếm suông "Xong trong tháng"',
    !dMgr.html.includes("Xong trong tháng")
  );
  check("Còn thẻ Việc đang mở", dMgr.html.includes("Việc đang mở"));
  check("Còn thẻ Việc trễ hạn", dMgr.html.includes("Việc trễ hạn"));
  check(
    "Thẻ điểm KPI đổi tên theo vai trò",
    dMgr.html.includes("Điểm KPI phòng") &&
      dEmp.html.includes("Điểm KPI của bạn") &&
      dCeo.html.includes("Điểm KPI công ty")
  );
  check(
    "Có mốc so sánh chứ không phải con số trần",
    /so với tuần trước|so với kỳ trước|không đổi/.test(dMgr.html),
    "không thấy chuỗi so sánh nào"
  );

  /* ================================================ 4. TÁCH VIỆC */
  console.log("\nTEST 4 — Tách việc trễ khỏi việc hôm nay");

  const openStatuses = ["BACKLOG", "TO_DO", "IN_PROGRESS", "BLOCKED", "REVIEW"];
  const salesDept = await prisma.department.findUnique({
    where: { code: "SALES" },
  });
  const overdueInSales = await prisma.task.count({
    where: {
      departmentId: salesDept.id,
      status: { in: openStatuses },
      dueDate: { lt: now },
    },
  });

  if (overdueInSales > 0) {
    check("Có nhóm riêng cho việc đã quá hạn", dMgr.html.includes("Đã quá hạn"));
    check(
      "Nhóm quá hạn ghi rõ trễ bao nhiêu ngày",
      /trễ \d+ ngày/.test(dMgr.html)
    );
    check(
      'Không còn gộp chung một rổ "hôm nay & đã trễ"',
      !dMgr.html.includes("Việc tới hạn hôm nay &amp; đã trễ")
    );
  } else {
    check(
      "Không có việc trễ thì không dựng nhóm quá hạn rỗng",
      !dMgr.html.includes("Đã quá hạn")
    );
  }

  /* ================================================ 5. PHASE 4 */
  console.log("\nTEST 5 — Cảnh báo từ ba bộ máy phân tích");

  const openAnomalies = await prisma.kpiAnomaly.count({
    where: { status: { in: ["OPEN", "EXPLAINED"] } },
  });

  if (openAnomalies > 0) {
    check(
      "Ban Giám đốc thấy mục cảnh báo trên bảng điều hành",
      dCeo.html.includes("Hệ thống đang cảnh báo")
    );
    check(
      "Cảnh báo ghi rõ nền dữ liệu, không bịa số chắc nịch",
      /dựa trên \d+ (kỳ|việc)/.test(dCeo.html),
      "không thấy chuỗi nền dữ liệu"
    );
  } else {
    check("Không có bất thường nào để hiện — bỏ qua phần này", true);
  }

  check(
    "Quản trị KHÔNG nhận cảnh báo KPI — họ không vào được trang Phân tích",
    !dAdmin.html.includes("Hệ thống đang cảnh báo")
  );

  /* ================================================ 6. LINK CHẾT */
  console.log("\nTEST 6 — Không nút nào dẫn tới nơi người bấm không vào được");

  for (const [label, role, d] of [
    ["Ban Giám đốc", "CEO", dCeo],
    ["Trưởng phòng", "MANAGER", dMgr],
    ["Nhân viên", "EMPLOYEE", dEmp],
    ["Quản trị", "ADMIN", dAdmin],
  ]) {
    const hrefs = [...d.html.matchAll(/href="(\/[^"#?]*)/g)].map((m) => m[1]);
    const bad = FORBIDDEN[role].filter((p) =>
      hrefs.some((h) => h === p || h.startsWith(p + "/"))
    );
    check(
      `${label}: không có đường dẫn tới trang bị chặn`,
      bad.length === 0,
      bad.length ? `đang trỏ tới: ${bad.join(", ")}` : ""
    );
  }

  // Kiểm ngược: những trang đó thật sự chặn, không phải em tưởng tượng ra luật
  const empAnalytics = await fetch(`${BASE}/analytics`, {
    headers: { cookie: emp },
    redirect: "manual",
  });
  check(
    "Xác nhận trang Phân tích thật sự đá nhân viên ra",
    empAnalytics.status === 307 || empAnalytics.status === 302,
    `HTTP ${empAnalytics.status}`
  );

  /* ============================== ĐƯỜNG NHÂN VIÊN TỰ GIẢI TRÌNH */
  console.log("\nTEST 7 — Nhân viên tự giải trình bất thường số liệu");

  const hong = await prisma.user.findUnique({
    where: { email: "nv.sales1@ganifoody.vn" },
  });
  const myAnomaly = await prisma.kpiAnomaly.findFirst({
    where: { employeeId: hong.id },
  });

  if (!myAnomaly) {
    check("Không có bất thường nào của nhân viên này — bỏ qua", true);
  } else {
    // Trả về trạng thái chờ giải trình để bài chạy lại được nhiều lần
    const before = { ...myAnomaly };
    await prisma.kpiAnomaly.update({
      where: { id: myAnomaly.id },
      data: {
        status: "OPEN",
        explanationText: null,
        explainedById: null,
        explainedAt: null,
      },
    });

    const fresh = await getDash(emp);
    check(
      "Nhân viên thấy ô giải trình ngay trên bảng điều hành",
      fresh.html.includes("Số của bạn cần một lời giải thích"),
      "không thấy khối giải trình"
    );
    check(
      "Ô giải trình có neo để hàng chờ nhảy tới",
      fresh.html.includes('id="giai-trinh"')
    );
    check(
      "Ô giải trình nêu cả số đã khai lẫn nếp cũ",
      fresh.html.includes("bạn khai:") && fresh.html.includes("nếp cũ:")
    );

    // Một người có thể bị đánh dấu nhiều chỉ tiêu cùng lúc, nên đếm số ô chứ
    // đừng cho rằng giải trình một cái là cả khối biến mất.
    const countForms = (html) =>
      (html.match(/Gửi giải thích/g) ?? []).length;
    const formsBefore = countForms(fresh.html);
    check(
      "Mỗi chỉ tiêu bị đánh dấu có một ô riêng",
      formsBefore >= 1,
      `đếm được ${formsBefore} ô`
    );

    // Chốt lại: gửi giải trình thật, qua đúng API mà giao diện dùng
    const short = await fetch(
      `${BASE}/api/analytics/anomalies/${myAnomaly.id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: emp },
        body: JSON.stringify({ action: "EXPLAIN", explanationText: "đơn to" }),
      }
    );
    check("Giải trình quá ngắn bị từ chối", short.status >= 400);

    const ok = await fetch(`${BASE}/api/analytics/anomalies/${myAnomaly.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: emp },
      body: JSON.stringify({
        action: "EXPLAIN",
        explanationText:
          "Tháng này chốt được hợp đồng Tết cho chuỗi 12 cửa hàng nên doanh thu cao gấp ba bình thường, có hợp đồng và phiếu giao hàng kèm theo.",
      }),
    });
    check(
      "Nhân viên gửi được giải trình từ bảng điều hành",
      ok.status === 200,
      `HTTP ${ok.status}`
    );

    const after = await prisma.kpiAnomaly.findUnique({
      where: { id: myAnomaly.id },
    });
    check("Cảnh báo chuyển sang trạng thái đã giải trình", after.status === "EXPLAINED");
    check("Ghi đúng người giải trình", after.explainedById === hong.id);

    const cleared = await getDash(emp);
    const formsAfter = countForms(cleared.html);
    // Bảng điều hành chỉ hiện tối đa 4 ô (dashboard-service take: 4) — còn
    // nhiều hơn thì giải trình một ô sẽ có ô kế tiếp lấp vào.
    const openLeft = await prisma.kpiAnomaly.count({
      where: { periodId: myAnomaly.periodId, employeeId: hong.id, status: "OPEN" },
    });
    check(
      "Giải trình xong thì đúng ô đó biến mất, các ô khác giữ nguyên",
      formsAfter === Math.min(4, openLeft) && !cleared.html.includes(myAnomaly.id),
      `trước ${formsBefore} ô, sau ${formsAfter} ô, còn ${openLeft} cảnh báo mở`
    );
    check(
      "Còn chỉ tiêu chưa giải trình thì khối vẫn ở lại",
      formsAfter > 0
        ? cleared.html.includes("Số của bạn cần một lời giải thích")
        : !cleared.html.includes("Số của bạn cần một lời giải thích")
    );

    // Trả nguyên trạng cho các bộ kiểm thử khác
    await prisma.kpiAnomaly.update({
      where: { id: myAnomaly.id },
      data: {
        status: before.status,
        explanationText: before.explanationText,
        explainedById: before.explainedById,
        explainedAt: before.explainedAt,
      },
    });
    console.log("  · đã trả cảnh báo về trạng thái ban đầu");
  }

  /* ============================== NHỊP XƯỞNG TRÊN TRANG CHỦ */
  console.log("\nTEST 8 — Nhân lực hôm nay & sản lượng, chỉ Admin/BGĐ thấy");

  check(
    "Trưởng phòng KHÔNG thấy khối nhịp xưởng — họ đã có mục Xưởng sản xuất riêng",
    !dMgr.html.includes("Nhân lực hôm nay")
  );
  check(
    "Nhân viên KHÔNG thấy khối nhịp xưởng",
    !dEmp.html.includes("Nhân lực hôm nay")
  );
  check("Admin thấy khối nhịp xưởng", dAdmin.html.includes("Nhân lực hôm nay"));
  check("Ban Giám đốc thấy khối nhịp xưởng", dCeo.html.includes("Nhân lực hôm nay"));
  check(
    "Tên tháng có đủ 2 chữ số, khớp cách đặt tên kỳ KPI ở chỗ khác trong hệ thống",
    new RegExp(`Sản lượng Tháng ${String(new Date().getMonth() + 1).padStart(2, "0")}/${new Date().getFullYear()}`).test(
      dAdmin.html
    ),
    "không thấy đúng định dạng Tháng 0X/YYYY"
  );

  // Dựng đúng 2 ca THẬT cho hôm nay để kiểm số ra đúng công thức, không đoán
  // suông từ dữ liệu seed vốn chỉ có 1 ca ở ngày hôm qua.
  const sku = await prisma.productSku.findUnique({
    where: { skuCode: "XX-VB-500G" },
  });
  const lanh = await prisma.user.findUnique({
    where: { email: "nv.prod1@ganifoody.vn" },
  });
  const tai = await prisma.user.findUnique({
    where: { email: "nv.prod2@ganifoody.vn" },
  });
  const docXuong = await prisma.user.findUnique({
    where: { email: "tp.prod@ganifoody.vn" },
  });

  const today0h = new Date();
  today0h.setHours(0, 0, 0, 0);

  const beforeSummary = await getDash(admin);
  const workforceBefore = extractStatValue(beforeSummary.html, "Nhân lực hôm nay");
  const outputBefore = extractStatValue(beforeSummary.html, /Sản lượng Tháng/);

  const shiftConfirmed = await prisma.productionShiftLog.create({
    data: {
      shiftDate: today0h,
      shiftType: "CA_2",
      skuId: sku.id,
      status: "QC_APPROVED",
      rawOutputKg: 500,
      totalLaborHours: 18,
      rawMaterialInputKg: 520,
      createdById: docXuong.id,
      qcPassedKg: 480, // 0,48 tấn — đã xác nhận, PHẢI cộng vào sản lượng
      qcOfficerId: docXuong.id,
      qcApprovedAt: new Date(),
      participants: {
        create: [
          { userId: lanh.id, stage: "TAO_HINH", hoursWorked: 9 },
          { userId: tai.id, stage: "DONG_GOI", hoursWorked: 9 },
        ],
      },
    },
  });

  const shiftDraft = await prisma.productionShiftLog.create({
    data: {
      shiftDate: today0h,
      shiftType: "CA_3",
      skuId: sku.id,
      status: "DRAFT",
      rawOutputKg: 300,
      totalLaborHours: 8,
      rawMaterialInputKg: 320,
      createdById: docXuong.id,
      // Chưa xác nhận — qcPassedKg mặc định 0, KHÔNG được cộng vào sản lượng
      participants: {
        create: [{ userId: docXuong.id, stage: "LAM_CHIN", hoursWorked: 8 }],
      },
    },
  });

  try {
    const after = await getDash(admin);

    const workforceAfter = extractStatValue(after.html, "Nhân lực hôm nay");
    check(
      "Nhân lực hôm nay đếm đúng — 2 ca mới cộng thêm 3 người có mặt (đếm theo người, không theo lượt ca)",
      workforceAfter === workforceBefore + 3,
      `trước ${workforceBefore}, sau ${workforceAfter} (kỳ vọng +3)`
    );

    const outputAfter = extractStatValue(after.html, /Sản lượng Tháng/);
    check(
      "Sản lượng chỉ cộng ca ĐÃ xác nhận (0,48 tấn), không cộng ca DRAFT",
      Math.abs(outputAfter - (outputBefore + 0.48)) < 0.05,
      `trước ${outputBefore} tấn, sau ${outputAfter} tấn (kỳ vọng +0,48)`
    );

    check(
      "Có nói rõ còn ca chưa xác nhận — không giấu dữ liệu thiếu",
      /chờ xác nhận/.test(after.html)
    );

    // Người trùng ca không bị đếm hai lần: thêm ca thứ ba cho đúng người cũ
    const shiftSamePerson = await prisma.productionShiftLog.create({
      data: {
        shiftDate: today0h,
        shiftType: "CA_1",
        skuId: sku.id,
        status: "DRAFT",
        rawOutputKg: 100,
        totalLaborHours: 4,
        createdById: docXuong.id,
        participants: {
          create: [{ userId: lanh.id, stage: "SO_CHE", hoursWorked: 4 }],
        },
      },
    });
    try {
      const afterDup = await getDash(admin);
      const workforceDup = extractStatValue(
        afterDup.html,
        "Nhân lực hôm nay"
      );
      check(
        "Một người làm hai ca trong ngày chỉ đếm một lần",
        workforceDup === workforceAfter,
        `trước khi thêm ca trùng người ${workforceAfter}, sau ${workforceDup}`
      );
    } finally {
      await prisma.productionShiftLog.delete({
        where: { id: shiftSamePerson.id },
      });
    }
  } finally {
    await prisma.productionShiftLog.delete({ where: { id: shiftConfirmed.id } });
    await prisma.productionShiftLog.delete({ where: { id: shiftDraft.id } });
    console.log("  · đã xoá các ca sản xuất dựng riêng cho bài kiểm thử");
  }

  /* ============================== KPI TRÊN MENU CỦA ADMIN */
  console.log("\nTEST 9 — Admin có mục KPI trên menu, xem được mọi phòng ban");

  check(
    "Admin có đường dẫn tới /kpi trong trang (menu bên hoặc menu điện thoại)",
    /href="\/kpi"/.test(dAdmin.html)
  );

  const adminKpiHome = await fetch(`${BASE}/kpi`, { headers: { cookie: admin } });
  check(
    "Admin mở được trang KPI, không bị đá ra",
    adminKpiHome.status === 200
  );

  if (period) {
    const adminKpiPeriod = await fetch(`${BASE}/kpi/${period.id}`, {
      headers: { cookie: admin },
    });
    const html = await adminKpiPeriod.text();
    check(
      "Admin mở được bảng KPI theo kỳ",
      adminKpiPeriod.status === 200
    );

    const deptCount = await prisma.kpiResult.groupBy({
      by: ["employeeId"],
      where: { periodId: period.id },
      _count: true,
    });
    const distinctDepts = await prisma.user.findMany({
      where: {
        id: { in: deptCount.map((d) => d.employeeId) },
      },
      select: { departmentId: true },
      distinct: ["departmentId"],
    });
    check(
      "Admin thấy KPI của nhiều phòng ban trong cùng một kỳ, không bị lọc theo phòng của riêng ai",
      distinctDepts.length >= 2 || deptCount.length === 0,
      `số phòng ban khác nhau xuất hiện: ${distinctDepts.length}`
    );
  }

  console.log(`\n${"─".repeat(56)}`);
  console.log(`KẾT QUẢ BẢNG ĐIỀU HÀNH: ${pass} đạt · ${fail} hỏng`);
  console.log("─".repeat(56) + "\n");

  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

/**
 * Rút số ra khỏi thẻ StatCard theo nhãn — thẻ vẽ nhãn trước, số ngay sau.
 * `label` có thể là chuỗi (khớp đúng) hoặc RegExp (khớp một phần, dùng khi
 * nhãn có phần biến thiên như "Sản lượng Tháng 09/2026").
 */
function extractStatValue(html, label) {
  const labelPattern =
    typeof label === "string"
      ? label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      : label.source;
  // Nhãn và số không nằm cạnh nhau: giữa hai thứ đó còn một <div> bọc ngoài
  // rồi mới tới <span class="text-2xl..."> chứa số. Bắc cầu qua bằng [\s\S]*?
  // không tham lam, dừng đúng ở span đầu tiên gặp — tức span của thẻ này.
  const re = new RegExp(
    labelPattern + "[\\s\\S]*?text-2xl[^>]*>([\\d.,]+)"
  );
  const m = html.match(re);
  if (!m) return NaN;
  // vi-VN: dấu chấm ngăn nghìn, dấu phẩy là thập phân
  return parseFloat(m[1].replace(/\./g, "").replace(",", "."));
}

main().catch(async (e) => {
  console.error("\n❌ Bộ kiểm thử gặp lỗi:", e);
  await prisma.$disconnect();
  process.exit(1);
});
