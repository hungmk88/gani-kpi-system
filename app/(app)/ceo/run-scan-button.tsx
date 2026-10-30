"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";

/** Chạy tay bộ máy nền: quét rủi ro + kiểm tra mốc khoá KPI. */
export default function RunScanButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      // fetchJson không throw: mất mạng / 504 khi quét lâu đều ra thông báo
      // tiếng Việt thay vì nút ngừng quay mà không nói gì.
      const res = await fetchJson<{
        riskScan?: { scanned: number; newCritical: number };
        errors?: Record<string, unknown>;
      }>("/api/cron/run", { method: "POST" });
      const data = res.data;
      if (!res.ok) {
        setMsg(res.message || "Không chạy được.");
        return;
      }
      const failed = Object.keys(data.errors ?? {});
      setMsg(
        data.riskScan
          ? `Đã quét ${data.riskScan.scanned} việc · ${data.riskScan.newCritical} việc vừa lên báo động đỏ.` +
              (failed.length ? ` (${failed.length} bước lỗi: ${failed.join(", ")})` : "")
          : `Chạy xong nhưng có bước lỗi: ${failed.join(", ")}.`
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {msg && <span className="text-xs text-ink-600">{msg}</span>}
      <button
        className="btn-ghost btn-sm inline-flex items-center gap-1.5"
        disabled={busy}
        onClick={run}
      >
        {busy ? (
          "Đang quét..."
        ) : (
          <>
            <RefreshCw size={13} strokeWidth={2} /> Quét lại rủi ro ngay
          </>
        )}
      </button>
    </div>
  );
}
