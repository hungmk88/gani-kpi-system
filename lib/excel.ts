import { SHIFT_TYPES, SHIFT_TYPE_LABEL } from "./production/constants";
import ExcelJS from "exceljs";
import type {
  DashboardSummaryResult,
  DashboardDistributionResult,
  DashboardTrendsResult,
} from "./services/kpi-dashboard";
import { BusinessError } from "./rbac";
import { ERR } from "./constants";
import { formatVnDate, formatVnDateTime, vnParts } from "./vn-time";

/* ------------------------------------------------- GIỚI HẠN FILE NHẬP */

/** File nhập tối đa 5 MB — đủ cho vài chục nghìn dòng, chặn file rác làm treo máy. */
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
/** Tối đa 5000 dòng dữ liệu mỗi file (không tính dòng tiêu đề). */
export const MAX_IMPORT_ROWS = 5000;

/**
 * Chặn sớm theo header Content-Length, TRƯỚC khi đọc cả form vào bộ nhớ.
 * Cho dư 1 MB cho phần vỏ multipart.
 */
export function assertImportRequestSize(req: Request) {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(len) && len > MAX_IMPORT_FILE_BYTES + 1024 * 1024) {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      "File quá lớn. Dung lượng tối đa 5 MB — hãy chia nhỏ file rồi nạp từng phần.",
      413
    );
  }
}

/** Kiểm tra file người dùng gửi lên: có file, không rỗng, không quá 5 MB. */
export function assertImportFile(file: FormDataEntryValue | null): File {
  if (!(file instanceof File)) {
    throw new BusinessError(ERR.VALIDATION_FAILED, "Chưa chọn file Excel.", 400);
  }
  if (file.size === 0) {
    throw new BusinessError(ERR.VALIDATION_FAILED, "File rỗng.", 400);
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      `File quá lớn (${(file.size / 1024 / 1024).toFixed(1)} MB). Dung lượng tối đa 5 MB — hãy chia nhỏ file rồi nạp từng phần.`,
      413
    );
  }
  return file;
}

/** Mở workbook; file hỏng / không phải .xlsx thì báo lỗi rõ ràng thay vì lỗi 500. */
export async function loadWorkbook(buffer: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      "Không đọc được file. Hãy dùng đúng file Excel (.xlsx) tải từ file mẫu.",
      400
    );
  }
  return wb;
}

/** Chặn sheet quá nhiều dòng trước khi duyệt từng dòng. */
export function assertSheetRowLimit(ws: ExcelJS.Worksheet) {
  // actualRowCount = số dòng có dữ liệu, gồm cả dòng tiêu đề
  const dataRows = Math.max(0, ws.actualRowCount - 1);
  if (dataRows > MAX_IMPORT_ROWS) {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      `File có ${dataRows} dòng dữ liệu, vượt giới hạn ${MAX_IMPORT_ROWS} dòng mỗi lần nạp. Hãy chia nhỏ file.`,
      413
    );
  }
}

const BRAND = "FF1B6EF5";
const HEADER_TEXT = "FFFFFFFF";

/* ------------------------------------------------------------ FILE MẪU NHẬP */

/**
 * File mẫu để phòng ban/kế toán đổ số thực tế vào rồi nạp lên hệ thống.
 * Cột cố định, có sheet hướng dẫn kèm danh mục mã KPI.
 */
export async function buildImportTemplate(
  kpiDefs: { code: string; name: string; unit: string; department: string }[],
  users: { email: string; fullName: string; department: string }[]
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "GANI FOODY KPI System";
  wb.created = new Date();

  const ws = wb.addWorksheet("DU_LIEU");
  ws.columns = [
    { header: "MA_KPI", key: "code", width: 18 },
    { header: "EMAIL_NHAN_VIEN", key: "email", width: 30 },
    { header: "THANG", key: "month", width: 10 },
    { header: "NAM", key: "year", width: 10 },
    { header: "GIA_TRI_THUC_TE", key: "value", width: 20 },
  ];
  styleHeader(ws.getRow(1));

  // Dòng ví dụ: tháng trước theo lịch VN
  const nowVn = vnParts();
  const m = nowVn.month === 1 ? 12 : nowVn.month - 1;
  const y = nowVn.month === 1 ? nowVn.year - 1 : nowVn.year;
  if (kpiDefs[0] && users[0]) {
    ws.addRow({
      code: kpiDefs[0].code,
      email: users[0].email,
      month: m,
      year: y,
      value: 0,
    });
  }

  const guide = wb.addWorksheet("HUONG_DAN");
  guide.columns = [{ width: 100 }];
  [
    "CÁCH DÙNG FILE NÀY",
    "",
    "1. Điền dữ liệu vào sheet DU_LIEU, mỗi dòng là một con số thực tế của một nhân viên cho một chỉ tiêu.",
    "2. MA_KPI: chép đúng mã ở sheet DANH_MUC_KPI.",
    "3. EMAIL_NHAN_VIEN: chép đúng email ở sheet DANH_SACH_NHAN_SU.",
    "4. THANG / NAM: kỳ đánh giá, ví dụ tháng 8 năm 2026 thì ghi 8 và 2026.",
    "5. GIA_TRI_THUC_TE: chỉ ghi số, không ghi đơn vị, không ghi dấu chấm phân cách nghìn.",
    "6. Lưu file rồi vào hệ thống, mở bảng KPI của kỳ, bấm 'Nạp số từ Excel'.",
    "",
    "LƯU Ý: số nạp từ file này vào cột 'Số hệ thống'. Nếu nhân viên tự khai lệch quá 5% so với số này,",
    "hệ thống sẽ tự bật cờ cảnh báo lệch số liệu và báo về Ban Giám đốc.",
  ].forEach((line) => guide.addRow([line]));
  guide.getRow(1).font = { bold: true, size: 14 };

  const dm = wb.addWorksheet("DANH_MUC_KPI");
  dm.columns = [
    { header: "MA_KPI", key: "code", width: 18 },
    { header: "TEN_CHI_TIEU", key: "name", width: 45 },
    { header: "DON_VI", key: "unit", width: 12 },
    { header: "PHONG_BAN", key: "department", width: 22 },
  ];
  styleHeader(dm.getRow(1));
  kpiDefs.forEach((k) => dm.addRow(k));

  const ns = wb.addWorksheet("DANH_SACH_NHAN_SU");
  ns.columns = [
    { header: "EMAIL", key: "email", width: 30 },
    { header: "HO_TEN", key: "fullName", width: 28 },
    { header: "PHONG_BAN", key: "department", width: 22 },
  ];
  styleHeader(ns.getRow(1));
  users.forEach((u) => ns.addRow(u));

  return wb.xlsx.writeBuffer();
}

/* ------------------------------------------------------------ ĐỌC FILE NHẬP */

export type ImportRow = {
  rowNumber: number;
  code: string;
  email: string;
  month: number;
  year: number;
  value: number;
};

export async function parseImportFile(buffer: ArrayBuffer): Promise<{
  rows: ImportRow[];
  errors: string[];
}> {
  const wb = await loadWorkbook(buffer);

  const ws = wb.getWorksheet("DU_LIEU") ?? wb.worksheets[0];
  if (!ws) return { rows: [], errors: ["File không có sheet dữ liệu nào."] };
  assertSheetRowLimit(ws);

  const rows: ImportRow[] = [];
  const errors: string[] = [];

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // dòng tiêu đề

    const code = cellText(row.getCell(1));
    const email = cellText(row.getCell(2)).toLowerCase();
    const month = Number(cellText(row.getCell(3)));
    const year = Number(cellText(row.getCell(4)));
    const rawValue = cellText(row.getCell(5)).replace(/[,\s]/g, "");
    const value = Number(rawValue);

    if (!code && !email) return; // dòng trống

    if (!code) {
      errors.push(`Dòng ${rowNumber}: thiếu MA_KPI.`);
      return;
    }
    if (!email) {
      errors.push(`Dòng ${rowNumber}: thiếu EMAIL_NHAN_VIEN.`);
      return;
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      errors.push(`Dòng ${rowNumber}: THANG không hợp lệ ("${month}").`);
      return;
    }
    if (!Number.isInteger(year) || year < 2020) {
      errors.push(`Dòng ${rowNumber}: NAM không hợp lệ ("${year}").`);
      return;
    }
    if (!Number.isFinite(value)) {
      errors.push(
        `Dòng ${rowNumber}: GIA_TRI_THUC_TE phải là số ("${rawValue}").`
      );
      return;
    }

    rows.push({ rowNumber, code, email, month, year, value });
  });

  return { rows, errors };
}

/* ------------------------------------------------------------ XUẤT BÁO CÁO */

export type ExportRow = {
  department: string;
  employee: string;
  employeeCode: string;
  jobTitle: string;
  kpiName: string;
  unit: string;
  direction: string;
  weight: number;
  target: number;
  actualSystem: number | null;
  actualSelf: number | null;
  actualFinal: number | null;
  achievement: number;
  score: number;
  capped: boolean;
  mismatch: boolean;
  status: string;
};

export async function buildKpiReport(
  periodName: string,
  rows: ExportRow[],
  totals: { employee: string; department: string; weight: number; score: number; rank: string }[]
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "GANI FOODY KPI System";
  wb.created = new Date();

  /* --- Sheet 1: tổng hợp theo nhân sự --- */
  const sum = wb.addWorksheet("TONG_HOP");
  sum.mergeCells("A1:F1");
  sum.getCell("A1").value = `BẢNG TỔNG HỢP KPI — ${periodName}`;
  sum.getCell("A1").font = { bold: true, size: 14 };
  sum.getCell("A1").alignment = { horizontal: "center" };
  sum.addRow([]);

  sum.addRow(["STT", "Họ tên", "Phòng ban", "Tổng trọng số (%)", "Tổng điểm", "Xếp loại"]);
  sum.columns = [
    { width: 6 },
    { width: 28 },
    { width: 20 },
    { width: 18 },
    { width: 14 },
    { width: 18 },
  ];
  styleHeader(sum.getRow(3));

  totals.forEach((t, i) => {
    const r = sum.addRow([
      i + 1,
      t.employee,
      t.department,
      t.weight,
      Number(t.score.toFixed(2)),
      t.rank,
    ]);
    r.getCell(5).numFmt = "0.00";
    if (t.score < 70) r.getCell(6).font = { color: { argb: "FFC00000" }, bold: true };
    else if (t.score >= 120)
      r.getCell(6).font = { color: { argb: "FF108050" }, bold: true };
  });

  /* --- Sheet 2: chi tiết từng dòng --- */
  const det = wb.addWorksheet("CHI_TIET");
  det.columns = [
    { header: "Phòng ban", key: "department", width: 18 },
    { header: "Mã NV", key: "employeeCode", width: 12 },
    { header: "Họ tên", key: "employee", width: 26 },
    { header: "Chức danh", key: "jobTitle", width: 24 },
    { header: "Chỉ tiêu", key: "kpiName", width: 40 },
    { header: "Đơn vị", key: "unit", width: 10 },
    { header: "Chiều", key: "direction", width: 18 },
    { header: "Trọng số (%)", key: "weight", width: 13 },
    { header: "Chỉ tiêu giao", key: "target", width: 16 },
    { header: "Số hệ thống", key: "actualSystem", width: 16 },
    { header: "NV tự khai", key: "actualSelf", width: 15 },
    { header: "Số chốt", key: "actualFinal", width: 16 },
    { header: "Mức đạt (%)", key: "achievement", width: 13 },
    { header: "Điểm", key: "score", width: 10 },
    { header: "Chạm trần", key: "cappedText", width: 12 },
    { header: "Lệch số", key: "mismatchText", width: 12 },
    { header: "Trạng thái", key: "status", width: 22 },
  ];
  styleHeader(det.getRow(1));

  rows.forEach((r) => {
    const row = det.addRow({
      ...r,
      cappedText: r.capped ? "CÓ" : "",
      mismatchText: r.mismatch ? "CÓ" : "",
    });
    row.getCell("achievement").numFmt = "0.00";
    row.getCell("score").numFmt = "0.00";
    if (r.mismatch) {
      row.eachCell((c) => {
        c.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFDE8E8" },
        };
      });
    }
  });

  det.autoFilter = { from: "A1", to: "Q1" };
  det.views = [{ state: "frozen", ySplit: 1 }];

  return wb.xlsx.writeBuffer();
}

/* ------------------------------------------------------------ BÁO CÁO DASHBOARD */

const PERIOD_LABEL_VI: Record<string, string> = {
  today: "Hôm nay",
  week: "Tuần này",
  month: "Tháng này",
};

const SHIFT_LABEL_VI = SHIFT_TYPE_LABEL;

/** Trạng thái duyệt ca sản xuất (ProductionShiftLog.status). */
const DASHBOARD_STATUS_ROWS: [
  key: "DRAFT" | "RETURNED" | "QC_APPROVED" | "LOCKED",
  label: string,
][] = [
  ["DRAFT", "Chờ KCS xác nhận"],
  ["RETURNED", "KCS trả về sản xuất"],
  ["QC_APPROVED", "Chờ Ban Giám đốc khoá"],
  ["LOCKED", "Đã khoá số"],
];

/** Tiền bị ẩn (người xem không có quyền) thì để ô trống, không ghi 0. */
const money = (v: number | null | undefined) =>
  v === null || v === undefined ? "" : Math.round(v);

/** Số có thể null (chưa có dữ liệu) → ô trống. */
const num2 = (v: number | null | undefined) =>
  v === null || v === undefined ? "" : Number(v.toFixed(2));

/**
 * Xuất Excel cho Dashboard KPI sản xuất (/admin/kpi-dashboard). Ba khối dữ liệu
 * (summary/distribution/trends) đến từ `lib/services/kpi-dashboard.ts` — cùng
 * công thức với 3 API vẽ biểu đồ trên màn hình, để số trong file không lệch số
 * trên web. Nguồn là điểm thật của ca đã khoá số (DailyKpiResult).
 */
export async function buildDashboardReport(input: {
  period: string;
  summary: DashboardSummaryResult;
  distribution: DashboardDistributionResult;
  trends: DashboardTrendsResult;
}) {
  const { period, summary, distribution, trends } = input;
  const wb = new ExcelJS.Workbook();
  wb.creator = "GANI FOODY KPI System";
  wb.created = new Date();

  /* --- Sheet 1: tổng hợp --- */
  const sum = wb.addWorksheet("TONG_HOP");
  sum.columns = [
    { width: 26 },
    { width: 18 },
    { width: 30 },
    { width: 18 },
    { width: 14 },
    { width: 16 },
  ];
  sum.mergeCells("A1:F1");
  sum.getCell("A1").value = `DASHBOARD KPI SẢN XUẤT — ${
    PERIOD_LABEL_VI[period] ?? period
  }`;
  sum.getCell("A1").font = { bold: true, size: 14 };
  sum.getCell("A1").alignment = { horizontal: "center" };
  sum.getCell("A2").value = `Xuất lúc: ${formatVnDateTime(new Date())} · Nguồn: điểm ca đã khoá số`;
  sum.getCell("A2").font = { italic: true, size: 10, color: { argb: "FF666666" } };
  sum.addRow([]);

  if (summary.summary.totalShifts === 0) {
    sum.addRow(["Chưa có ca nào được khoá trong khoảng này."]).font = {
      italic: true,
      color: { argb: "FF9A3412" },
    };
    sum.addRow([]);
  }

  styleHeader(sum.addRow(["Chỉ số", "Giá trị", "Chỉ số", "Giá trị"]));
  sum.addRow([
    "Số ca đã khoá",
    summary.summary.totalShifts,
    "Thưởng TB/ca (₫)",
    money(summary.summary.avgBonus),
  ]);
  sum.addRow([
    "Lượt chấm (người × ca)",
    summary.summary.resultCount,
    "Tổng thưởng (₫)",
    money(summary.summary.totalBonus),
  ]);
  sum.addRow([
    "Điểm cuối TB (theo người)",
    num2(summary.summary.avgScore),
    "% không bị khoá thưởng",
    summary.summary.percentBonusUnlocked ?? "",
  ]);
  sum.addRow([
    "Điểm Tầng 2 TB (toàn xưởng)",
    num2(summary.summary.avgTier2Score),
    "Lượt bị khoá thưởng",
    summary.summary.bonusLockedCount,
  ]);
  sum.addRow([]);

  styleHeader(sum.addRow(["Theo trạng thái", "Số ca", "Theo ca (đã khoá)", "Số ca"]));
  // Ca thật trong hệ thống là CA_1/CA_2/CA_3 (lib/production/constants.ts)
  const rowCount = Math.max(DASHBOARD_STATUS_ROWS.length, SHIFT_TYPES.length);
  for (let i = 0; i < rowCount; i++) {
    const st = DASHBOARD_STATUS_ROWS[i];
    const sh = SHIFT_TYPES[i];
    sum.addRow([
      st ? st[1] : "",
      st ? summary.statusCounts[st[0]] ?? 0 : "",
      sh ? SHIFT_TYPE_LABEL[sh] ?? sh : "",
      sh ? summary.shiftTypes[sh] ?? 0 : "",
    ]);
  }

  if (summary.topScores.length > 0) {
    sum.addRow([]);
    sum.addRow(["TOP 5 CA ĐIỂM TB CAO NHẤT"]).font = { bold: true };
    styleHeader(
      sum.addRow(["Ngày", "Ca", "Sản phẩm (SKU)", "Điểm TB", "Số người", "Thưởng ca (₫)"])
    );
    summary.topScores.forEach((s) => {
      sum.addRow([
        formatVnDate(s.shiftDate),
        SHIFT_LABEL_VI[s.shiftType] ?? s.shiftType,
        `${s.skuName} (${s.skuCode})`,
        Number(s.avgScore.toFixed(2)),
        s.peopleCount,
        money(s.shiftBonus),
      ]);
    });
  }

  /* --- Sheet 2: phân bố điểm --- */
  const dist = wb.addWorksheet("PHAN_BO_DIEM");
  dist.columns = [{ width: 18 }, { width: 14 }, { width: 14 }, { width: 12 }];
  dist.mergeCells("A1:D1");
  dist.getCell("A1").value = "PHÂN BỐ ĐIỂM CUỐI THEO NGƯỜI — 30 NGÀY GẦN NHẤT";
  dist.getCell("A1").font = { bold: true, size: 14 };
  dist.getCell("A1").alignment = { horizontal: "center" };
  dist.addRow([]);
  dist.addRow(["Số lượt chấm", distribution.statistics.count]);
  dist.addRow(["Trung bình", Number(distribution.statistics.average.toFixed(2))]);
  dist.addRow(["Trung vị", Number(distribution.statistics.median.toFixed(2))]);
  dist.addRow(["Độ lệch chuẩn", Number(distribution.statistics.stdDev.toFixed(2))]);
  dist.addRow(["Nhỏ nhất", distribution.statistics.min]);
  dist.addRow(["Lớn nhất", distribution.statistics.max]);
  dist.addRow([]);
  styleHeader(dist.addRow(["Khoảng điểm", "Hệ số thưởng", "Số lượt", "Tỷ lệ (%)"]));
  distribution.chartData.forEach((b) =>
    dist.addRow([b.range, `${b.multiplier}×`, b.count, b.percentage])
  );

  /* --- Sheet 3: xu hướng --- */
  const trend = wb.addWorksheet("XU_HUONG");
  trend.columns = [
    { header: "Ngày", key: "date", width: 12 },
    { header: "Số ca khoá", key: "shiftCount", width: 11 },
    { header: "Lượt chấm", key: "peopleCount", width: 11 },
    { header: "Điểm TB", key: "avgScore", width: 11 },
    { header: "MA 3 ngày", key: "movingAvg", width: 11 },
    { header: "% đạt sản lượng TB", key: "avgOutputAchievement", width: 18 },
    { header: "% lỗi (phế + làm lại) TB", key: "avgDefectRate", width: 22 },
    { header: "Thưởng (₫)", key: "totalBonus", width: 14 },
  ];
  styleHeader(trend.getRow(1));
  trends.trendData.forEach((d) => {
    trend.addRow({
      date: d.displayDate,
      shiftCount: d.shiftCount,
      peopleCount: d.peopleCount,
      avgScore: d.avgScore ?? "",
      movingAvg: d.movingAvg ?? "",
      avgOutputAchievement: d.avgOutputAchievement ?? "",
      avgDefectRate: d.avgDefectRate ?? "",
      totalBonus: money(d.totalBonus),
    });
  });
  trend.addRow([]);
  trend.addRow(["Thống kê kỳ"]).font = { bold: true };
  trend.addRow(["Số ngày có dữ liệu", trends.statistics.daysWithData]);
  trend.addRow(["Số ca đã khoá", trends.statistics.totalShifts]);
  trend.addRow(["Lượt chấm", trends.statistics.resultCount]);
  trend.addRow(["Điểm cuối TB (theo người)", num2(trends.statistics.avgScore)]);
  trend.addRow(["Tổng thưởng (₫)", money(trends.statistics.totalBonusDistributed)]);

  return wb.xlsx.writeBuffer();
}

/* ------------------------------------------------------------ BÁO CÁO NGHỈ PHÉP */

export type LeaveExportRow = {
  employee: string;
  department: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  isUrgent: boolean;
  status: string;
  reviewedBy: string;
  reviewNote: string;
  createdAt: string;
};

/** Xuất danh sách đơn nghỉ phép trong khoảng thời gian đang xem trên trang /leave-requests. */
export async function buildLeaveReport(
  rangeLabel: string,
  rows: LeaveExportRow[]
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "GANI FOODY KPI System";
  wb.created = new Date();

  const sheet = wb.addWorksheet("NGHI_PHEP");
  sheet.mergeCells("A1:K1");
  sheet.getCell("A1").value = `TỔNG HỢP NGHỈ PHÉP — ${rangeLabel}`;
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.getCell("A1").alignment = { horizontal: "center" };
  sheet.addRow([]);

  sheet.columns = [
    { width: 24 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 10 },
    { width: 32 },
    { width: 12 },
    { width: 14 },
    { width: 20 },
    { width: 28 },
    { width: 18 },
  ];
  sheet.addRow([
    "Họ tên",
    "Phòng ban",
    "Từ ngày giờ",
    "Đến ngày giờ",
    "Số ngày",
    "Lý do",
    "Khẩn cấp",
    "Trạng thái",
    "Người duyệt",
    "Ghi chú duyệt",
    "Gửi lúc",
  ]);
  styleHeader(sheet.getRow(3));

  rows.forEach((r) => {
    const row = sheet.addRow([
      r.employee,
      r.department,
      r.startDate,
      r.endDate,
      r.days,
      r.reason,
      r.isUrgent ? "CÓ" : "",
      r.status,
      r.reviewedBy,
      r.reviewNote,
      r.createdAt,
    ]);
    if (r.isUrgent) {
      row.getCell(7).font = { color: { argb: "FFC00000" }, bold: true };
    }
  });

  sheet.autoFilter = { from: "A3", to: "K3" };
  sheet.views = [{ state: "frozen", ySplit: 3 }];

  return wb.xlsx.writeBuffer();
}

/* ------------------------------------------------------------ tiện ích nội bộ */

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: HEADER_TEXT } };
  row.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: BRAND },
    };
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
  if (typeof v === "object" && "result" in v) return String(v.result ?? "");
  if (typeof v === "object" && "text" in v) return String(v.text ?? "");
  return String(v).trim();
}
