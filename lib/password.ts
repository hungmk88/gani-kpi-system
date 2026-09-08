/**
 * LUẬT ĐẶT MẬT KHẨU.
 *
 * Chỉ một chỗ duy nhất định nghĩa thế nào là mật khẩu hợp lệ — cả đường nhân
 * viên tự đổi, đường quản trị tạo tài khoản và đường nạp nhân sự hàng loạt đều
 * gọi vào đây. Ba đường mà ba luật khác nhau thì luật chặt nhất trở thành vô
 * nghĩa: người ta chỉ cần đi vòng qua đường lỏng nhất.
 */

export const PASSWORD_MIN_LENGTH = 10;

/**
 * Mật khẩu dùng chung trong dữ liệu mẫu. Cấm đặt lại đúng chuỗi này, vì nó nằm
 * trong tài liệu hướng dẫn — coi như đã công khai.
 */
export const SAMPLE_PASSWORDS = ["gani@2026", "gani@2025", "123456789", "password"];

export type PasswordCheck = { ok: true } | { ok: false; reason: string };

export function checkPasswordStrength(
  plain: string,
  opts: { fullName?: string | null; email?: string | null } = {}
): PasswordCheck {
  const pw = plain ?? "";

  if (pw.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      reason: `Mật khẩu phải từ ${PASSWORD_MIN_LENGTH} ký tự trở lên.`,
    };
  }
  if (pw.length > 200) {
    return { ok: false, reason: "Mật khẩu dài quá mức cần thiết." };
  }
  if (/\s/.test(pw)) {
    return { ok: false, reason: "Mật khẩu không được chứa khoảng trắng." };
  }
  if (!/[A-Za-zÀ-ỹ]/.test(pw)) {
    return { ok: false, reason: "Mật khẩu phải có ít nhất một chữ cái." };
  }
  if (!/[0-9]/.test(pw)) {
    return { ok: false, reason: "Mật khẩu phải có ít nhất một chữ số." };
  }

  const lower = pw.toLowerCase();

  if (SAMPLE_PASSWORDS.includes(lower)) {
    return {
      ok: false,
      reason:
        "Đây là mật khẩu mẫu ghi trong tài liệu hướng dẫn, coi như ai cũng biết. Đặt mật khẩu khác.",
    };
  }

  // Tên riêng và phần trước @ của email là thứ đầu tiên người ta thử
  const emailLocal = (opts.email ?? "").split("@")[0]?.toLowerCase() ?? "";
  if (emailLocal.length >= 4 && lower.includes(emailLocal)) {
    return {
      ok: false,
      reason: "Mật khẩu không nên chứa email của chính mình.",
    };
  }

  const nameParts = (opts.fullName ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((p) => p.length >= 4);
  if (nameParts.some((p) => lower.includes(p))) {
    return {
      ok: false,
      reason: "Mật khẩu không nên chứa tên của chính mình.",
    };
  }

  return { ok: true };
}
