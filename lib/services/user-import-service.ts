import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashPassword, type SessionUser } from "@/lib/auth";
import { checkPasswordStrength } from "@/lib/password";
import {
  parseUserFile,
  type ParsedUserRow,
  type RowIssue,
  type UserImportRow,
} from "@/lib/excel-users";
import { writeAudit } from "@/lib/audit";
import { BusinessError } from "@/lib/rbac";
import { ERR } from "@/lib/constants";

/**
 * Trạng thái của một dòng trong màn xem trước:
 * - ok: sẽ được tạo khi bấm "Nhập".
 * - error: có chỗ sai, KHÔNG tạo — sửa file rồi nạp lại.
 * - exists: email đã có tài khoản — bỏ qua (không phải lỗi). Nhờ vậy nạp lại
 *   cả file sau khi sửa vài dòng sai thì những người đã tạo lần trước tự được
 *   bỏ qua, không sinh ra một mớ lỗi "email đã tồn tại" lẫn với lỗi thật.
 */
export type ImportRowStatus = "ok" | "error" | "exists";

export type ImportPreviewRow = {
  rowNumber: number;
  fullName: string;
  email: string;
  role: string;
  departmentCode: string;
  departmentName: string | null;
  jobTitle: string | null;
  productionRole: string | null;
  status: ImportRowStatus;
  issues: RowIssue[];
};

export type UserImportResult = {
  /** true = chỉ xem trước, chưa ghi gì */
  dryRun: boolean;
  /** Đã tạo tài khoản (chỉ khi dryRun = false và nhập thành công) */
  accepted: boolean;
  totalRows: number;
  validCount: number;
  errorCount: number;
  existingCount: number;
  /** Lỗi cả file, không gắn với dòng nào */
  fileErrors: string[];
  rows: ImportPreviewRow[];
  created: number;
  createdUsers: { email: string; fullName: string; role: string }[];
  /** Vì sao bước nhập không tạo ai (null khi xem trước hoặc nhập thành công) */
  rejectReason: ImportRejectReason | null;
};

export type ImportRejectReason = "file_error" | "no_valid_rows" | "preview_mismatch";

type Prepared = UserImportRow & { departmentId: string };

/**
 * Đối chiếu từng dòng đã đọc với danh mục phòng ban và các email đã có —
 * hàm thuần (database nạp sẵn ở ngoài) để test được.
 */
export function classifyImportRows(
  rows: ParsedUserRow[],
  ctx: {
    departments: { id: string; code: string; name: string }[];
    existingEmails: Set<string>;
  }
): { preview: ImportPreviewRow[]; prepared: Prepared[] } {
  const deptByCode = new Map(ctx.departments.map((d) => [d.code.toUpperCase(), d]));
  const validCodes = ctx.departments.map((d) => d.code).join(", ");

  const preview: ImportPreviewRow[] = [];
  const prepared: Prepared[] = [];

  for (const r of rows) {
    const issues = [...r.issues];
    const dept = r.departmentCode ? deptByCode.get(r.departmentCode) : undefined;
    if (r.departmentCode && !dept) {
      issues.push({
        column: "MA_PHONG_BAN",
        message: `Không có phòng ban mã "${r.departmentCode}". Mã hợp lệ: ${validCodes || "(chưa có phòng ban nào)"}.`,
      });
    }

    if (r.password) {
      const check = checkPasswordStrength(r.password, {
        fullName: r.fullName,
        email: r.email,
      });
      if (!check.ok) {
        issues.push({ column: "MAT_KHAU_TAM", message: check.reason });
      }
    }

    const exists = !!r.email && ctx.existingEmails.has(r.email);
    // Đã có tài khoản thì bỏ qua cả dòng — những chỗ sai còn lại của dòng đó
    // không còn ý nghĩa (đằng nào cũng không tạo), báo ra chỉ gây rối.
    const status: ImportRowStatus = exists ? "exists" : issues.length > 0 ? "error" : "ok";

    preview.push({
      rowNumber: r.rowNumber,
      fullName: r.fullName,
      email: r.email,
      role: r.role,
      departmentCode: r.departmentCode,
      departmentName: dept?.name ?? null,
      jobTitle: r.jobTitle,
      productionRole: r.productionRole,
      status,
      issues: exists
        ? [{ column: "EMAIL", message: "Email này đã có tài khoản — bỏ qua dòng này." }]
        : issues,
    });

    if (status === "ok" && dept) {
      // Bỏ mảng issues (rỗng) — chỉ giữ phần dữ liệu để tạo tài khoản.
      const { issues: _ignored, ...data } = r;
      void _ignored;
      prepared.push({ ...data, departmentId: dept.id });
    }
  }

  return { preview, prepared };
}

/**
 * NẠP DANH SÁCH NHÂN SỰ TỪ EXCEL — hai bước.
 *
 * 1. Xem trước (`dryRun: true`): đọc file, kiểm từng dòng, trả về bảng từng
 *    dòng kèm chỗ sai. KHÔNG ghi gì vào database (kể cả nhật ký).
 * 2. Nhập (`dryRun: false`): đọc lại CHÍNH file đó, kiểm lại từ đầu (không tin
 *    kết quả xem trước gửi từ trình duyệt), rồi tạo đúng những dòng hợp lệ.
 *
 * Trước đây sai một dòng là từ chối cả file, vì nạp nửa chừng thì không biết
 * ai đã vào ai chưa. Màn xem trước giải quyết đúng nỗi lo đó: người quản trị
 * thấy rõ dòng nào sẽ tạo, dòng nào bỏ qua TRƯỚC khi bấm, và nạp lại file sau
 * khi sửa thì người đã tạo tự được bỏ qua (trạng thái "exists").
 *
 * `expectedValid`: số dòng hợp lệ người quản trị đã thấy ở bước xem trước.
 * Lệch (file bị sửa, có người vừa được tạo tay…) thì từ chối, bắt xem lại —
 * không tạo một danh sách khác với danh sách người ta đã duyệt bằng mắt.
 */
export async function importUsersFromFile(
  actor: SessionUser,
  buffer: ArrayBuffer,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  opts: { dryRun?: boolean; expectedValid?: number | null } = {}
): Promise<UserImportResult> {
  const dryRun = opts.dryRun ?? false;
  const { rows, fileErrors: parseFileErrors } = await parseUserFile(buffer);
  const fileErrors = [...parseFileErrors];
  if (rows.length === 0 && fileErrors.length === 0) {
    fileErrors.push("File không có dòng nhân sự nào.");
  }

  /* --------- Đối chiếu với database: phòng ban, email đã có --------- */

  const [departments, existing] = await Promise.all([
    prisma.department.findMany({ select: { id: true, code: true, name: true } }),
    rows.length > 0
      ? prisma.user.findMany({
          where: { email: { in: rows.map((r) => r.email).filter(Boolean) } },
          select: { email: true },
        })
      : Promise.resolve([] as { email: string }[]),
  ]);

  const { preview, prepared } = classifyImportRows(rows, {
    departments,
    existingEmails: new Set(existing.map((e) => e.email)),
  });

  const base = {
    dryRun,
    totalRows: preview.length,
    validCount: prepared.length,
    errorCount: preview.filter((r) => r.status === "error").length,
    existingCount: preview.filter((r) => r.status === "exists").length,
    fileErrors,
    rows: preview,
  };
  const notCreated = (rejectReason: ImportRejectReason | null): UserImportResult => ({
    ...base,
    accepted: false,
    created: 0,
    createdUsers: [],
    rejectReason,
  });

  if (dryRun) return notCreated(null);

  /* --------------------------- Chặn trước khi tạo --------------------------- */

  const rejectReason: ImportRejectReason | null =
    fileErrors.length > 0
      ? "file_error"
      : prepared.length === 0
        ? "no_valid_rows"
        : opts.expectedValid != null && opts.expectedValid !== prepared.length
          ? "preview_mismatch"
          : null;

  if (rejectReason) {
    await writeAudit({
      actor,
      action: "USER_IMPORT_REJECTED",
      entityName: "users",
      entityId: "bulk",
      after: {
        totalRows: base.totalRows,
        validCount: base.validCount,
        errorCount: base.errorCount,
        reason: rejectReason,
      },
      ...meta,
    });
    return notCreated(rejectReason);
  }

  /* ------------------------------- Tạo tài khoản ------------------------------ */

  // Băm mật khẩu trước, ngoài transaction: bcrypt chậm có chủ đích, để trong
  // transaction thì giữ khoá ghi database lâu một cách vô ích.
  // bcryptjs chạy bằng JS thuần, chiếm CPU — băm theo từng lô nhỏ thay vì
  // bắn cùng lúc hàng nghìn lời gọi làm nghẽn cả server.
  const withHashes: (Prepared & { passwordHash: string })[] = [];
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

  // Một câu lệnh duy nhất: những dòng hợp lệ vào cùng lúc hoặc không dòng nào.
  try {
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
  } catch (e) {
    // Có người được tạo (tay hoặc lần nạp khác) đúng lúc đang băm mật khẩu.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        "Có email trong file vừa được tạo tài khoản trong lúc đang nhập. Chưa ai được tạo — bấm xem trước lại rồi nhập.",
        409
      );
    }
    throw e;
  }

  await writeAudit({
    actor,
    action: "USER_IMPORT",
    entityName: "users",
    entityId: "bulk",
    after: {
      created: withHashes.length,
      skippedErrors: base.errorCount,
      skippedExisting: base.existingCount,
      emails: withHashes.map((r) => r.email),
    },
    ...meta,
  });

  return {
    ...base,
    accepted: true,
    rejectReason: null,
    created: withHashes.length,
    createdUsers: withHashes.map((r) => ({
      email: r.email,
      fullName: r.fullName,
      role: r.role,
    })),
  };
}
