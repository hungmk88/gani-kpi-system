import ExcelJS from "exceljs";
import { ROLES } from "./constants";
import { assertSheetRowLimit, loadWorkbook } from "./excel";

/**
 * FILE MẪU + BỘ ĐỌC DANH SÁCH NHÂN SỰ.
 *
 * Tách khỏi `lib/excel.ts` (file đó lo phần số KPI) vì hai thứ này khác nhau về
 * hậu quả: nạp sai số KPI thì sửa lại được, nạp sai danh sách nhân sự là tạo ra
 * tài khoản có quyền truy cập hệ thống. Nên bộ đọc này khắt khe hơn nhiều.
 */

const BRAND = "FF1B6EF5";
const HEADER_TEXT = "FFFFFFFF";

export const PRODUCTION_ROLES = [
  "WORKER",
  "TEAM_LEADER",
  "SUPERVISOR",
  "QC_OFFICER",
  "PRODUCTION_DIRECTOR",
] as const;

/* ------------------------------------------------------------- FILE MẪU */

export async function buildUserTemplate(
  departments: { code: string; name: string }[]
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "GANI FOODY KPI System";
  wb.created = new Date();

  const ws = wb.addWorksheet("NHAN_SU");
  ws.columns = [
    { header: "HO_TEN", key: "fullName", width: 26 },
    { header: "EMAIL", key: "email", width: 30 },
    { header: "MAT_KHAU_TAM", key: "password", width: 20 },
    { header: "VAI_TRO", key: "role", width: 14 },
    { header: "MA_PHONG_BAN", key: "dept", width: 16 },
    { header: "CHUC_DANH", key: "jobTitle", width: 26 },
    { header: "DIEN_THOAI", key: "phone", width: 16 },
    { header: "VAI_TRO_XUONG", key: "productionRole", width: 20 },
  ];
  styleHeader(ws.getRow(1));

  ws.addRow({
    fullName: "Nguyễn Văn A",
    email: "nguyen.van.a@ganifoody.vn",
    password: "GaniTam2026a",
    role: "EMPLOYEE",
    dept: departments[0]?.code ?? "SALES",
    jobTitle: "Nhân viên kinh doanh",
    phone: "0900000000",
    productionRole: "",
  });

  const guide = wb.addWorksheet("HUONG_DAN");
  guide.columns = [{ width: 104 }];
  [
    "CÁCH DÙNG FILE NÀY",
    "",
    "1. Mỗi dòng trong sheet NHAN_SU là một người. Xoá dòng ví dụ có sẵn trước khi nạp.",
    "2. EMAIL phải là email công ty, không trùng với người đã có trong hệ thống.",
    "3. MAT_KHAU_TAM là mật khẩu tạm để người đó đăng nhập lần đầu.",
    "   Tối thiểu 10 ký tự, có cả chữ và số, không khoảng trắng.",
    "   Người đó BẮT BUỘC phải tự đổi mật khẩu ngay lần đăng nhập đầu tiên,",
    "   nên đừng bận tâm đặt cho hay — chỉ cần khác nhau giữa các người.",
    "4. VAI_TRO: EMPLOYEE (nhân viên) hoặc MANAGER (trưởng phòng).",
    "   Hệ thống KHÔNG cho tạo CEO hay ADMIN bằng file — hai vai trò đó phải tạo tay.",
    "5. MA_PHONG_BAN: chép đúng mã ở sheet DANH_MUC_PHONG_BAN.",
    "6. VAI_TRO_XUONG: chỉ điền cho người làm ở xưởng, để trống nếu không.",
    "   Giá trị hợp lệ: " + PRODUCTION_ROLES.join(" / "),
    "   Vai trò xưởng TÁCH RIÊNG khỏi vai trò tổ chức: một nhân viên bình thường",
    "   vẫn có thể là QC_OFFICER và có quyền xác nhận phẩm chất ca sản xuất.",
    "7. Lưu file rồi vào Quản trị > Tài khoản > Nạp nhân sự từ Excel.",
    "",
    "HỆ THỐNG SẼ TỪ CHỐI CẢ FILE nếu có bất kỳ dòng nào sai.",
    "Lý do: nạp nửa vời thì không biết ai đã vào ai chưa, sửa lại còn mệt hơn làm lại.",
    "Máy sẽ liệt kê từng dòng sai và sai vì sao, anh sửa rồi nạp lại.",
  ].forEach((line) => guide.addRow([line]));
  guide.getRow(1).font = { bold: true, size: 14 };

  const dm = wb.addWorksheet("DANH_MUC_PHONG_BAN");
  dm.columns = [
    { header: "MA_PHONG_BAN", key: "code", width: 18 },
    { header: "TEN_PHONG_BAN", key: "name", width: 32 },
  ];
  styleHeader(dm.getRow(1));
  departments.forEach((d) => dm.addRow(d));

  return wb.xlsx.writeBuffer();
}

/* ------------------------------------------------------------- BỘ ĐỌC */

export type UserImportRow = {
  rowNumber: number;
  fullName: string;
  email: string;
  password: string;
  role: string;
  departmentCode: string;
  jobTitle: string | null;
  phone: string | null;
  productionRole: string | null;
};

/**
 * Đọc file và kiểm tra những gì kiểm tra được mà không cần chạm database:
 * thiếu cột, sai định dạng, sai vai trò, và trùng email NGAY TRONG FILE.
 *
 * Việc đối chiếu với database (phòng ban có thật không, email đã tồn tại chưa)
 * để tầng dịch vụ làm, vì chỗ này cố ý không biết gì về database.
 */
export async function parseUserFile(buffer: ArrayBuffer): Promise<{
  rows: UserImportRow[];
  errors: string[];
}> {
  const wb = await loadWorkbook(buffer);

  const ws = wb.getWorksheet("NHAN_SU") ?? wb.worksheets[0];
  if (!ws) return { rows: [], errors: ["File không có sheet dữ liệu nào."] };
  assertSheetRowLimit(ws);

  const rows: UserImportRow[] = [];
  const errors: string[] = [];
  const seenEmails = new Map<string, number>();

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // dòng tiêu đề

    const fullName = cellText(row.getCell(1));
    const email = cellText(row.getCell(2)).toLowerCase();
    const password = cellText(row.getCell(3));
    const role = cellText(row.getCell(4)).toUpperCase();
    const departmentCode = cellText(row.getCell(5)).toUpperCase();
    const jobTitle = cellText(row.getCell(6));
    const phone = cellText(row.getCell(7));
    const productionRole = cellText(row.getCell(8)).toUpperCase();

    // Dòng trống hoàn toàn thì bỏ qua, không coi là lỗi
    if (!fullName && !email && !password) return;

    const at = `Dòng ${rowNumber}`;

    if (!fullName || fullName.length < 2) {
      errors.push(`${at}: thiếu HO_TEN.`);
      return;
    }
    if (!email) {
      errors.push(`${at}: thiếu EMAIL.`);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push(`${at}: EMAIL không hợp lệ ("${email}").`);
      return;
    }
    const dup = seenEmails.get(email);
    if (dup !== undefined) {
      errors.push(`${at}: EMAIL "${email}" đã xuất hiện ở dòng ${dup}.`);
      return;
    }
    seenEmails.set(email, rowNumber);

    if (!password) {
      errors.push(`${at}: thiếu MAT_KHAU_TAM.`);
      return;
    }
    if (!role) {
      errors.push(`${at}: thiếu VAI_TRO.`);
      return;
    }
    if (!(ROLES as readonly string[]).includes(role)) {
      errors.push(
        `${at}: VAI_TRO "${role}" không có trong hệ thống. Chỉ nhận EMPLOYEE hoặc MANAGER.`
      );
      return;
    }
    // Chặn ngay ở bộ đọc, không đợi tầng dịch vụ: tạo quyền cao nhất của hệ
    // thống bằng một dòng Excel là đường leo thang quyền quá dễ.
    if (role === "CEO" || role === "ADMIN") {
      errors.push(
        `${at}: không tạo được tài khoản ${role} bằng file Excel. Vai trò này phải tạo tay trong mục Quản trị.`
      );
      return;
    }
    if (!departmentCode) {
      errors.push(`${at}: thiếu MA_PHONG_BAN.`);
      return;
    }
    if (
      productionRole &&
      !(PRODUCTION_ROLES as readonly string[]).includes(productionRole)
    ) {
      errors.push(
        `${at}: VAI_TRO_XUONG "${productionRole}" không hợp lệ. Để trống hoặc dùng: ${PRODUCTION_ROLES.join(", ")}.`
      );
      return;
    }

    rows.push({
      rowNumber,
      fullName,
      email,
      password,
      role,
      departmentCode,
      jobTitle: jobTitle || null,
      phone: phone || null,
      productionRole: productionRole || null,
    });
  });

  return { rows, errors };
}

/* --------------------------------------------------------- tiện ích nội bộ */

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: HEADER_TEXT } };
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };
  });
  row.height = 24;
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "result" in v) return String(v.result ?? "").trim();
  if (typeof v === "object" && "text" in v) return String(v.text ?? "").trim();
  if (typeof v === "object" && "hyperlink" in v)
    return String((v as { text?: string }).text ?? "").trim();
  return String(v).trim();
}
