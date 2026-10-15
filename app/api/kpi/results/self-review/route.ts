import { z } from "zod";
import { handle, ok, requireUser } from "@/lib/api";
import { assertPermission, BusinessError } from "@/lib/rbac";
import { clientMeta } from "@/lib/audit";
import { submitSelfReview } from "@/lib/services/kpi-service";

const schema = z.object({
  items: z
    .array(
      z.object({
        resultId: z.string().min(1),
        actualSelf: z.number().finite(),
        selfNote: z.string().max(2000).optional(),
      })
    )
    .min(1)
    .max(100),
});

/**
 * "Gửi tất cả" — nhân viên gửi một lượt mọi chỉ tiêu đã điền số.
 *
 * Mỗi dòng vẫn đi qua đúng submitSelfReview (kiểm quyền chủ sở hữu, hạn ngày
 * 2, khoá có điều kiện, nhật ký, báo lệch số) — endpoint này chỉ gom request.
 * Dòng nào lỗi thì báo đúng dòng đó, các dòng khác vẫn gửi được: không ai
 * muốn mất cả 8 số vừa gõ chỉ vì 1 dòng trưởng phòng đã duyệt trước.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    assertPermission(user, "kpi.self_review");
    const body = schema.parse(await req.json());
    const meta = clientMeta(req);

    const submitted: string[] = [];
    const failed: { resultId: string; message: string }[] = [];
    for (const item of body.items) {
      try {
        await submitSelfReview(
          user,
          item.resultId,
          { actualSelf: item.actualSelf, selfNote: item.selfNote },
          meta
        );
        submitted.push(item.resultId);
      } catch (e) {
        // Lỗi nghiệp vụ thì nói đúng lý do; lỗi lạ thì ném ra cho handle()
        if (!(e instanceof BusinessError)) throw e;
        failed.push({ resultId: item.resultId, message: e.message });
      }
    }

    return ok({ submitted: submitted.length, failed });
  });
}
