import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseImportFile } from "@/lib/excel";

async function sheet(values: unknown[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("DU_LIEU");
  ws.addRow(["MA_KPI", "EMAIL_NHAN_VIEN", "THANG", "NAM", "GIA_TRI_THUC_TE"]);
  values.forEach((v, i) => ws.addRow(["SALES_RETURN", `nv${i}@gani.vn`, 10, 2026, v]));
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer).buffer as ArrayBuffer;
}

describe("nạp số KPI từ Excel — đọc số kiểu Việt", () => {
  it("ô chữ '1,5' là 1.5 (không thành 15); ô số giữ nguyên; '1.234.000' là 1234000", async () => {
    const { rows, errors } = await parseImportFile(await sheet(["1,5", 2.25, "1.234.000"]));
    expect(errors).toEqual([]);
    expect(rows.map((r) => r.value)).toEqual([1.5, 2.25, 1234000]);
  });

  it("ô trống / chữ không phải số bị báo lỗi, không quy về 0", async () => {
    const { rows, errors } = await parseImportFile(await sheet(["", "abc"]));
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("trống");
  });
});
