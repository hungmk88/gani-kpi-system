import { handle, ok, requireUser } from "@/lib/api";
import { getAnnualLeaveQuota } from "@/lib/services/leave-service";

/** Hạn mức phép năm hiện tại của chính người gọi — 12 ngày/năm, chỉ tính đơn đã duyệt. */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const quota = await getAnnualLeaveQuota(user.id, new Date().getFullYear());
    return ok({ quota });
  });
}
