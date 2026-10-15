"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toast";

export default function MarkAllRead() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        className="btn-ghost btn-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const res = await fetch("/api/notifications/read", { method: "POST" });
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              setError(data.message || "Không đánh dấu được, thử lại sau.");
              return;
            }
            toast("Đã đánh dấu đã đọc tất cả thông báo.");
            router.refresh();
          } catch {
            // Mất mạng / server không trả lời — không để nút kẹt ở "Đang xử lý".
            setError("Không kết nối được máy chủ, thử lại sau.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Đang xử lý…" : "Đánh dấu đã đọc tất cả"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
