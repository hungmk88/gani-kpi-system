import ExcelJS from "exceljs";
import { ROLES } from "./constants";
import { assertSheetRowLimit, loadWorkbook } from "./excel";
import { PRODUCTION_ROLES } from "./production/constants";

/**
 * FILE MẪU + BỘ ĐỌC DANH SÁCH NHÂN SỰ.
 *
 * Tách khỏi `lib/excel.ts` (file đó lo phần số KPI) vì hai thứ này khác nhau về
 * hậu quả: nạp sai số KPI thì sửa lại được, nạp sai danh sách nhân sự là tạo ra
 * tài khoản có quyền truy cập hệ thống. Nên bộ đọc này khắt khe hơn nhiều.
 */

const BRAND = "FF1B6EF5";
const HEADER_TEXT = "FFFFFFFF";

// Một nguồn duy nhất cho danh sách vai trò xưởng (trước đây chép lại ở đây,
// thêm vai trò mới bên xưởng là file mẫu lệch theo).
export { PRODUCTION_ROLES };

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
    "HỆ THỐNG CHO XEM TRƯỚC, CHƯA TẠO AI CẢ khi vừa chọn file.",
    "Màn xem trước liệt kê từng dòng: dòng sai tô đỏ, ghi rõ sai ở cột nào và vì sao;",
    "email đã có tài khoản thì tự bỏ qua. Chỉ khi anh bấm \"Nhập N dòng\" thì những",
    "dòng hợp lệ mới được tạo. Dòng sai sửa trong file rồi nạp lại cả file —",
    "những người đã tạo ở lần trước sẽ tự được bỏ qua, không tạo trùng.",
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

/** Một chỗ sai của một dòng: cột nào (tên cột trong file mẫu) và sai vì sao. */
export type RowIssue = { column: string | null; message: string };

export type ParsedUserRow = UserImportRow & { issues: RowIssue[] };

/**
 * Đọc file và kiểm tra những gì kiểm tra được mà không cần chạm database:
 * thiếu cột, sai định dạng, sai vai trò, và trùng email NGAY TRONG FILE.
 *
 * Trả về MỌI dòng (kể cả dòng sai) kèm danh sách chỗ sai của từng dòng — màn
 * xem trước cần vẽ đủ bảng, và một dòng sai hai chỗ thì báo cả hai chỗ một
 * lượt, không bắt người quản trị sửa xong chỗ này mới thấy chỗ kia.
 *
 * Việc đối chiếu với database (phòng ban có thật không, email đã tồn tại chưa)
 * để tầng dịch vụ làm, vì chỗ này cố ý không biết gì về database.
 */
export async function parseUserFile(buffer: ArrayBuffer): Promise<{
  rows: ParsedUserRow[];
  /** Lỗi cả file (không có sheet…), không gắn với dòng nào */
  fileErrors: string[];
}> {
  const wb = await loadWorkbook(buffer);

  const ws = wb.getWorksheet("NHAN_SU") ?? wb.worksheets[0];
  if (!ws) return { rows: [], fileErrors: ["File không có sheet dữ liệu nào."] };
  assertSheetRowLimit(ws);

  const rows: ParsedUserRow[] = [];
  const seenEmails = new Map<string, number>();

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // dòng tiêu đề

    const parsed: ParsedUserRow = {
      rowNumber,
      fullName: cellText(row.getCell(1)),
      email: cellText(row.getCell(2)).toLowerCase(),
      password: cellText(row.getCell(3)),
      role: cellText(row.getCell(4)).toUpperCase(),
      departmentCode: cellText(row.getCell(5)).toUpperCase(),
      jobTitle: cellText(row.getCell(6)) || null,
      phone: cellText(row.getCell(7)) || null,
      productionRole: cellText(row.getCell(8)).toUpperCase() || null,
      issues: [],
    };

    // Dòng trống hoàn toàn thì bỏ qua, không coi là lỗi
    if (!parsed.fullName && !parsed.email && !parsed.password) return;

    parsed.issues = validateUserRow(parsed, seenEmails);
    rows.push(parsed);
  });

  return { rows, fileErrors: [] };
}

/**
 * Kiểm tra một dòng (không cần database). Tách riêng để test được không cần
 * dựng file Excel. `seenEmails` ghi lại email đã gặp ở các dòng trước — dòng
 * nào gặp email trùng thì báo trùng với dòng nào.
 */
export function validateUserRow(
  r: UserImportRow,
  seenEmails: Map<string, number>
): RowIssue[] {
  const issues: RowIssue[] = [];

  if (!r.fullName || r.fullName.length < 2) {
    issues.push({ column: "HO_TEN", message: "Thiếu họ tên (tối thiểu 2 ký tự)." });
  }

  if (!r.email) {
    issues.push({ column: "EMAIL", message: "Thiếu email." });
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) {
    issues.push({ column: "EMAIL", message: `Email không hợp lệ ("${r.email}").` });
  } else {
    const dup = seenEmails.get(r.email);
    if (dup !== undefined) {
      issues.push({
        column: "EMAIL",
        message: `Email "${r.email}" đã xuất hiện ở dòng ${dup} trong file.`,
      });
    } else {
      seenEmails.set(r.email, r.rowNumber);
    }
  }

  if (!r.password) {
    issues.push({ column: "MAT_KHAU_TAM", message: "Thiếu mật khẩu tạm." });
  }

  if (!r.role) {
    issues.push({ column: "VAI_TRO", message: "Thiếu vai trò (EMPLOYEE hoặc MANAGER)." });
  } else if (r.role === "CEO" || r.role === "ADMIN") {
    // Chặn ngay ở bộ đọc, không đợi tầng dịch vụ: tạo quyền cao nhất của hệ
    // thống bằng một dòng Excel là đường leo thang quyền quá dễ.
    issues.push({
      column: "VAI_TRO",
      message: `Không tạo được tài khoản ${r.role} bằng file Excel. Vai trò này phải tạo tay trong mục Quản trị.`,
    });
  } else if (!(ROLES as readonly string[]).includes(r.role)) {
    issues.push({
      column: "VAI_TRO",
      message: `Vai trò "${r.role}" không có trong hệ thống. Chỉ nhận EMPLOYEE hoặc MANAGER.`,
    });
  }

  if (!r.departmentCode) {
    issues.push({ column: "MA_PHONG_BAN", message: "Thiếu mã phòng ban." });
  }

  if (
    r.productionRole &&
    !(PRODUCTION_ROLES as readonly string[]).includes(r.productionRole)
  ) {
    issues.push({
      column: "VAI_TRO_XUONG",
      message: `Vai trò xưởng "${r.productionRole}" không hợp lệ. Để trống hoặc dùng: ${PRODUCTION_ROLES.join(", ")}.`,
    });
  }

  return issues;
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
