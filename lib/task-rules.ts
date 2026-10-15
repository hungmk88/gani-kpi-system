/**
 * LUẬT ĐỔI TRẠNG THÁI CÔNG VIỆC CẦN LÝ DO.
 *
 * Tách riêng khỏi task-service (vốn kéo theo Prisma, Telegram…) để cả nút bấm
 * phía trình duyệt lẫn API dùng CHUNG một luật: giao diện hỏi lý do đúng lúc
 * API đòi lý do, không có chuyện nút bấm cho qua rồi máy chủ mới từ chối.
 *
 * Vì sao bắt lý do:
 *  - "Báo tắc" mà không nói tắc vì gì thì trưởng phòng nhận thông báo cũng
 *    không gỡ được — phải đi hỏi lại, mất thêm một vòng.
 *  - "Làm lại" / "Mở lại việc" là đảo ngược một kết quả đã nộp/đã nghiệm thu;
 *    người làm cần biết sai ở đâu, và dòng thời gian của việc cần lưu vết.
 */

export const TASK_REASON_MIN_LENGTH = 5;

const OPEN_AGAIN = ["BACKLOG", "TO_DO", "IN_PROGRESS"];

export type TaskReasonKind = "BLOCK" | "REOPEN";

/** Đổi trạng thái `from` → `to` có bắt buộc ghi lý do không, và vì sao. */
export function reasonRequiredFor(
  from: string,
  to: string
): TaskReasonKind | null {
  if (from === to) return null;
  if (to === "BLOCKED") return "BLOCK";
  // Việc đã nghiệm thu / đã huỷ được mở lại (về một trạng thái còn mở —
  // Hoàn thành → Đã huỷ không phải là "mở lại")
  if ((from === "DONE" || from === "CANCELLED") && (OPEN_AGAIN.includes(to) || to === "REVIEW")) {
    return "REOPEN";
  }
  // Việc đang chờ duyệt bị trả về làm tiếp ("Làm lại")
  if (from === "REVIEW" && OPEN_AGAIN.includes(to)) return "REOPEN";
  return null;
}

/** Lý do đủ dài chưa — tính sau khi bỏ khoảng trắng hai đầu. */
export function isValidReason(note: string | null | undefined) {
  return (note ?? "").trim().length >= TASK_REASON_MIN_LENGTH;
}
