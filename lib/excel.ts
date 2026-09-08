import ExcelJS from "exceljs";
import type {
  DashboardSummaryResult,
  DashboardDistributionResult,
  DashboardTrendsResult,
} from "./services/kpi-dashboard";

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

  const now = new Date();
  const m = now.getMonth() === 0 ? 12 : now.getMonth();
  const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
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
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const ws = wb.getWorksheet("DU_LIEU") ?? wb.worksheets[0];
  if (!ws) return { rows: [], errors: ["File không có sheet dữ liệu nào."] };

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

  det.autoFilter = { from: "A1", to: "P1" };
  det.views = [{ state: "frozen", ySplit: 1 }];

  return wb.xlsx.writeBuffer();
}

/* ------------------------------------------------------------ BÁO CÁO DASHBOARD */

const PERIOD_LABEL_VI: Record<string, string> = {
  today: "Hôm nay",
  week: "Tuần này",
  month: "Tháng này",
};

const SHIFT_LABEL_VI: Record<string, string> = {
  MORNING: "Sáng",
  AFTERNOON: "Chiều",
  NIGHT: "Tối",
};

/**
 * Xuất Excel cho Dashboard KPI sản xuất (/admin/kpi-dashboard). Ba khối dữ liệu
 * (summary/distribution/trends) đến từ `lib/services/kpi-dashboard.ts` — cùng
 * công thức với 3 API vẽ biểu đồ trên màn hình, để số trong file không lệch số
 * trên web.
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
  sum.columns = [{ width: 26 }, { width: 18 }, { width: 26 }, { width: 18 }];
  sum.mergeCells("A1:D1");
  sum.getCell("A1").value = `DASHBOARD KPI SẢN XUẤT — ${
    PERIOD_LABEL_VI[period] ?? period
  }`;
  sum.getCell("A1").font = { bold: true, size: 14 };
  sum.getCell("A1").alignment = { horizontal: "center" };
  sum.getCell("A2").value = `Xuất lúc: ${new Date().toLocaleString("vi-VN")}`;
  sum.getCell("A2").font = { italic: true, size: 10, color: { argb: "FF666666" } };
  sum.addRow([]);

  styleHeader(sum.addRow(["Chỉ số", "Giá trị", "Chỉ số", "Giá trị"]));
  sum.addRow([
    "Tổng ca tính",
    summary.summary.totalShifts,
    "Trung bình/ca (₫)",
    summary.summary.avgBonus,
  ]);
  sum.addRow([
    "Điểm trung bình",
    Number(summary.summary.avgScore.toFixed(2)),
    "% đã duyệt",
    summary.summary.percentApproved,
  ]);
  sum.addRow(["Tổng thưởng (₫)", summary.summary.totalBonus, "", ""]);
  sum.addRow([]);

  styleHeader(sum.addRow(["Theo trạng thái", "Số ca", "Theo ca", "Số ca"]));
  sum.addRow([
    "Đã tính (CALCULATED)",
    summary.statusCounts.CALCULATED,
    "Sáng",
    summary.shiftTypes.MORNING,
  ]);
  sum.addRow([
    "Đã duyệt (APPROVED)",
    summary.statusCounts.APPROVED,
    "Chiều",
    summary.shiftTypes.AFTERNOON,
  ]);
  sum.addRow([
    "Nháp (DRAFT)",
    summary.statusCounts.DRAFT,
    "Tối",
    summary.shiftTypes.NIGHT,
  ]);

  if (summary.topScores.length > 0) {
    sum.addRow([]);
    sum.addRow(["TOP 5 CA ĐIỂM CAO NHẤT"]).font = { bold: true };
    styleHeader(sum.addRow(["Ngày", "Ca", "Điểm", "Thưởng (₫)"]));
    summary.topScores.forEach((s) => {
      sum.addRow([
        new Date(s.shiftDate).toLocaleDateString("vi-VN"),
        SHIFT_LABEL_VI[s.shiftType] ?? s.shiftType,
        Number(s.totalScore.toFixed(2)),
        Math.round(s.bonusAmount),
      ]);
    });
  }

  /* --- Sheet 2: phân bố điểm --- */
  const dist = wb.addWorksheet("PHAN_BO_DIEM");
  dist.columns = [{ width: 16 }, { width: 12 }, { width: 12 }];
  dist.mergeCells("A1:C1");
  dist.getCell("A1").value = "PHÂN BỐ ĐIỂM — 30 NGÀY GẦN NHẤT";
  dist.getCell("A1").font = { bold: true, size: 14 };
  dist.getCell("A1").alignment = { horizontal: "center" };
  dist.addRow([]);
  dist.addRow(["Trung bình", Number(distribution.statistics.average.toFixed(2))]);
  dist.addRow(["Trung vị", Number(distribution.statistics.median.toFixed(2))]);
  dist.addRow(["Độ lệch chuẩn", Number(distribution.statistics.stdDev.toFixed(2))]);
  dist.addRow(["Nhỏ nhất", distribution.statistics.min]);
  dist.addRow(["Lớn nhất", distribution.statistics.max]);
  dist.addRow([]);
  styleHeader(dist.addRow(["Khoảng điểm", "Số ca", "Tỷ lệ (%)"]));
  distribution.chartData.forEach((b) =>
    dist.addRow([b.range, b.count, b.percentage])
  );

  /* --- Sheet 3: xu hướng --- */
  const trend = wb.addWorksheet("XU_HUONG");
  trend.columns = [
    { header: "Ngày", key: "date", width: 14 },
    { header: "Số ca", key: "shiftCount", width: 10 },
    { header: "Điểm TB", key: "avgScore", width: 12 },
    { header: "Sản lượng TB", key: "avgOutput", width: 14 },
    { header: "Hao hụt TB", key: "avgWaste", width: 12 },
    { header: "MA 3 ngày", key: "movingAvg", width: 12 },
    { header: "Thưởng (₫)", key: "totalBonus", width: 14 },
  ];
  styleHeader(trend.getRow(1));
  trends.trendData.forEach((d) => {
    trend.addRow({
      date: d.displayDate,
      shiftCount: d.shiftCount,
      avgScore: d.avgScore ?? "",
      avgOutput: d.avgOutput ?? "",
      avgWaste: d.avgWaste ?? "",
      movingAvg: d.movingAvg,
      totalBonus: Math.round(d.totalBonus),
    });
  });
  trend.addRow([]);
  trend.addRow(["Thống kê kỳ"]).font = { bold: true };
  trend.addRow(["Số ngày có dữ liệu", trends.statistics.daysWithData]);
  trend.addRow(["Tổng ca", trends.statistics.totalShifts]);
  trend.addRow([
    "Điểm TB/ngày",
    Number(trends.statistics.avgDailyScore.toFixed(2)),
  ]);
  trend.addRow(["Tổng thưởng (₫)", trends.statistics.totalBonusDistributed]);

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
