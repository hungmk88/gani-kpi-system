import { handle, ok, requireUser } from "@/lib/api";
import { getAnnualLeaveQuota } from "@/lib/services/leave-service";
import { vnParts } from "@/lib/vn-time";

/** Hạn mức phép năm hiện tại của chính người gọi — 12 ngày/năm, chỉ tính đơn đã duyệt. */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const quota = await getAnnualLeaveQuota(user.id, vnParts(new Date()).year);
    return ok({ quota });
  });
}
