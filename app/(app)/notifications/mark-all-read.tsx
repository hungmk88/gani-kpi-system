"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function MarkAllRead() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      className="btn-ghost btn-sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/notifications/read", { method: "POST" });
        router.refresh();
        setBusy(false);
      }}
    >
      {busy ? "Đang xử lý..." : "Đánh dấu đã đọc tất cả"}
    </button>
  );
}
