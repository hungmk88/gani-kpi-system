/**
 * KIỂM THỬ BA VIỆC VẬN HÀNH
 *
 * Chạy khi server đang bật:  npm run test:ops
 *
 * Ba việc này không phải tính năng nghiệp vụ, mà là những thứ thiếu thì không
 * đưa hệ thống vào dùng thật được:
 *
 *   1. Đổi mật khẩu      — người dùng tự đổi, quản trị không còn giữ mật khẩu ai
 *   2. Nạp nhân sự Excel — thêm hàng loạt, sai một dòng là từ chối cả file
 *   3. Sao lưu           — bản sao mở được và có đủ dữ liệu, không phải file rác
 *
 * Phần đáng kiểm nhất ở đây là các đường VÒNG: đổi mật khẩu người khác, tạo
 * tài khoản quản trị bằng file Excel, nạp nửa vời rồi để lại đống dở dang.
 */
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import fs from "node:fs";
import { runBackup } from "./backup.mjs";

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

async function loginRaw(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* không có thân */
  }
  const cookie = (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
  return { status: res.status, body, cookie };
}

async function login(email, password = PASSWORD) {
  const r = await loginRaw(email, password);
  if (r.status !== 200) throw new Error(`Đăng nhập ${email} hỏng: ${r.status}`);
  return r.cookie;
}

function api(cookie) {
  return async (path, options = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        ...(options.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
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

/** Dựng file Excel nhân sự trong bộ nhớ, đúng khuôn của file mẫu. */
async function buildSheet(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("NHAN_SU");
  ws.addRow([
    "HO_TEN",
    "EMAIL",
    "MAT_KHAU_TAM",
    "VAI_TRO",
    "MA_PHONG_BAN",
    "CHUC_DANH",
    "DIEN_THOAI",
    "VAI_TRO_XUONG",
  ]);
  for (const r of rows) ws.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function upload(blob, name = "nhan-su.xlsx") {
  const fd = new FormData();
  fd.append("file", blob, name);
  return { method: "POST", body: fd };
}

const TEST_EMAILS = [
  "kt.nhap1@ganifoody.vn",
  "kt.nhap2@ganifoody.vn",
  "kt.nhap3@ganifoody.vn",
  "kt.doimk@ganifoody.vn",
];

async function main() {
  console.log(`\n🔬 KIỂM THỬ BA VIỆC VẬN HÀNH — ${BASE}\n`);

  for (let i = 0; i < 30; i++) {
    try {
      await fetch(`${BASE}/login`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // Dọn sạch trước, phòng lần chạy trước hỏng giữa chừng
  await prisma.user.deleteMany({ where: { email: { in: TEST_EMAILS } } });

  const admin = api(await login("admin@ganifoody.vn"));
  const ceo = api(await login("ceo@ganifoody.vn"));

  /* ============================================================ 1. ĐỔI MẬT KHẨU */
  console.log("TEST 1 — Nhân viên tự đổi mật khẩu");

  const sales = await prisma.department.findUnique({ where: { code: "SALES" } });

  const created = await admin("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email: "kt.doimk@ganifoody.vn",
      fullName: "Kiểm Thử Đổi Mật Khẩu",
      role: "EMPLOYEE",
      departmentId: sales.id,
      password: "TamThoi2026xy",
    }),
  });
  check("Quản trị tạo được tài khoản", created.status === 201, `status ${created.status}`);

  const fresh = await prisma.user.findUnique({
    where: { email: "kt.doimk@ganifoody.vn" },
  });
  check(
    "Tài khoản quản trị vừa tạo bị bắt phải tự đổi mật khẩu",
    fresh?.mustChangePassword === true
  );

  const weak = await admin("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email: "kt.yeu@ganifoody.vn",
      fullName: "Mật Khẩu Yếu",
      role: "EMPLOYEE",
      departmentId: sales.id,
      password: "12345678",
    }),
  });
  check(
    "Quản trị cũng không đặt được mật khẩu yếu cho người khác",
    weak.status === 400,
    `status ${weak.status}`
  );

  const firstLogin = await loginRaw("kt.doimk@ganifoody.vn", "TamThoi2026xy");
  check(
    "Đăng nhập lần đầu được, nhưng hệ thống báo phải đổi mật khẩu",
    firstLogin.status === 200 && firstLogin.body?.mustChangePassword === true
  );

  const newUser = api(firstLogin.cookie);

  const wrongCurrent = await newUser("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({
      currentPassword: "SaiBet2026xx",
      newPassword: "MatKhauMoi2026",
    }),
  });
  check(
    "Không biết mật khẩu hiện tại thì không đổi được",
    wrongCurrent.status === 400,
    `status ${wrongCurrent.status}`
  );

  const failedLog = await prisma.auditLog.findFirst({
    where: { action: "PASSWORD_CHANGE_FAILED", entityId: fresh.id },
  });
  check("Lần thử hỏng có vào nhật ký", !!failedLog);

  const tooWeak = await newUser("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({
      currentPassword: "TamThoi2026xy",
      newPassword: "abc123",
    }),
  });
  check("Mật khẩu mới quá ngắn thì bị từ chối", tooWeak.status === 400);

  const noDigit = await newUser("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({
      currentPassword: "TamThoi2026xy",
      newPassword: "khongcosonao",
    }),
  });
  check("Mật khẩu mới không có chữ số thì bị từ chối", noDigit.status === 400);

  const samplePw = await newUser("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({
      currentPassword: "TamThoi2026xy",
      newPassword: "Gani@2026",
    }),
  });
  check(
    "Không đặt lại đúng mật khẩu mẫu ghi trong tài liệu",
    samplePw.status === 400
  );

  const sameAsOld = await newUser("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({
      currentPassword: "TamThoi2026xy",
      newPassword: "TamThoi2026xy",
    }),
  });
  check("Mật khẩu mới trùng mật khẩu cũ thì bị từ chối", sameAsOld.status === 400);

  const okChange = await newUser("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({
      currentPassword: "TamThoi2026xy",
      newPassword: "RiengCuaToi2026",
    }),
  });
  check("Đổi mật khẩu hợp lệ thì thành công", okChange.status === 200);

  const afterChange = await prisma.user.findUnique({ where: { id: fresh.id } });
  check(
    "Đổi xong thì cờ bắt buộc đổi được gỡ",
    afterChange?.mustChangePassword === false
  );
  check("Có ghi lại thời điểm đổi", !!afterChange?.passwordChangedAt);

  const oldStillWorks = await loginRaw("kt.doimk@ganifoody.vn", "TamThoi2026xy");
  check("Mật khẩu cũ không dùng được nữa", oldStillWorks.status === 401);

  const newWorks = await loginRaw("kt.doimk@ganifoody.vn", "RiengCuaToi2026");
  check("Đăng nhập được bằng mật khẩu mới", newWorks.status === 200);
  check(
    "Vào thẳng hệ thống, không bị chặn lại nữa",
    newWorks.body?.mustChangePassword === false
  );

  const pwLog = await prisma.auditLog.findFirst({
    where: { action: "PASSWORD_CHANGE", entityId: fresh.id },
  });
  check("Việc đổi mật khẩu vào nhật ký", !!pwLog);
  check(
    "Nhật ký KHÔNG chứa mật khẩu",
    !JSON.stringify(pwLog ?? {}).includes("RiengCuaToi2026")
  );

  // Quản trị đặt lại hộ -> lại bị bắt tự đổi
  const reset = await admin(`/api/admin/users/${fresh.id}`, {
    method: "PATCH",
    body: JSON.stringify({ newPassword: "QuanTriDat2026" }),
  });
  check("Quản trị đặt lại được mật khẩu khi người dùng quên", reset.status === 200);

  const afterReset = await prisma.user.findUnique({ where: { id: fresh.id } });
  check(
    "Quản trị đặt hộ thì người đó lại bị bắt tự đổi ngay lần sau",
    afterReset?.mustChangePassword === true
  );

  /* -------- Đường vòng: cố đổi mật khẩu của NGƯỜI KHÁC --------
     Cố ý KHÔNG dùng tài khoản Ban Giám đốc làm kẻ tấn công ở đây: mật khẩu của
     nó là mật khẩu dùng chung của cả bộ kiểm thử, đổi đi rồi không đặt lại được
     (chính luật cấm mật khẩu mẫu chặn đường về). Dùng một tài khoản dùng một
     lần thì hỏng cũng không kéo theo ai. */
  const attackerLogin = await loginRaw("kt.doimk@ganifoody.vn", "QuanTriDat2026");
  const attacker = api(attackerLogin.cookie);

  const victimBefore = await prisma.user.findUnique({
    where: { email: "nv.sales1@ganifoody.vn" },
  });

  const sneak = await attacker("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({
      currentPassword: "QuanTriDat2026",
      newPassword: "ChiemTaiKhoan2026",
      userId: victimBefore.id,
      email: "nv.sales1@ganifoody.vn",
    }),
  });

  const victimAfter = await prisma.user.findUnique({ where: { id: victimBefore.id } });
  const attackerAfter = await prisma.user.findUnique({ where: { id: fresh.id } });

  check(
    "Gửi kèm userId người khác không đổi được mật khẩu của họ",
    victimAfter.passwordHash === victimBefore.passwordHash,
    `status ${sneak.status}`
  );
  check(
    "Nó chỉ đổi mật khẩu của chính người đang đăng nhập",
    sneak.status === 200 && attackerAfter.passwordHash !== afterReset.passwordHash
  );
  check(
    "Nạn nhân vẫn đăng nhập được bằng mật khẩu cũ của mình",
    (await loginRaw("nv.sales1@ganifoody.vn", PASSWORD)).status === 200
  );

  const anon = await fetch(`${BASE}/api/auth/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      currentPassword: "x",
      newPassword: "MatKhauMoi2026",
    }),
  });
  check("Chưa đăng nhập thì không gọi được", anon.status === 401);

  /* ======================================================= 2. NẠP NHÂN SỰ EXCEL */
  console.log("\nTEST 2 — Nạp nhân sự hàng loạt từ Excel");

  const tpl = await fetch(`${BASE}/api/admin/users/template`, {
    headers: { cookie: await login("admin@ganifoody.vn") },
  });
  check("Tải được file mẫu", tpl.status === 200);
  check(
    "File mẫu đúng định dạng Excel",
    (tpl.headers.get("content-type") ?? "").includes("spreadsheetml")
  );

  const empCookie = await login("nv.sales1@ganifoody.vn");
  const empTpl = await fetch(`${BASE}/api/admin/users/template`, {
    headers: { cookie: empCookie },
  });
  check("Nhân viên không tải được file mẫu nhân sự", empTpl.status === 403);

  const empImport = await api(empCookie)(
    "/api/admin/users/import",
    upload(await buildSheet([]))
  );
  check("Nhân viên không nạp được nhân sự", empImport.status === 403);

  const ceoImport = await ceo(
    "/api/admin/users/import",
    upload(await buildSheet([]))
  );
  check(
    "Ngay cả Ban Giám đốc cũng không nạp nhân sự — việc này của quản trị",
    ceoImport.status === 403
  );

  /* -------- File hợp lệ -------- */
  const goodSheet = await buildSheet([
    [
      "Kiểm Thử Một",
      "kt.nhap1@ganifoody.vn",
      "TamThoi2026aa",
      "EMPLOYEE",
      "SALES",
      "Nhân viên kinh doanh",
      "0900000001",
      "",
    ],
    [
      "Kiểm Thử Hai",
      "kt.nhap2@ganifoody.vn",
      "TamThoi2026bb",
      "MANAGER",
      "PROD",
      "Quản đốc",
      "",
      "SUPERVISOR",
    ],
  ]);
  const good = await admin("/api/admin/users/import", upload(goodSheet));
  check("Nạp được file hợp lệ", good.status === 200, JSON.stringify(good.body));
  check("Báo đúng số tài khoản đã tạo", good.body?.created === 2);

  const imported = await prisma.user.findMany({
    where: { email: { in: ["kt.nhap1@ganifoody.vn", "kt.nhap2@ganifoody.vn"] } },
    include: { department: true },
  });
  check("Cả hai tài khoản có thật trong database", imported.length === 2);
  check(
    "Gán đúng phòng ban theo mã trong file",
    imported.find((u) => u.email === "kt.nhap1@ganifoody.vn")?.department?.code ===
      "SALES"
  );
  check(
    "Vai trò xưởng được ghi nhận, tách riêng khỏi vai trò tổ chức",
    imported.find((u) => u.email === "kt.nhap2@ganifoody.vn")?.productionRole ===
      "SUPERVISOR"
  );
  check(
    "Mọi người nạp vào đều bị bắt tự đổi mật khẩu",
    imported.every((u) => u.mustChangePassword === true)
  );

  const importedLogin = await loginRaw("kt.nhap1@ganifoody.vn", "TamThoi2026aa");
  check(
    "Người nạp từ Excel đăng nhập được bằng mật khẩu tạm",
    importedLogin.status === 200
  );

  const importLog = await prisma.auditLog.findFirst({
    where: { action: "USER_IMPORT" },
    orderBy: { createdAt: "desc" },
  });
  check("Lượt nạp vào nhật ký", !!importLog);

  /* -------- Sai một dòng là từ chối cả file -------- */
  const mixedSheet = await buildSheet([
    [
      "Kiểm Thử Ba",
      "kt.nhap3@ganifoody.vn",
      "TamThoi2026cc",
      "EMPLOYEE",
      "SALES",
      "",
      "",
      "",
    ],
    [
      "Sai Phòng Ban",
      "kt.saipb@ganifoody.vn",
      "TamThoi2026dd",
      "EMPLOYEE",
      "KHONG_CO_MA_NAY",
      "",
      "",
      "",
    ],
  ]);
  const mixed = await admin("/api/admin/users/import", upload(mixedSheet));
  check("Có dòng sai thì cả file bị từ chối", mixed.status === 422);
  check("Nói rõ không tài khoản nào được tạo", mixed.body?.created === 0);
  check(
    "Chỉ đúng dòng nào sai và sai vì sao",
    (mixed.body?.errors ?? []).some(
      (e) => e.includes("Dòng 3") && e.includes("KHONG_CO_MA_NAY")
    ),
    JSON.stringify(mixed.body?.errors)
  );
  const three = await prisma.user.findUnique({
    where: { email: "kt.nhap3@ganifoody.vn" },
  });
  check(
    "Dòng ĐÚNG trong file hỏng cũng không được tạo — không nạp nửa vời",
    three === null
  );

  /* -------- Các đường vòng -------- */
  const adminSheet = await buildSheet([
    [
      "Kẻ Leo Quyền",
      "kt.leoquyen@ganifoody.vn",
      "TamThoi2026ee",
      "ADMIN",
      "SALES",
      "",
      "",
      "",
    ],
  ]);
  const adminTry = await admin("/api/admin/users/import", upload(adminSheet));
  check("Không tạo được tài khoản ADMIN bằng file Excel", adminTry.status === 422);
  check(
    "Không tạo được tài khoản Ban Giám đốc bằng file Excel",
    (
      await admin(
        "/api/admin/users/import",
        upload(
          await buildSheet([
            [
              "Giám Đốc Giả",
              "kt.ceogia@ganifoody.vn",
              "TamThoi2026ff",
              "CEO",
              "SALES",
              "",
              "",
              "",
            ],
          ])
        )
      )
    ).status === 422
  );

  const dupSheet = await buildSheet([
    ["Trùng Một", "kt.trung@ganifoody.vn", "TamThoi2026gg", "EMPLOYEE", "SALES", "", "", ""],
    ["Trùng Hai", "kt.trung@ganifoody.vn", "TamThoi2026hh", "EMPLOYEE", "SALES", "", "", ""],
  ]);
  const dup = await admin("/api/admin/users/import", upload(dupSheet));
  check(
    "Bắt được email trùng nhau ngay trong cùng một file",
    dup.status === 422 &&
      (dup.body?.errors ?? []).some((e) => e.includes("đã xuất hiện ở dòng"))
  );

  const existSheet = await buildSheet([
    ["Đã Có Rồi", "ceo@ganifoody.vn", "TamThoi2026ii", "EMPLOYEE", "SALES", "", "", ""],
  ]);
  const exist = await admin("/api/admin/users/import", upload(existSheet));
  check(
    "Bắt được email đã có tài khoản trong hệ thống",
    exist.status === 422 &&
      (exist.body?.errors ?? []).some((e) => e.includes("đã có tài khoản"))
  );

  const weakSheet = await buildSheet([
    ["Yếu Xìu", "kt.yeuxiu@ganifoody.vn", "123456", "EMPLOYEE", "SALES", "", "", ""],
  ]);
  const weakImport = await admin("/api/admin/users/import", upload(weakSheet));
  check(
    "Mật khẩu tạm yếu cũng bị chặn, không có cửa lách qua đường Excel",
    weakImport.status === 422
  );

  const badRole = await admin(
    "/api/admin/users/import",
    upload(
      await buildSheet([
        ["Sai Vai Xưởng", "kt.saivai@ganifoody.vn", "TamThoi2026jj", "EMPLOYEE", "SALES", "", "", "TO_TRUONG"],
      ])
    )
  );
  check("Vai trò xưởng viết sai bị bắt", badRole.status === 422);

  const emptyFile = await admin("/api/admin/users/import", upload(await buildSheet([])));
  check("File rỗng thì báo rõ, không im lặng", emptyFile.status === 422);

  const noFile = await admin("/api/admin/users/import", {
    method: "POST",
    body: new FormData(),
  });
  check("Không đính file thì báo lỗi rõ ràng", noFile.status === 400);

  /* ============================================================== 3. SAO LƯU */
  console.log("\nTEST 3 — Sao lưu database");

  const usersBefore = await prisma.user.count();
  const auditBefore = await prisma.auditLog.count();

  const bk = await runBackup({ quiet: true });
  check("Chạy được lệnh sao lưu", bk.skipped === false && !!bk.file);

  const bkPath = `${bk.dir}/${bk.file}`;
  check("File sao lưu có thật trên đĩa", fs.existsSync(bkPath));
  check("File sao lưu không rỗng", (bk.sizeBytes ?? 0) > 10_000);

  // Thứ đáng kiểm nhất: bản sao có MỞ ĐƯỢC và có ĐỦ dữ liệu không
  const copy = new PrismaClient({
    datasources: { db: { url: `file:${bkPath.replace(/\\/g, "/")}` } },
  });
  let copyUsers = -1;
  let copyAudit = -1;
  let copyOpens = true;
  try {
    copyUsers = await copy.user.count();
    copyAudit = await copy.auditLog.count();
  } catch {
    copyOpens = false;
  } finally {
    await copy.$disconnect();
  }

  check("Bản sao mở được như một database bình thường", copyOpens);
  check(
    "Bản sao có đủ tài khoản, không thiếu ai",
    copyUsers === usersBefore,
    `bản sao ${copyUsers} / bản gốc ${usersBefore}`
  );
  check(
    "Bản sao giữ nguyên nhật ký hệ thống",
    copyAudit === auditBefore,
    `bản sao ${copyAudit} / bản gốc ${auditBefore}`
  );

  // Chạy lại lần nữa trong cùng phút cũng không được vỡ
  const bk2 = await runBackup({ quiet: true });
  check("Chạy sao lưu hai lần liên tiếp không lỗi", bk2.skipped === false);
  check(
    "Có quy tắc giữ bản cũ, không để phình vô hạn",
    typeof bk2.kept === "number" && bk2.kept >= 1
  );

  /* ================================================================ DỌN DẸP */
  console.log("\nDọn dữ liệu kiểm thử...");
  const trash = await prisma.user.findMany({
    where: { email: { startsWith: "kt." } },
    select: { id: true },
  });
  const ids = trash.map((t) => t.id);
  await prisma.auditLog.updateMany({
    where: { userId: { in: ids } },
    data: { userId: null },
  });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  fs.rmSync(bkPath, { force: true });
  console.log(`  · đã xoá ${ids.length} tài khoản và file sao lưu của bài kiểm thử`);

  console.log(`\n${"─".repeat(56)}`);
  console.log(`KẾT QUẢ VẬN HÀNH: ${pass} đạt · ${fail} hỏng`);
  console.log("─".repeat(56) + "\n");

  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("\n❌ Bộ kiểm thử gặp lỗi:", e);
  await prisma.$disconnect();
  process.exit(1);
});
