import { fmtNum } from "../format";
import { ANTI_GAMING } from "./constants";

/**
 * TRẠNG THÁI PHỤ CỦA LUỒNG DUYỆT CA — không thêm cột, không thêm giá trị status.
 *
 * Cột status bị CHECK constraint của database giới hạn ở DRAFT | QC_APPROVED |
 * LOCKED (lib/db-constraints.ts). Thêm "RETURNED" phải có migration, nên "KCS
 * trả về sản xuất" được ghi giống cách đánh dấu BGĐ vượt quyền KCS: ca vẫn là
 * DRAFT, dòng đầu qcNote là "[KCS trả về] <người trả>", các dòng sau là lý do.
 * Người khai sửa xong gửi lại thì qcNote xoá về null — ca lại chờ KCS như mới.
 *
 * File này không đụng database để dùng được cả ở trình duyệt lẫn trong test.
 */

export const SHIFT_RETURN_PREFIX = "[KCS trả về]";
export const SHIFT_RETURN_MIN_REASON = 10;

/** qcNote khi KCS trả ca về: dòng đầu là tiền tố + tên người trả, sau đó là lý do */
export function buildShiftReturnNote(actorName: string, reason: string) {
  return `${SHIFT_RETURN_PREFIX} ${actorName.trim()}\n${reason.trim()}`;
}

/** Đọc lại người trả và lý do từ qcNote. Không phải ca bị trả về → null. */
export function extractShiftReturn(
  qcNote?: string | null
): { by: string; reason: string } | null {
  const t = (qcNote ?? "").trim();
  if (!t.startsWith(SHIFT_RETURN_PREFIX)) return null;
  const [first, ...rest] = t.split("\n");
  return {
    by: first.slice(SHIFT_RETURN_PREFIX.length).trim(),
    reason: rest.join("\n").trim(),
  };
}

/** Ca đang nằm ở phía sản xuất chờ sửa (DRAFT + ghi chú trả về) */
export function isShiftReturned(s: { status: string; qcNote?: string | null }) {
  return s.status === "DRAFT" && extractShiftReturn(s.qcNote) !== null;
}

/* ------------------------------------------------- LỆCH CÂN ĐỐI KHỐI LƯỢNG */

/**
 * Lệch cân đối quá ngưỡng này (kg) thì KCS phải ghi lý do khi xác nhận. Cùng
 * ngưỡng tuyệt đối với Luật 3 chống chạy chỉ tiêu — lệch tới mức hệ thống sẽ
 * bắt bất thường thì người cân phải nói vì sao ngay lúc cân, không đợi tới
 * lúc bị hỏi.
 */
export const MASS_GAP_REASON_KG = ANTI_GAMING.MASS_BALANCE_ABS_KG;
export const MASS_GAP_MIN_REASON = 10;
export const MASS_GAP_NOTE_PREFIX = "[Lệch cân đối";

/** Thô trừ (đạt + làm lại + phế), làm tròn 2 chữ số. Dương = thiếu, âm = thừa. */
export function massGapKg(
  rawOutputKg: number,
  parts: { qcPassedKg: number; reworkKg: number; scrapKg: number }
) {
  const gap = rawOutputKg - (parts.qcPassedKg + parts.reworkKg + parts.scrapKg);
  return Math.round(gap * 100) / 100;
}

export function needsMassGapReason(gapKg: number) {
  return Math.abs(gapKg) > MASS_GAP_REASON_KG;
}

/** Dòng ghi chú KCS ghi lại lý do lệch: "[Lệch cân đối thiếu 40 kg] cân sót lô 2" */
export function buildMassGapNoteLine(gapKg: number, reason: string) {
  const dir = gapKg > 0 ? "thiếu" : "thừa";
  return `${MASS_GAP_NOTE_PREFIX} ${dir} ${fmtNum(Math.abs(gapKg))} kg] ${reason.replace(/\s+/g, " ").trim()}`;
}

/* ------------------------------------------------------ NHÃN HIỂN THỊ */

/**
 * "Chặng" của ca để hiển thị và lọc: như status, thêm RETURNED cho ca bị KCS
 * trả về (thực chất vẫn DRAFT trong database).
 */
export const SHIFT_STAGES = ["DRAFT", "RETURNED", "QC_APPROVED", "LOCKED"] as const;
export type ShiftStage = (typeof SHIFT_STAGES)[number];

export function shiftStage(s: { status: string; qcNote?: string | null }): ShiftStage {
  if (isShiftReturned(s)) return "RETURNED";
  return (["DRAFT", "QC_APPROVED", "LOCKED"].includes(s.status) ? s.status : "DRAFT") as ShiftStage;
}

export const SHIFT_STAGE_LABEL: Record<ShiftStage, string> = {
  DRAFT: "Sản xuất đã khai — chờ KCS",
  RETURNED: "KCS trả về — chờ sản xuất sửa",
  QC_APPROVED: "KCS đã xác nhận — chờ Ban Giám đốc khoá",
  LOCKED: "Đã khoá số",
};
