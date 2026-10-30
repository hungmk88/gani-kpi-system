"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Smartphone } from "lucide-react";
import ConfirmDialog from "@/components/confirm-dialog";

type LinkInfo = {
  code: string;
  ttlMinutes: number;
  botUsername: string | null;
  telegramEnabled: boolean;
  alreadyLinked: boolean;
};

/**
 * Tự nối tài khoản Telegram bằng mã một lần (8 ký tự).
 *
 * Trước đây quản trị phải đi hỏi chat_id của từng người rồi chép tay vào hệ
 * thống — vừa mất công vừa dễ chép nhầm sang người khác, mà chép nhầm thì thông
 * báo lương thưởng của người này bay sang máy người kia.
 */
export default function TelegramLink({ linked }: { linked: boolean }) {
  const router = useRouter();
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [askUnlink, setAskUnlink] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function getCode() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/telegram/link", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "Không lấy được mã.");
        return;
      }
      setInfo(data);
    } catch {
      setError("Không kết nối được máy chủ, thử lại sau.");
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setAskUnlink(false);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/telegram/link", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || "Không ngắt nối được, thử lại sau.");
        return;
      }
      setInfo(null);
      router.refresh();
    } catch {
      setError("Không kết nối được máy chủ, thử lại sau.");
    } finally {
      setBusy(false);
    }
  }

  if (linked && !info) {
    return (
      <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <div className="flex items-center gap-1.5 font-medium text-ink-900">
            <CircleCheck size={16} strokeWidth={2} className="text-leaf-600" aria-hidden />{" "}
            Đã nối Telegram
          </div>
          <div className="mt-0.5 text-xs text-ink-500">
            Thông báo sẽ về cả trong ứng dụng lẫn Telegram. Trong Telegram gõ
            /trogiup để xem các lệnh dùng được.
          </div>
        </div>
        <button
          className="btn-ghost btn-sm"
          disabled={busy}
          onClick={() => setAskUnlink(true)}
        >
          {busy ? "Đang ngắt..." : "Ngắt nối"}
        </button>
        <ConfirmDialog
          open={askUnlink}
          tone="danger"
          title="Ngắt nối Telegram?"
          confirmLabel="Ngắt nối"
          onClose={() => setAskUnlink(false)}
          onConfirm={unlink}
        >
          <p>
            Bạn sẽ không nhận thông báo và không bấm duyệt qua Telegram nữa. Muốn
            nối lại thì lấy mã liên kết mới ở trang này.
          </p>
        </ConfirmDialog>
        {error && (
          <div className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>
    );
  }

  if (!info) {
    return (
      <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <div className="flex items-center gap-1.5 font-medium text-ink-900">
            <Smartphone size={16} strokeWidth={2} aria-hidden /> Nhận thông báo qua Telegram
          </div>
          <div className="mt-0.5 text-xs text-ink-500">
            Nối một lần, sau đó việc giao cho bạn và hạn KPI sẽ báo thẳng vào
            điện thoại.
          </div>
        </div>
        <button className="btn-primary btn-sm" disabled={busy} onClick={getCode}>
          {busy ? "Đang tạo mã..." : "Nối Telegram"}
        </button>
        {error && (
          <div className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card mb-4 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-1.5 font-medium text-ink-900">
          <Smartphone size={16} strokeWidth={2} aria-hidden /> Nối Telegram — 3 bước
        </div>
        <button className="btn-ghost btn-sm" onClick={() => setInfo(null)}>
          Đóng
        </button>
      </div>

      {!info.telegramEnabled && (
        <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Hệ thống chưa bật gửi thông báo qua Telegram. Bạn vẫn lấy mã được,
          nhưng bot chưa chạy nên chưa nối được. Báo quản trị bật giúp.
        </div>
      )}

      <ol className="mb-4 space-y-2 text-sm text-ink-700">
        <li>
          <b>1.</b> Mở Telegram, tìm bot của công ty
          {info.botUsername ? (
            <>
              {": "}
              <a
                href={`https://t.me/${info.botUsername.replace(/^@/, "")}?start=${info.code}`}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-brand-600 hover:underline"
              >
                @{info.botUsername.replace(/^@/, "")}
              </a>{" "}
              <span className="text-xs text-ink-500">
                (bấm vào đây là Telegram tự mở và điền sẵn mã)
              </span>
            </>
          ) : (
            <span className="text-ink-500">
              {" "}
              — hỏi quản trị tên bot của công ty
            </span>
          )}
        </li>
        <li>
          <b>2.</b> Gõ đúng dòng này vào khung chat với bot:
        </li>
      </ol>

      <div className="mb-3 rounded-md bg-ink-50 px-4 py-3 text-center">
        <code className="font-mono text-lg font-bold tracking-wider text-ink-900">
          /start {info.code}
        </code>
      </div>

      <p className="mb-3 text-sm text-ink-700">
        <b>3.</b> Bot trả lời “Đã nối xong” là được. Quay lại đây bấm tải lại
        trang để thấy trạng thái.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-ghost btn-sm" onClick={() => router.refresh()}>
          Tôi đã nối xong, kiểm tra lại
        </button>
        <span className="text-xs text-ink-500">
          Mã sống {info.ttlMinutes} phút và chỉ dùng được một lần.
        </span>
      </div>
    </div>
  );
}
