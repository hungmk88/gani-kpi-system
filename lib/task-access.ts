import { prisma } from "./db";

/**
 * QUYỀN TRÊN MỘT CÔNG VIỆC — một nguồn duy nhất cho API chi tiết, API trao đổi
 * và trang chi tiết (trước đây ba nơi tự viết ba luật khác nhau: trang cho
 * ADMIN xem, API chi tiết chặn ADMIN, API trao đổi lại cho ADMIN bình luận).
 *
 *   EDIT     — xem, trao đổi, sửa (trong giới hạn từng trường của PATCH)
 *   COMMENT  — xem và trao đổi, KHÔNG sửa: người gửi Yêu cầu liên phòng ban
 *              đã sinh ra việc này (cần theo dõi việc mình nhờ phòng khác)
 *   VIEW     — chỉ xem: Quản trị hệ thống (thấy mọi việc trong danh sách để
 *              hỗ trợ kỹ thuật, nhưng không tham gia nghiệp vụ)
 *   NONE     — không thấy
 */
export type TaskAccess = "EDIT" | "COMMENT" | "VIEW" | "NONE";

type TaskLike = { assigneeId: string | null; creatorId: string; departmentId: string };
type UserLike = { id: string; role: string; departmentId: string | null };

/** Phần thuần (không đọc DB) — test được. `isRequester`: người gửi yêu cầu liên phòng. */
export function decideTaskAccess(task: TaskLike, user: UserLike, isRequester: boolean): TaskAccess {
  const isOwner = task.assigneeId === user.id || task.creatorId === user.id;
  const sameDept = !!user.departmentId && task.departmentId === user.departmentId;

  if (user.role === "CEO") return "EDIT";
  if (user.role === "MANAGER" && (sameDept || isOwner)) return "EDIT";
  if (user.role === "EMPLOYEE" && isOwner) return "EDIT";
  if (isRequester) return "COMMENT";
  if (user.role === "ADMIN") return "VIEW";
  return "NONE";
}

/** Người này có phải người gửi Yêu cầu liên phòng ban đã tạo ra việc này không. */
export async function isCrossDeptRequester(taskId: string, userId: string) {
  const found = await prisma.crossDeptRequest.findFirst({
    where: { createdTaskId: taskId, requesterId: userId },
    select: { id: true },
  });
  return !!found;
}

export async function taskAccessFor(task: TaskLike & { id: string }, user: UserLike) {
  const direct = decideTaskAccess(task, user, false);
  // Chỉ hỏi DB khi luật trực tiếp chưa cho sửa
  if (direct === "EDIT") return direct;
  const requester = await isCrossDeptRequester(task.id, user.id);
  return decideTaskAccess(task, user, requester);
}

export const canViewTask = (a: TaskAccess) => a !== "NONE";
export const canCommentTask = (a: TaskAccess) => a === "EDIT" || a === "COMMENT";
export const canEditTask = (a: TaskAccess) => a === "EDIT";
