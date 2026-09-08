import { z } from "zod";
import { handle, ok, requireUser } from "@/lib/api";
import { BusinessError } from "@/lib/rbac";
import { testTelegram } from "@/lib/telegram";
import { ERR } from "@/lib/constants";

export const runtime = "nodejs";

const schema = z.object({ chatId: z.string().min(1, "Chưa nhập Chat ID.") });

/** Bắn thử một tin nhắn để kiểm tra cấu hình Telegram. */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    if (user.role !== "ADMIN" && user.role !== "CEO") {
      throw new BusinessError(
        ERR.FORBIDDEN,
        "Chỉ quản trị hệ thống và Ban Giám đốc mới kiểm tra được kết nối Telegram.",
        403
      );
    }
    const { chatId } = schema.parse(await req.json());
    const res = await testTelegram(chatId);
    return ok(res);
  });
}
