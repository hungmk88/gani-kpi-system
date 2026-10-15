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
