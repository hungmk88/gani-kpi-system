/**
 * Ô NHẬP NGÀY GIỜ (datetime-local) ↔ thời điểm ISO — LUÔN theo giờ Việt Nam.
 *
 * `<input type="datetime-local">` trả/nhận "YYYY-MM-DDTHH:mm" không kèm múi
 * giờ. Nếu để `new Date(value)` / `getHours()` tự hiểu thì trình duyệt dùng
 * múi giờ của MÁY: người đang công tác nước ngoài (hoặc máy đặt sai múi giờ)
 * gõ "17:00" sẽ ra hạn chót lệch vài tiếng. Hệ thống quy ước chuỗi này là giờ VN.
 *
 * Chạy được cả ở client lẫn server (chỉ dựa vào lib/vn-time, không đọc TZ máy).
 */
import { vnDate, vnParts } from "./vn-time";

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DDTHH:mm" (giờ VN) → ISO UTC. Chuỗi sai định dạng / ngày không có thật → null. */
export function vnLocalToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const dt = vnDate(y, mo, d, h, mi);
  // vnDate tự cuộn 31/02 thành 03/03 — coi là sai thay vì lặng lẽ đổi ngày
  const back = vnParts(dt);
  if (back.year !== y || back.month !== mo || back.day !== d) return null;
  return dt.toISOString();
}

/** Thời điểm (ISO/Date) → "YYYY-MM-DDTHH:mm" giờ VN để đổ vào ô datetime-local. Sai → "". */
export function isoToVnLocal(d: Date | string | number | null | undefined): string {
  if (d === null || d === undefined || d === "") return "";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "";
  const p = vnParts(t);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
