import { timingSafeEqual } from "node:crypto";

/**
 * Đọc một secret từ biến môi trường và TỪ CHỐI giá trị yếu: thiếu, quá ngắn,
 * hoặc còn y nguyên chuỗi mẫu trong .env.example ("doi-chuoi-..."). Secret yếu
 * coi như không có — thà tắt tính năng còn hơn mở cửa cho người đọc tài liệu.
 */
export function strongSecret(name: string, minLength = 24): string | null {
  const v = process.env[name];
  if (!v || v.length < minLength) return null;
  if (/^doi-chuoi/i.test(v)) return null;
  return v;
}

/** So sánh hai chuỗi trong thời gian hằng — chống dò secret qua thời gian phản hồi. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
