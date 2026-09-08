/**
 * Nạp dữ liệu khởi tạo cho GANI FOODY - Work & KPI Management System.
 *
 * Chạy:  npm run db:seed
 * Chạy lại từ đầu (xoá sạch):  npm run db:reset
 *
 * Mật khẩu mặc định của MỌI tài khoản mẫu: Gani@2026
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { seedHistory } from "./seed-history.mjs";

try {
  process.loadEnvFile(".env");
} catch {
  // Node cũ hoặc chưa có .env - dựa vào biến môi trường sẵn có
}

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = "Gani@2026";

// ---------------------------------------------------------------- PHÒNG BAN
const DEPARTMENTS = [
  { code: "BOD", name: "Ban Giám đốc" },
  { code: "SALES", name: "Kinh doanh" },
  { code: "MKT", name: "Marketing" },
  { code: "PROD", name: "Sản xuất" },
  { code: "PROC", name: "Thu mua" },
  { code: "WH", name: "Kho vận" },
  { code: "ACC", name: "Kế toán" },
  { code: "OPS", name: "Vận hành" },
];

// ---------------------------------------------------------------- NHÂN SỰ
const USERS = [
  { email: "ceo@ganifoody.vn", fullName: "Nguyễn Văn Gia", jobTitle: "Tổng Giám đốc", role: "CEO", dept: "BOD" },
  { email: "admin@ganifoody.vn", fullName: "Quản trị hệ thống", jobTitle: "IT Admin", role: "ADMIN", dept: "BOD" },

  { email: "tp.sales@ganifoody.vn", fullName: "Trần Minh Sang", jobTitle: "Trưởng phòng Kinh doanh", role: "MANAGER", dept: "SALES" },
  { email: "nv.sales1@ganifoody.vn", fullName: "Lê Thị Hồng", jobTitle: "Nhân viên Kinh doanh", role: "EMPLOYEE", dept: "SALES" },
  { email: "nv.sales2@ganifoody.vn", fullName: "Phạm Quốc Huy", jobTitle: "Nhân viên Kinh doanh", role: "EMPLOYEE", dept: "SALES" },

  { email: "tp.mkt@ganifoody.vn", fullName: "Vũ Thanh Mai", jobTitle: "Trưởng phòng Marketing", role: "MANAGER", dept: "MKT" },
  { email: "nv.mkt1@ganifoody.vn", fullName: "Đỗ Gia Bảo", jobTitle: "Chuyên viên Content", role: "EMPLOYEE", dept: "MKT" },

  { email: "tp.prod@ganifoody.vn", fullName: "Hoàng Văn Phúc", jobTitle: "Quản đốc Xưởng", role: "MANAGER", dept: "PROD" },
  { email: "nv.prod1@ganifoody.vn", fullName: "Ngô Thị Lành", jobTitle: "Tổ trưởng Tổ chế biến", role: "EMPLOYEE", dept: "PROD" },
  { email: "nv.prod2@ganifoody.vn", fullName: "Bùi Văn Tài", jobTitle: "Nhân viên Vận hành máy", role: "EMPLOYEE", dept: "PROD" },

  { email: "nv.qc1@ganifoody.vn", fullName: "Nguyễn Thị Kim Chi", jobTitle: "Nhân viên KCS", role: "EMPLOYEE", dept: "PROD" },

  { email: "tp.proc@ganifoody.vn", fullName: "Đặng Hải Yến", jobTitle: "Trưởng phòng Thu mua", role: "MANAGER", dept: "PROC" },
  { email: "nv.proc1@ganifoody.vn", fullName: "Lý Trọng Nghĩa", jobTitle: "Nhân viên Thu mua", role: "EMPLOYEE", dept: "PROC" },

  { email: "tp.wh@ganifoody.vn", fullName: "Trịnh Công Định", jobTitle: "Trưởng kho", role: "MANAGER", dept: "WH" },
  { email: "nv.wh1@ganifoody.vn", fullName: "Mai Văn Lộc", jobTitle: "Thủ kho", role: "EMPLOYEE", dept: "WH" },

  { email: "tp.acc@ganifoody.vn", fullName: "Cao Thị Thu", jobTitle: "Kế toán trưởng", role: "MANAGER", dept: "ACC" },
  { email: "nv.acc1@ganifoody.vn", fullName: "Nguyễn Khánh Vy", jobTitle: "Kế toán công nợ", role: "EMPLOYEE", dept: "ACC" },

  { email: "tp.ops@ganifoody.vn", fullName: "Phan Đức Duy", jobTitle: "Trưởng phòng Vận hành", role: "MANAGER", dept: "OPS" },
  { email: "nv.ops1@ganifoody.vn", fullName: "Hồ Ngọc Ánh", jobTitle: "Điều phối giao hàng", role: "EMPLOYEE", dept: "OPS" },
];

// ---------------------------------------------------------------- BỘ CHỈ TIÊU KPI
// defaultWeight của các chỉ tiêu trong cùng 1 phòng ban cộng lại = 100
const KPI_DEFS = [
  // Kinh doanh
  { code: "SALES_REV", name: "Doanh thu thực thu trong tháng", dept: "SALES", unit: "VND", higher: true, source: "IPOS_API", weight: 40 },
  { code: "SALES_NEW", name: "Số khách hàng mới ký hợp đồng", dept: "SALES", unit: "khách", higher: true, source: "EXCEL", weight: 25 },
  { code: "SALES_DEBT", name: "Tỷ lệ công nợ quá hạn", dept: "SALES", unit: "%", higher: false, source: "EXCEL", weight: 20 },
  { code: "SALES_VISIT", name: "Số lượt viếng thăm khách hàng", dept: "SALES", unit: "lượt", higher: true, source: "MANUAL", weight: 15 },

  // Marketing
  { code: "MKT_LEAD", name: "Số lead thu về", dept: "MKT", unit: "lead", higher: true, source: "EXCEL", weight: 35 },
  { code: "MKT_CPL", name: "Chi phí trên mỗi lead", dept: "MKT", unit: "VND", higher: false, source: "EXCEL", weight: 30 },
  { code: "MKT_POST", name: "Số bài đăng đúng lịch", dept: "MKT", unit: "bài", higher: true, source: "MANUAL", weight: 20 },
  { code: "MKT_REACH", name: "Lượt tiếp cận tự nhiên", dept: "MKT", unit: "lượt", higher: true, source: "EXCEL", weight: 15 },

  // Sản xuất
  { code: "PROD_OUT", name: "Sản lượng thành phẩm", dept: "PROD", unit: "kg", higher: true, source: "EXCEL", weight: 35 },
  { code: "PROD_DEFECT", name: "Tỷ lệ hàng lỗi / trả về", dept: "PROD", unit: "%", higher: false, source: "EXCEL", weight: 30 },
  { code: "PROD_ONTIME", name: "Tỷ lệ đơn sản xuất đúng hạn", dept: "PROD", unit: "%", higher: true, source: "EXCEL", weight: 20 },
  { code: "PROD_SAFE", name: "Số sự cố an toàn thực phẩm", dept: "PROD", unit: "vụ", higher: false, source: "MANUAL", weight: 15 },

  // Thu mua
  { code: "PROC_COST", name: "Chênh lệch giá mua so với định mức", dept: "PROC", unit: "%", higher: false, source: "EXCEL", weight: 40 },
  { code: "PROC_ONTIME", name: "Tỷ lệ nguyên liệu về đúng hạn", dept: "PROC", unit: "%", higher: true, source: "EXCEL", weight: 35 },
  { code: "PROC_QC", name: "Tỷ lệ lô nguyên liệu đạt kiểm", dept: "PROC", unit: "%", higher: true, source: "MANUAL", weight: 25 },

  // Kho vận
  { code: "WH_ACC", name: "Độ chính xác tồn kho", dept: "WH", unit: "%", higher: true, source: "EXCEL", weight: 40 },
  { code: "WH_LOSS", name: "Tỷ lệ hao hụt hàng đông", dept: "WH", unit: "%", higher: false, source: "EXCEL", weight: 35 },
  { code: "WH_SHIP", name: "Tỷ lệ đơn xuất kho đúng giờ", dept: "WH", unit: "%", higher: true, source: "EXCEL", weight: 25 },

  // Kế toán
  { code: "ACC_CLOSE", name: "Số ngày chốt sổ sau cuối tháng", dept: "ACC", unit: "ngày", higher: false, source: "MANUAL", weight: 35 },
  { code: "ACC_DEBT", name: "Tỷ lệ thu hồi công nợ đến hạn", dept: "ACC", unit: "%", higher: true, source: "EXCEL", weight: 40 },
  { code: "ACC_ERR", name: "Số sai sót chứng từ bị phát hiện", dept: "ACC", unit: "lỗi", higher: false, source: "MANUAL", weight: 25 },

  // Vận hành
  { code: "OPS_DELIV", name: "Tỷ lệ giao hàng đúng hẹn", dept: "OPS", unit: "%", higher: true, source: "EXCEL", weight: 40 },
  { code: "OPS_COMPL", name: "Số khiếu nại khách hàng", dept: "OPS", unit: "vụ", higher: false, source: "MANUAL", weight: 35 },
  { code: "OPS_COST", name: "Chi phí giao hàng trên mỗi đơn", dept: "OPS", unit: "VND", higher: false, source: "EXCEL", weight: 25 },
];

// Chỉ tiêu và số thực tế mẫu để hệ thống có dữ liệu chạy thật
const TARGETS = {
  SALES_REV: { target: 400_000_000, actualSystem: 520_000_000, actualSelf: 520_000_000 },
  SALES_NEW: { target: 8, actualSystem: 6, actualSelf: 7 },
  SALES_DEBT: { target: 5, actualSystem: 7.2, actualSelf: 7.2 },
  SALES_VISIT: { target: 40, actualSystem: null, actualSelf: 44 },

  MKT_LEAD: { target: 300, actualSystem: 268, actualSelf: 268 },
  MKT_CPL: { target: 45_000, actualSystem: 52_000, actualSelf: 52_000 },
  MKT_POST: { target: 24, actualSystem: null, actualSelf: 26 },
  MKT_REACH: { target: 150_000, actualSystem: 191_000, actualSelf: 191_000 },

  PROD_OUT: { target: 12_000, actualSystem: 11_450, actualSelf: 12_600 }, // lệch 10% -> Data Mismatch
  PROD_DEFECT: { target: 1.5, actualSystem: 2.4, actualSelf: 2.4 },
  PROD_ONTIME: { target: 95, actualSystem: 91, actualSelf: 91 },
  PROD_SAFE: { target: 0, actualSystem: 0, actualSelf: 0 },

  PROC_COST: { target: 2, actualSystem: 1.4, actualSelf: 1.4 },
  PROC_ONTIME: { target: 95, actualSystem: 97, actualSelf: 97 },
  PROC_QC: { target: 98, actualSystem: null, actualSelf: 99 },

  WH_ACC: { target: 99, actualSystem: 97.5, actualSelf: 97.5 },
  WH_LOSS: { target: 1, actualSystem: 1.8, actualSelf: 1.8 },
  WH_SHIP: { target: 96, actualSystem: 94, actualSelf: 94 },

  ACC_CLOSE: { target: 5, actualSystem: null, actualSelf: 6 },
  ACC_DEBT: { target: 90, actualSystem: 86, actualSelf: 86 },
  ACC_ERR: { target: 2, actualSystem: null, actualSelf: 1 },

  OPS_DELIV: { target: 96, actualSystem: 93.5, actualSelf: 93.5 },
  OPS_COMPL: { target: 3, actualSystem: null, actualSelf: 5 },
  OPS_COST: { target: 25_000, actualSystem: 23_800, actualSelf: 23_800 },
};

// ------------------------------------------------- VAI TRÒ TRONG XƯỞNG
// Tách hẳn khỏi vai trò tổ chức: quản đốc vừa là MANAGER toàn công ty vừa là
// SUPERVISOR trong xưởng; KCS chỉ là EMPLOYEE nhưng nắm quyền xác nhận phẩm chất.
const PRODUCTION_ROLES = {
  "tp.prod@ganifoody.vn": "SUPERVISOR",
  "nv.prod1@ganifoody.vn": "TEAM_LEADER",
  "nv.prod2@ganifoody.vn": "WORKER",
  "nv.qc1@ganifoody.vn": "QC_OFFICER",
};

// ------------------------------------------------- DANH MỤC SKU
// Sản lượng chuẩn không vượt 500 kg/ca — trần của xưởng HCM01 do nút thắt
// máy hút chân không 50 kg/giờ nhân 10 giờ một ca (số trong Vault).
const SKUS = [
  {
    skuCode: "CHA-UC-GA-200G",
    skuName: "Chả ức gà viên 200g",
    targetOutputKg: 300,
    stdMaterialLossRate: 8,
  },
  {
    skuCode: "XX-VB-500G",
    skuName: "Xúc xích Vườn Bia 500g",
    targetOutputKg: 400,
    stdMaterialLossRate: 6,
  },
  {
    skuCode: "BO-VIEN-500G",
    skuName: "Bò viên 500g",
    targetOutputKg: 350,
    stdMaterialLossRate: 7,
  },
];

// ---------------------------------------------------------------- CÔNG VIỆC MẪU
const d = (offsetDays, hour = 17) => {
  const x = new Date();
  x.setDate(x.getDate() + offsetDays);
  x.setHours(hour, 0, 0, 0);
  return x;
};

const TASKS = [
  { title: "Chốt đơn hàng chả ức gà viên cho chuỗi 12 cửa hàng Q.Tân Bình", dept: "SALES", assignee: "nv.sales1@ganifoody.vn", creator: "tp.sales@ganifoody.vn", due: d(3), start: d(-4), priority: "HIGH", status: "IN_PROGRESS", progress: 60 },
  { title: "Thu hồi công nợ quá hạn nhóm khách sỉ Bình Tân", dept: "SALES", assignee: "nv.sales2@ganifoody.vn", creator: "tp.sales@ganifoody.vn", due: d(-2), start: d(-9), priority: "CRITICAL", status: "IN_PROGRESS", progress: 30 },
  { title: "Lên bộ 10 bài đăng ra mắt gói Tuần Đủ Đạm", dept: "MKT", assignee: "nv.mkt1@ganifoody.vn", creator: "tp.mkt@ganifoody.vn", due: d(5), start: d(-1), priority: "MEDIUM", status: "TO_DO", progress: 0 },
  { title: "Kiểm kê kho nguyên liệu ức gà tồn cuối tháng", dept: "WH", assignee: "nv.wh1@ganifoody.vn", creator: "tp.wh@ganifoody.vn", due: d(1), start: d(-2), priority: "HIGH", status: "IN_PROGRESS", progress: 45 },
  { title: "Xử lý lô hàng lỗi kích thước viên ngày 03", dept: "PROD", assignee: "nv.prod1@ganifoody.vn", creator: "tp.prod@ganifoody.vn", due: d(-1), start: d(-5), priority: "CRITICAL", status: "BLOCKED", progress: 40, blockedDaysAgo: 3 },
  { title: "Chuẩn hoá quy trình cấp đông đạt -18 độ trong 4 giờ", dept: "PROD", assignee: "nv.prod2@ganifoody.vn", creator: "tp.prod@ganifoody.vn", due: d(10), start: d(0), priority: "MEDIUM", status: "TO_DO", progress: 0 },
  { title: "Đàm phán lại giá ức gà với 3 nhà cung cấp", dept: "PROC", assignee: "nv.proc1@ganifoody.vn", creator: "tp.proc@ganifoody.vn", due: d(7), start: d(-3), priority: "HIGH", status: "IN_PROGRESS", progress: 50 },
  { title: "Đối soát hoá đơn giao hàng tháng trước với kế toán", dept: "ACC", assignee: "nv.acc1@ganifoody.vn", creator: "tp.acc@ganifoody.vn", due: d(2), start: d(-3), priority: "MEDIUM", status: "REVIEW", progress: 90 },
  { title: "Sắp tuyến giao hàng khu vực Hóc Môn - Q12", dept: "OPS", assignee: "nv.ops1@ganifoody.vn", creator: "tp.ops@ganifoody.vn", due: d(-3), start: d(-8), priority: "HIGH", status: "TO_DO", progress: 10 },
  { title: "Nghiệm thu mẫu bao bì hút chân không 200g", dept: "OPS", assignee: null, creator: "tp.ops@ganifoody.vn", due: d(4), start: d(-1), priority: "HIGH", status: "TO_DO", progress: 0 },
  { title: "Báo cáo doanh thu tuần gửi Ban Giám đốc", dept: "SALES", assignee: "nv.sales1@ganifoody.vn", creator: "tp.sales@ganifoody.vn", due: d(-6), start: d(-8), priority: "MEDIUM", status: "DONE", progress: 100 },
  { title: "Cập nhật bảng giá sỉ tháng mới lên hệ thống", dept: "SALES", assignee: "nv.sales2@ganifoody.vn", creator: "tp.sales@ganifoody.vn", due: d(-10), start: d(-12), priority: "LOW", status: "DONE", progress: 100 },
];

const PROJECTS = [
  { code: "PRJ-2026-001", name: "Ra mắt gói Tuần Đủ Đạm", dept: "MKT" },
  { code: "PRJ-2026-002", name: "Chuẩn hoá xưởng Đông Thạnh", dept: "PROD" },
];

// Quan hệ phụ thuộc: [việc phải chờ] ← [việc chờ]
// Nhờ mấy dây này mà biểu đồ Gantt có đường găng thật để nhìn.
const DEPENDENCIES = [
  {
    task: "Chuẩn hoá quy trình cấp đông đạt -18 độ trong 4 giờ",
    dependsOn: "Xử lý lô hàng lỗi kích thước viên ngày 03",
  },
  {
    task: "Lên bộ 10 bài đăng ra mắt gói Tuần Đủ Đạm",
    dependsOn: "Nghiệm thu mẫu bao bì hút chân không 200g",
  },
  {
    task: "Chốt đơn hàng chả ức gà viên cho chuỗi 12 cửa hàng Q.Tân Bình",
    dependsOn: "Lên bộ 10 bài đăng ra mắt gói Tuần Đủ Đạm",
  },
  {
    task: "Sắp tuyến giao hàng khu vực Hóc Môn - Q12",
    dependsOn: "Kiểm kê kho nguyên liệu ức gà tồn cuối tháng",
  },
];

// ---------------------------------------------------------------- CHẠY
async function main() {
  console.log("→ Đang nạp dữ liệu khởi tạo GANI FOODY...\n");

  // 1. Phòng ban
  const deptMap = {};
  for (const dept of DEPARTMENTS) {
    const row = await prisma.department.upsert({
      where: { code: dept.code },
      update: { name: dept.name },
      create: dept,
    });
    deptMap[dept.code] = row.id;
  }
  console.log(`  ✓ ${DEPARTMENTS.length} phòng ban`);

  // 2. Người dùng
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  const userMap = {};
  for (const u of USERS) {
    const row = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        fullName: u.fullName,
        jobTitle: u.jobTitle,
        role: u.role,
        departmentId: deptMap[u.dept],
      },
      create: {
        email: u.email,
        passwordHash,
        fullName: u.fullName,
        jobTitle: u.jobTitle,
        role: u.role,
        departmentId: deptMap[u.dept],
      },
    });
    userMap[u.email] = row;
  }
  for (const [email, prole] of Object.entries(PRODUCTION_ROLES)) {
    if (!userMap[email]) continue;
    await prisma.user.update({
      where: { email },
      data: { productionRole: prole },
    });
  }
  console.log(`  ✓ ${USERS.length} tài khoản (mật khẩu chung: ${DEFAULT_PASSWORD})`);
  console.log(
    `  ✓ ${Object.keys(PRODUCTION_ROLES).length} người được gán vai trò trong xưởng`
  );

  // 3. Chỉ tiêu KPI
  const kpiMap = {};
  for (const k of KPI_DEFS) {
    const row = await prisma.kpiDefinition.upsert({
      where: { code: k.code },
      update: {
        name: k.name,
        unit: k.unit,
        isHigherBetter: k.higher,
        dataSource: k.source,
        defaultWeight: k.weight,
        departmentId: deptMap[k.dept],
      },
      create: {
        code: k.code,
        name: k.name,
        unit: k.unit,
        isHigherBetter: k.higher,
        dataSource: k.source,
        defaultWeight: k.weight,
        departmentId: deptMap[k.dept],
      },
    });
    kpiMap[k.code] = row;
  }
  console.log(`  ✓ ${KPI_DEFS.length} chỉ tiêu KPI`);

  // 4. Dự án
  for (const p of PROJECTS) {
    await prisma.project.upsert({
      where: { code: p.code },
      update: {},
      create: { code: p.code, name: p.name, departmentId: deptMap[p.dept] },
    });
  }

  // 5. Công việc
  const existingTasks = await prisma.task.count();
  if (existingTasks === 0) {
    let i = 1;
    const year = new Date().getFullYear();
    for (const t of TASKS) {
      const blockedSince = t.blockedDaysAgo
        ? new Date(Date.now() - t.blockedDaysAgo * 86400000)
        : null;
      await prisma.task.create({
        data: {
          code: `TASK-${year}-${String(i++).padStart(4, "0")}`,
          title: t.title,
          departmentId: deptMap[t.dept],
          assigneeId: t.assignee ? userMap[t.assignee].id : null,
          creatorId: userMap[t.creator].id,
          startDate: t.start,
          dueDate: t.due,
          completedAt: t.status === "DONE" ? t.due : null,
          priority: t.priority,
          status: t.status,
          progress: t.progress,
          blockedSince,
        },
      });
    }
    console.log(`  ✓ ${TASKS.length} công việc mẫu`);
  } else {
    console.log(`  · Đã có ${existingTasks} công việc, bỏ qua phần tạo mẫu`);
  }

  // 5b. Quan hệ phụ thuộc giữa các công việc mẫu
  let depCount = 0;
  for (const d of DEPENDENCIES) {
    const [task, dependsOn] = await Promise.all([
      prisma.task.findFirst({ where: { title: d.task } }),
      prisma.task.findFirst({ where: { title: d.dependsOn } }),
    ]);
    if (!task || !dependsOn) continue;
    await prisma.taskDependency.upsert({
      where: {
        taskId_dependsOnId: { taskId: task.id, dependsOnId: dependsOn.id },
      },
      update: {},
      create: { taskId: task.id, dependsOnId: dependsOn.id },
    });
    depCount++;
  }
  console.log(`  ✓ ${depCount} quan hệ phụ thuộc (để Gantt có đường găng)`);

  // 6. Kỳ KPI của THÁNG HIỆN TẠI.
  // Cố ý lấy tháng này chứ không lấy tháng trước: hạn 2-4-5 của kỳ tháng này
  // rơi vào tháng sau nên còn hạn, anh vào là khai và duyệt được ngay.
  // Nếu lấy tháng trước, hạn đã trôi qua và hệ thống sẽ khoá đúng luật,
  // không bấm thử được luồng nào.
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const at = (day) => new Date(nextYear, nextMonth - 1, day, 23, 59, 59);

  const period = await prisma.kpiPeriod.upsert({
    where: { month_year: { month, year } },
    update: {},
    create: {
      month,
      year,
      name: `Tháng ${String(month).padStart(2, "0")}/${year}`,
      selfReviewDeadline: at(2),
      managerReviewDeadline: at(4),
      ceoApprovalDeadline: at(5),
      status: "OPEN",
    },
  });
  console.log(`  ✓ Kỳ KPI ${period.name} (hạn 2-4-5 tháng sau)`);

  // 7. Gán KPI cho từng nhân sự nghiệp vụ + nạp số hệ thống
  const bizUsers = USERS.filter((u) => u.role !== "ADMIN" && u.dept !== "BOD");
  let resultCount = 0;
  for (const u of bizUsers) {
    const defs = KPI_DEFS.filter((k) => k.dept === u.dept);
    for (const k of defs) {
      const t = TARGETS[k.code];
      if (!t) continue;
      // Nhân viên và trưởng phòng lệch chỉ tiêu một chút cho thực tế
      const factor = u.role === "MANAGER" ? 1 : 0.9;
      await prisma.kpiResult.upsert({
        where: {
          periodId_employeeId_kpiDefinitionId: {
            periodId: period.id,
            employeeId: userMap[u.email].id,
            kpiDefinitionId: kpiMap[k.code].id,
          },
        },
        update: {},
        create: {
          periodId: period.id,
          employeeId: userMap[u.email].id,
          kpiDefinitionId: kpiMap[k.code].id,
          weightPercent: k.weight,
          targetValue: round2(t.target * factor),
          actualSystem: t.actualSystem === null ? null : round2(t.actualSystem * factor),
          status: "DRAFT",
        },
      });
      resultCount++;
    }
  }
  console.log(`  ✓ ${resultCount} dòng KPI được gán cho ${bizUsers.length} nhân sự`);

  // 8. Cấu hình hệ thống
  const settings = [
    { key: "KPI_SCORE_CAP", value: "150", label: "Trần điểm KPI (%)" },
    { key: "DEADLINE_SELF", value: "2", label: "Ngày chốt tự khai của nhân viên" },
    { key: "DEADLINE_MANAGER", value: "4", label: "Ngày chốt duyệt của trưởng phòng" },
    { key: "DEADLINE_CEO", value: "5", label: "Ngày Ban Giám đốc duyệt" },
    { key: "MISMATCH_THRESHOLD", value: "5", label: "Ngưỡng lệch số liệu cảnh báo (%)" },
    { key: "ALLOW_CROSS_DEPT_ASSIGN", value: "false", label: "Cho phép giao việc vượt cấp" },
    { key: "COMPANY_NAME", value: "GANI FOODY", label: "Tên công ty" },
  ];
  for (const s of settings) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: { value: s.value, label: s.label },
      create: s,
    });
  }
  console.log(`  ✓ ${settings.length} cấu hình hệ thống`);

// 8b. Nguồn tích hợp mẫu + một ô lệch số để bảng Đối soát có cái mà xem.
  // Bỏ qua vì model integrationSource và kpiActualFeed chưa có trong schema Phase 1.

// 8c. Danh mục SKU và một ca sản xuất mẫu đang chờ KCS xác nhận.
  // Dựng sẵn một ca ở bước 1 để mở lên là thấy ngay luồng 3 bước hoạt động
  // thế nào, thay vì phải tự khai từ đầu mới hiểu.
  const skuMap = {};
  for (const sku of SKUS) {
    const row = await prisma.productSku.upsert({
      where: { skuCode: sku.skuCode },
      update: {},
      create: sku,
    });
    skuMap[sku.skuCode] = row;
  }
  console.log(`  ✓ ${SKUS.length} mã sản phẩm kèm chuẩn sản lượng và định mức`);

  const existingShifts = await prisma.productionShiftLog.count();
  if (existingShifts === 0 && skuMap["XX-VB-500G"]) {
    const shiftDay = new Date();
    shiftDay.setDate(shiftDay.getDate() - 1);
    shiftDay.setHours(0, 0, 0, 0);

    const crew = [
      { email: "nv.prod1@ganifoody.vn", stage: "TAO_HINH", hours: 10 },
      { email: "nv.prod2@ganifoody.vn", stage: "DONG_GOI", hours: 10 },
      { email: "tp.prod@ganifoody.vn", stage: "LAM_CHIN", hours: 8 },
    ].filter((c) => userMap[c.email]);

    await prisma.productionShiftLog.create({
      data: {
        shiftDate: shiftDay,
        shiftType: "CA_1",
        skuId: skuMap["XX-VB-500G"].id,
        status: "DRAFT",
        // Số lấy đúng theo ví dụ trong bản thiết kế anh gửi:
        // thô 1.030 kg, NVL cấp 1.120 kg, chuẩn 400 kg + hao hụt 6%
        rawOutputKg: 430,
        totalLaborHours: crew.reduce((s, c) => s + c.hours, 0),
        downtimeHours: 1.5,
        rawMaterialInputKg: 470,
        draftNote: "Lô thịt đông rã nước nhiều hơn thường lệ.",
        createdById: userMap["tp.prod@ganifoody.vn"].id,
        participants: {
          create: crew.map((c) => ({
            userId: userMap[c.email].id,
            stage: c.stage,
            hoursWorked: c.hours,
            scheduledHours: 10,
          })),
        },
      },
    });
    console.log("  ✓ 1 ca sản xuất mẫu đang chờ KCS xác nhận");
  }

  // 8d. Lịch sử cho phần Phân tích & Dự báo (Phase 4).
  // Không có quá khứ thì ba engine của Phase 4 mở lên chỉ báo "chưa đủ dữ liệu".
  await seedHistory({
    prisma,
    deptMap,
    userMap,
    kpiMap,
    users: USERS,
    kpiDefs: KPI_DEFS,
    targets: TARGETS,
    month,
    year,
  });

  // 9. Nhờ server chấm điểm rủi ro cho đống việc vừa tạo.
  // Logic chấm rủi ro chỉ có một bản duy nhất nằm trong lib/risk.ts, nên ở đây
  // gọi sang server thay vì chép lại công thức (chép là sớm muộn cũng lệch nhau).
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const cronSecret = process.env.CRON_SECRET || "";
  try {
    const res = await fetch(`${appUrl}/api/cron/run`, {
      method: "POST",
      headers: { "x-cron-secret": cronSecret },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const data = await res.json();
      console.log(
        `  ✓ Đã chấm điểm rủi ro cho ${data.riskScan.scanned} công việc`
      );
    } else {
      console.log("  · Không chấm được điểm rủi ro (server từ chối).");
    }
  } catch {
    console.log(
      "  · Server chưa chạy nên chưa chấm điểm rủi ro. Sau khi bật server,"
    );
    console.log(
      "    vào Bảng điều hành bấm 'Quét lại rủi ro ngay' là xong (hoặc chạy npm run scheduler)."
    );
  }

  console.log("\n✅ XONG. Đăng nhập thử bằng:");
  console.log("   Ban Giám đốc : ceo@ganifoody.vn");
  console.log("   Trưởng phòng : tp.sales@ganifoody.vn");
  console.log("   Nhân viên    : nv.sales1@ganifoody.vn");
  console.log("   Quản trị     : admin@ganifoody.vn");
  console.log("   KCS (xưởng)  : nv.qc1@ganifoody.vn");
  console.log("   Quản đốc     : tp.prod@ganifoody.vn");
  console.log(`   Mật khẩu chung: ${DEFAULT_PASSWORD}\n`);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

main()
  .catch((e) => {
    console.error("❌ Nạp dữ liệu thất bại:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
