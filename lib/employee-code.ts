/**
 * MÃ NHÂN VIÊN — chuẩn hoá một chỗ cho form quản trị, API và nhập Excel.
 *
 * Bỏ khoảng trắng hai đầu, viết hoa ("nv0012" → "NV0012"). Chỉ nhận chữ
 * không dấu, số và . _ - (tối đa 32 ký tự) — mã dùng để tìm kiếm và đối chiếu
 * với file chấm công / bảng lương, không nên có dấu hay khoảng trắng.
 * Chuỗi rỗng = không có mã (null).
 */
export const EMPLOYEE_CODE_MAX = 32;
const PATTERN = /^[A-Z0-9][A-Z0-9._-]*$/;

export function normalizeEmployeeCode(
  raw: string | null | undefined
): { ok: true; value: string | null } | { ok: false; error: string } {
  const v = (raw ?? "").trim().toUpperCase();
  if (!v) return { ok: true, value: null };
  if (v.length > EMPLOYEE_CODE_MAX) {
    return { ok: false, error: `Mã NV tối đa ${EMPLOYEE_CODE_MAX} ký tự.` };
  }
  if (!PATTERN.test(v)) {
    return {
      ok: false,
      error: "Mã NV chỉ gồm chữ không dấu, số và dấu . _ - (không khoảng trắng).",
    };
  }
  return { ok: true, value: v };
}
