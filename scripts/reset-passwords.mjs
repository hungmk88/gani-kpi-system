/**
 * ĐẶT LẠI MẬT KHẨU HÀNG LOẠT — mọi tài khoản đang hoạt động dùng chung một
 * mật khẩu mới.
 *
 *   RESET_PASSWORD='...' node scripts/reset-passwords.mjs            # chạy thử: chỉ đếm, không ghi
 *   RESET_PASSWORD='...' node scripts/reset-passwords.mjs --apply    # ghi thật
 *   ... --apply --no-force-change   # KHÔNG bắt đổi mật khẩu ở lần đăng nhập sau
 *   ... --apply --include-inactive  # đặt lại cả tài khoản đã khoá (vẫn khoá)
 *   ... --apply --allow-short       # cho mật khẩu chung 8–9 ký tự (luật thường: ≥10)
 *
 * Mật khẩu đi qua biến môi trường, KHÔNG qua dòng lệnh và KHÔNG ghi vào repo
 * (repo có thể công khai; argv lộ trong danh sách tiến trình). Chạy trên máy
 * không có Node thì dùng workflow "Reset passwords" (.github/workflows/
 * reset-passwords.yml) với secret RESET_PASSWORD.
 *
 * Làm giống hệt đường quản trị đặt hộ một người (app/api/admin/users/[id]):
 *  - passwordChangedAt = bây giờ -> mọi phiên đăng nhập cũ mất hiệu lực;
 *  - mustChangePassword = true (mặc định) -> lần đăng nhập đầu mỗi người phải
 *    tự đặt mật khẩu riêng. Mật khẩu chung mà để nguyên thì ai biết nó cũng
 *    đăng nhập được vào tài khoản Ban Giám đốc.
 * Liên kết Telegram GIỮ NGUYÊN (khác đường đặt hộ một người): đây là đặt lại
 * định kỳ, không phải xử lý một tài khoản nghi bị lộ.
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

try {
  process.loadEnvFile(".env");
} catch {
  /* dùng biến môi trường sẵn có */
}

const APPLY = process.argv.includes("--apply");
const FORCE_CHANGE = !process.argv.includes("--no-force-change");
const INCLUDE_INACTIVE = process.argv.includes("--include-inactive");
// Ban Giám đốc có thể chọn một mật khẩu chung ngắn hơn luật thường (vd 9 ký
// tự). Chỉ nới cho lần đặt lại hàng loạt này; người tự đổi vẫn phải ≥10.
const MIN_LENGTH = process.argv.includes("--allow-short") ? 8 : 10;
const password = process.env.RESET_PASSWORD ?? "";

// Cùng luật với lib/password.ts (checkPasswordStrength) — trừ phần so tên/email
// từng người, vì đây là một mật khẩu cho tất cả.
const SAMPLE_PASSWORDS = ["gani@2026", "gani@2025", "123456789", "password"];
function weakReason(pw) {
  if (pw.length < MIN_LENGTH) return `phải từ ${MIN_LENGTH} ký tự trở lên`;
  if (pw.length > 200) return "dài quá mức cần thiết";
  if (/\s/.test(pw)) return "không được chứa khoảng trắng";
  if (!/[A-Za-zÀ-ỹ]/.test(pw)) return "phải có ít nhất một chữ cái";
  if (!/[0-9]/.test(pw)) return "phải có ít nhất một chữ số";
  if (SAMPLE_PASSWORDS.includes(pw.toLowerCase())) return "là mật khẩu mẫu đã công khai";
  return null;
}

if (!password) {
  console.error("❌ Chưa đặt biến môi trường RESET_PASSWORD.");
  process.exit(2);
}
const weak = weakReason(password);
if (weak) {
  console.error(`❌ RESET_PASSWORD không hợp lệ: ${weak}.`);
  process.exit(2);
}

const prisma = new PrismaClient();

try {
  const where = INCLUDE_INACTIVE ? {} : { isActive: true };
  const users = await prisma.user.findMany({
    where,
    select: { id: true, email: true, role: true, isActive: true },
    orderBy: { email: "asc" },
  });

  console.log(
    `${APPLY ? "ĐẶT LẠI" : "[chạy thử] Sẽ đặt lại"} mật khẩu cho ${users.length} tài khoản` +
      `${INCLUDE_INACTIVE ? " (gồm cả tài khoản đã khoá)" : " đang hoạt động"}; ` +
      `bắt đổi ở lần đăng nhập sau: ${FORCE_CHANGE ? "CÓ" : "KHÔNG"}.`
  );
  for (const u of users) {
    console.log(`  - ${u.email} (${u.role}${u.isActive ? "" : ", đã khoá"})`);
  }

  if (!APPLY) {
    console.log("\nChưa ghi gì. Thêm --apply để đặt lại thật.");
  } else if (users.length > 0) {
    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date();
    const ids = users.map((u) => u.id);
    await prisma.$transaction([
      prisma.user.updateMany({
        where: { id: { in: ids } },
        data: {
          passwordHash,
          passwordChangedAt: now,
          mustChangePassword: FORCE_CHANGE,
        },
      }),
      prisma.auditLog.create({
        data: {
          userId: null,
          userEmail: null,
          action: "USER_PASSWORD_BULK_RESET",
          entityName: "users",
          entityId: "*",
          afterPayload: JSON.stringify({
            count: ids.length,
            mustChangePassword: FORCE_CHANGE,
            includeInactive: INCLUDE_INACTIVE,
            emails: users.map((u) => u.email),
          }),
          reason: "Đặt lại mật khẩu hàng loạt bằng scripts/reset-passwords.mjs",
        },
      }),
    ]);
    console.log(`\n✅ Đã đặt lại ${ids.length} tài khoản. Mọi phiên đăng nhập cũ đã bị đăng xuất.`);
  }
} finally {
  await prisma.$disconnect();
}
