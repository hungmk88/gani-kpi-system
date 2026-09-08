import { NextResponse } from "next/server";
import { handleTelegramUpdate } from "@/lib/telegram-bot";
import { clientMeta } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * NƠI TELEGRAM GỌI VÀO khi có người nhắn bot hoặc bấm nút.
 *
 * Chốt chặn đầu tiên: Telegram phải gửi kèm header bí mật đã khai lúc setWebhook.
 * Thiếu hoặc sai là chặn ngay, chưa đọc tới nội dung. Không có bước này thì bất
 * cứ ai biết địa chỉ cũng tự chế được gói tin "CEO vừa bấm duyệt".
 *
 * Luôn trả 200 cho tin hợp lệ — Telegram thấy mã lỗi sẽ gửi lại tin đó liên tục,
 * gây lặp thao tác. Lỗi nghiệp vụ được báo cho người dùng ngay trong chat.
 */
export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!secret) {
    console.error(
      "[TELEGRAM] Nhận được gói tin nhưng chưa đặt TELEGRAM_WEBHOOK_SECRET — từ chối."
    );
    return NextResponse.json(
      { ok: false, error: "Webhook chưa được cấu hình khoá bí mật." },
      { status: 503 }
    );
  }

  const provided = req.headers.get("x-telegram-bot-api-secret-token");
  if (provided !== secret) {
    console.warn("[TELEGRAM] Gói tin sai khoá bí mật, đã chặn.");
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: unknown;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  try {
    const result = await handleTelegramUpdate(
      update as never,
      clientMeta(req).ip
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    // Nuốt lỗi có chủ đích: trả lỗi ra là Telegram gửi lại gói tin đó mãi
    console.error("[TELEGRAM] Xử lý cập nhật thất bại:", e);
    return NextResponse.json({ ok: true, handled: false });
  }
}
