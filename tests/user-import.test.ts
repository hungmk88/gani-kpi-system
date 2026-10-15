import { describe, expect, it } from "vitest";
import { validateUserRow, type ParsedUserRow } from "@/lib/excel-users";
import { classifyImportRows } from "@/lib/services/user-import-service";

const row = (over: Partial<ParsedUserRow> = {}): ParsedUserRow => ({
  rowNumber: 2,
  fullName: "Nguyễn Văn A",
  email: "a@ganifoody.vn",
  password: "GaniTam2026a",
  role: "EMPLOYEE",
  departmentCode: "SALES",
  jobTitle: null,
  phone: null,
  productionRole: null,
  employeeCode: null,
  issues: [],
  ...over,
});

describe("nạp nhân sự — kiểm từng dòng (không cần database)", () => {
  it("báo ĐỦ mọi chỗ sai của một dòng, kèm tên cột", () => {
    const issues = validateUserRow(
      row({ fullName: "", email: "khong-phai-email", role: "ADMIN", productionRole: "BOSS" }),
      new Map()
    );
    expect(issues.map((i) => i.column)).toEqual([
      "HO_TEN",
      "EMAIL",
      "VAI_TRO",
      "VAI_TRO_XUONG",
    ]);
    expect(issues.every((i) => i.message.length > 10)).toBe(true);
  });

  it("email trùng trong file chỉ ra dòng xuất hiện trước", () => {
    const seen = new Map<string, number>();
    expect(validateUserRow(row({ rowNumber: 2 }), seen)).toEqual([]);
    const dup = validateUserRow(row({ rowNumber: 5 }), seen);
    expect(dup[0].column).toBe("EMAIL");
    expect(dup[0].message).toContain("dòng 2");
  });
});

describe("nạp nhân sự — xem trước (đối chiếu database)", () => {
  const departments = [{ id: "d1", code: "SALES", name: "Kinh doanh" }];

  it("tách dòng hợp lệ / lỗi / đã có tài khoản; chỉ dòng hợp lệ được chuẩn bị tạo", () => {
    const { preview, prepared } = classifyImportRows(
      [
        row({ rowNumber: 2, email: "ok@ganifoody.vn" }),
        row({ rowNumber: 3, email: "sai-phong@ganifoody.vn", departmentCode: "XX" }),
        row({ rowNumber: 4, email: "yeu@ganifoody.vn", password: "abc" }),
        row({ rowNumber: 5, email: "da-co@ganifoody.vn" }),
      ],
      { departments, existingEmails: new Set(["da-co@ganifoody.vn"]) }
    );
    expect(preview.map((r) => r.status)).toEqual(["ok", "error", "error", "exists"]);
    expect(preview[1].issues[0].column).toBe("MA_PHONG_BAN");
    expect(preview[2].issues[0].column).toBe("MAT_KHAU_TAM");
    expect(prepared.map((p) => p.email)).toEqual(["ok@ganifoody.vn"]);
    expect(prepared[0].departmentId).toBe("d1");
    // Không đưa mật khẩu tạm ra bảng xem trước
    expect(JSON.stringify(preview)).not.toContain("GaniTam2026a");
  });
});

describe("nạp nhân sự — mã NV", () => {
  it("chuẩn hoá in hoa, báo sai định dạng và trùng trong file", () => {
    const emails = new Map<string, number>();
    const codes = new Map<string, number>();
    const a = row({ rowNumber: 2, email: "a@ganifoody.vn", employeeCode: " nv01 " });
    expect(validateUserRow(a, emails, codes)).toEqual([]);
    expect(a.employeeCode).toBe("NV01");
    const dup = validateUserRow(
      row({ rowNumber: 3, email: "b@ganifoody.vn", employeeCode: "NV01" }),
      emails,
      codes
    );
    expect(dup).toEqual([{ column: "MA_NV", message: expect.stringContaining("dòng 2") }]);
    const bad = validateUserRow(
      row({ rowNumber: 4, email: "c@ganifoody.vn", employeeCode: "Mã 01" }),
      emails,
      codes
    );
    expect(bad[0].column).toBe("MA_NV");
  });

  it("mã đã có người giữ trong hệ thống thì dòng lỗi, nêu tên người đó", () => {
    const { preview, prepared } = classifyImportRows([row({ employeeCode: "NV09" })], {
      departments: [{ id: "d1", code: "SALES", name: "Kinh doanh" }],
      existingEmails: new Set(),
      existingCodes: new Map([["NV09", "Trần Văn B"]]),
    });
    expect(preview[0].status).toBe("error");
    expect(preview[0].issues[0].message).toContain("Trần Văn B");
    expect(prepared).toHaveLength(0);
  });
});
