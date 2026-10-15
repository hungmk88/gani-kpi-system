import { prisma } from "@/lib/db";
import { hashPassword, type SessionUser } from "@/lib/auth";
import { checkPasswordStrength } from "@/lib/password";
import { parseUserFile, type UserImportRow } from "@/lib/excel-users";
import { writeAudit } from "@/lib/audit";

export type UserImportResult = {
  /** File có được nạp hay không. Sai một dòng là cả file bị từ chối. */
  accepted: boolean;
  totalRows: number;
  created: number;
  errors: string[];
  createdUsers: { email: string; fullName: string; role: string }[];
};

/**
 * NẠP DANH SÁCH NHÂN SỰ TỪ EXCEL.
 *
 * Luật lớn nhất ở đây: **được ăn cả, ngã về không**. Sai một dòng là từ chối cả
 * file, không tạo ai hết.
 *
 * Phần nạp số KPI thì làm ngược lại — dòng nào được thì nhận, dòng nào hỏng thì
 * báo — và đó là đúng với nó, vì nạp thiếu một con số thì bổ sung sau được. Còn
 * ở đây, nạp nửa chừng nghĩa là có người đã có tài khoản, có người chưa, mà nhìn
 * vào file thì không phân biệt được. Người quản trị sẽ nạp lại lần hai và sinh
 * ra một mớ lỗi "email đã tồn tại" lẫn lộn với lỗi thật.
 */
export async function importUsersFromFile(
  actor: SessionUser,
  buffer: ArrayBuffer,
  meta: { ip?: string | null; userAgent?: string | null } = {}
): Promise<UserImportResult> {
  const { rows, errors: parseErrors } = await parseUserFile(buffer);
  const errors = [...parseErrors];

  if (rows.length === 0 && errors.length === 0) {
    return {
      accepted: false,
      totalRows: 0,
      created: 0,
      errors: ["File không có dòng nhân sự nào."],
      createdUsers: [],
    };
  }

  /* --------- Đối chiếu với database: phòng ban, email trùng, mật khẩu --------- */

  const departments = await prisma.department.findMany({
    select: { id: true, code: true, name: true },
  });
  const deptByCode = new Map(departments.map((d) => [d.code.toUpperCase(), d]));

  const emails = rows.map((r) => r.email);
  const existing = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { email: true },
  });
  const existingSet = new Set(existing.map((e) => e.email));

  const prepared: (UserImportRow & { departmentId: string })[] = [];

  for (const r of rows) {
    const at = `Dòng ${r.rowNumber}`;

    const dept = deptByCode.get(r.departmentCode);
    if (!dept) {
      errors.push(
        `${at}: không có phòng ban mã "${r.departmentCode}". Mã hợp lệ: ${departments
          .map((d) => d.code)
          .join(", ")}.`
      );
      continue;
    }

    if (existingSet.has(r.email)) {
      errors.push(`${at}: email "${r.email}" đã có tài khoản trong hệ thống.`);
      continue;
    }

    const check = checkPasswordStrength(r.password, {
      fullName: r.fullName,
      email: r.email,
    });
    if (!check.ok) {
      errors.push(`${at}: MAT_KHAU_TAM không đạt — ${check.reason}`);
      continue;
    }

    prepared.push({ ...r, departmentId: dept.id });
  }

  if (errors.length > 0) {
    await writeAudit({
      actor,
      action: "USER_IMPORT_REJECTED",
      entityName: "users",
      entityId: "bulk",
      after: { totalRows: rows.length, errorCount: errors.length },
      ...meta,
    });

    return {
      accepted: false,
      totalRows: rows.length,
      created: 0,
      errors,
      createdUsers: [],
    };
  }

  /* ------------------------------- Tạo tài khoản ------------------------------ */

  // Băm mật khẩu trước, ngoài transaction: bcrypt chậm có chủ đích, để trong
  // transaction thì giữ khoá ghi database lâu một cách vô ích.
  // bcryptjs chạy bằng JS thuần, chiếm CPU — băm theo từng lô nhỏ thay vì
  // bắn cùng lúc hàng nghìn lời gọi làm nghẽn cả server.
  const withHashes: (typeof prepared[number] & { passwordHash: string })[] = [];
  const HASH_BATCH = 8;
  for (let i = 0; i < prepared.length; i += HASH_BATCH) {
    const batch = prepared.slice(i, i + HASH_BATCH);
    withHashes.push(
      ...(await Promise.all(
        batch.map(async (r) => ({
          ...r,
          passwordHash: await hashPassword(r.password),
        }))
      ))
    );
  }

  // Một câu lệnh duy nhất — vẫn "được ăn cả, ngã về không".
  await prisma.user.createMany({
    data: withHashes.map((r) => ({
      email: r.email,
      fullName: r.fullName,
      jobTitle: r.jobTitle,
      role: r.role,
      departmentId: r.departmentId,
      phone: r.phone,
      productionRole: r.productionRole,
      passwordHash: r.passwordHash,
      // Mật khẩu tạm nằm trong file Excel mà nhiều người xem được.
      // Ai vào cũng phải tự đặt mật khẩu riêng trước khi làm gì khác.
      mustChangePassword: true,
    })),
  });

  await writeAudit({
    actor,
    action: "USER_IMPORT",
    entityName: "users",
    entityId: "bulk",
    after: {
      created: withHashes.length,
      emails: withHashes.map((r) => r.email),
    },
    ...meta,
  });

  return {
    accepted: true,
    totalRows: rows.length,
    created: withHashes.length,
    errors: [],
    createdUsers: withHashes.map((r) => ({
      email: r.email,
      fullName: r.fullName,
      role: r.role,
    })),
  };
}
