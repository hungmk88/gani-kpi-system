/**
 * CỔNG GỬI TIN ZALO ZNS.
 *
 * Zalo Notification Service chỉ cho gửi theo **mẫu đã được Zalo duyệt trước**,
 * không gửi được văn bản tự do như Telegram. Nên ở đây chỉ có vài loại tin đã
 * đăng ký sẵn, mỗi loại một template_id riêng trong .env.
 *
 * Chưa cấu hình thì toàn bộ hàm trả về trạng thái "tắt" chứ không ném lỗi —
 * hệ thống vẫn chạy, thông báo vẫn nằm đủ trong ứng dụng và Telegram.
 */

const ZNS_ENDPOINT = "https://business.openapi.zalo.me/message/template";

export type ZaloTemplateKind = "KPI_REMINDER" | "TASK_CRITICAL" | "KPI_LOCKED";

function templateId(kind: ZaloTemplateKind) {
  switch (kind) {
    case "KPI_REMINDER":
      return process.env.ZALO_TEMPLATE_KPI_REMINDER;
    case "TASK_CRITICAL":
      return process.env.ZALO_TEMPLATE_TASK_CRITICAL;
    case "KPI_LOCKED":
      return process.env.ZALO_TEMPLATE_KPI_LOCKED;
  }
}

export function zaloEnabled() {
  return (
    process.env.ZALO_ENABLED === "true" && !!process.env.ZALO_ZNS_ACCESS_TOKEN
  );
}

export type ZaloResult = {
  ok: boolean;
  skipped?: boolean;
  error?: string;
  messageId?: string;
};

/**
 * Chuẩn hoá số điện thoại về dạng Zalo yêu cầu: 84xxxxxxxxx.
 * Trả null nếu số không dùng được, để bên gọi biết mà bỏ qua thay vì gửi hỏng.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("84") && digits.length >= 11) return digits;
  if (digits.startsWith("0") && digits.length >= 10) return `84${digits.slice(1)}`;
  // Số 9 chữ số kiểu "912345678" - thiếu số 0 đầu
  if (digits.length === 9) return `84${digits}`;
  return null;
}

export async function sendZns(opts: {
  phone: string | null | undefined;
  kind: ZaloTemplateKind;
  data: Record<string, string>;
  timeoutMs?: number;
}): Promise<ZaloResult> {
  if (!zaloEnabled()) {
    return { ok: false, skipped: true, error: "Zalo ZNS đang tắt" };
  }

  const tpl = templateId(opts.kind);
  if (!tpl) {
    return {
      ok: false,
      skipped: true,
      error: `Chưa khai template_id cho loại tin ${opts.kind}`,
    };
  }

  const phone = normalizePhone(opts.phone);
  if (!phone) {
    return { ok: false, skipped: true, error: "Người nhận chưa có số điện thoại hợp lệ" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);

  try {
    const res = await fetch(ZNS_ENDPOINT, {
      method: "POST",
      headers: {
        access_token: process.env.ZALO_ZNS_ACCESS_TOKEN!,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        phone,
        template_id: tpl,
        template_data: opts.data,
        tracking_id: `gani_${opts.kind.toLowerCase()}_${Date.now()}`,
      }),
    });

    const body = await res.json().catch(() => null);

    // Zalo trả HTTP 200 kèm error != 0 khi hỏng, nên phải xem cả thân tin
    if (!res.ok || (body?.error !== undefined && body.error !== 0)) {
      return {
        ok: false,
        error: `Zalo ZNS lỗi ${body?.error ?? res.status}: ${
          body?.message ?? "không rõ"
        }`,
      };
    }

    return { ok: true, messageId: body?.data?.msg_id };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error && e.name === "AbortError"
          ? "Zalo ZNS phản hồi quá chậm"
          : e instanceof Error
            ? e.message
            : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}
