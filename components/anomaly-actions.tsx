"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

/**
 * Hai thao tác trên một cảnh báo khai báo bất thường.
 *
 * Khác với phần chống chạy chỉ tiêu ở xưởng: cảnh báo này KHÔNG khoá thưởng và
 * không trừ điểm gì cả. Nó chỉ là một dấu hiệu thống kê — số kỳ này lệch hẳn nếp
 * cũ của chính người đó. Lệch có thể vì khai khống, mà cũng có thể vì tháng đó
 * có đơn hàng lớn thật. Nên chỉ hỏi, không kết luận.
 */
export default function AnomalyActions({
  anomalyId,
  status,
  isOwner,
  canReview,
}: {
  anomalyId: string;
  status: string;
  isOwner: boolean;
  canReview: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");

  async function call(payload: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/analytics/anomalies/${anomalyId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.message || "Thao tác thất bại.");
        return;
      }
      setText("");
      setNote("");
      router.refresh();
    } catch {
      setError("Mất kết nối tới máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-ink-100 pt-3">
      {error && (
        <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {status === "OPEN" && isOwner && (
        <div className="space-y-2">
          <label className="label">
            Giải thích vì sao số kỳ này khác hẳn (tối thiểu 20 ký tự)
          </label>
          <textarea
            className="input min-h-20"
            placeholder="Ví dụ: tháng này có đơn hàng Tết của chuỗi 12 cửa hàng nên doanh thu cao gấp đôi bình thường, đã có hợp đồng và phiếu giao hàng kèm theo."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            className="btn-primary btn-sm"
            disabled={busy || text.trim().length < 20}
            onClick={() => call({ action: "EXPLAIN", explanationText: text })}
          >
            {busy ? "Đang gửi..." : "Gửi giải thích"}
          </button>
        </div>
      )}

      {status === "OPEN" && !isOwner && (
        <p className="text-xs text-ink-500">
          Đang chờ người khai vào giải thích. Bạn có thể duyệt luôn nếu đã rõ
          nguyên nhân.
        </p>
      )}

      {(status === "EXPLAINED" || (status === "OPEN" && !isOwner)) &&
        canReview && (
          <div className="mt-2 space-y-2">
            <label className="label">
              Kết luận của bạn (tối thiểu 10 ký tự) — người khai sẽ đọc được câu này
            </label>
            <input
              className="input"
              placeholder="Ví dụ: chấp nhận, đã đối chiếu hợp đồng Tết"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-primary btn-sm inline-flex items-center gap-1.5"
                disabled={busy || note.trim().length < 10}
                onClick={() =>
                  call({ action: "REVIEW", accepted: true, reviewNote: note })
                }
              >
                <Check size={14} strokeWidth={2.5} /> Chấp nhận giải thích
              </button>
              <button
                className="btn-ghost btn-sm"
                disabled={busy || note.trim().length < 10}
                onClick={() =>
                  call({ action: "REVIEW", accepted: false, reviewNote: note })
                }
              >
                Bỏ qua cảnh báo này
              </button>
            </div>
            <p className="text-xs text-ink-500">
              &quot;Bỏ qua&quot; nghĩa là bạn xem rồi và thấy không cần làm gì —
              không phải là kết tội ai.
            </p>
          </div>
        )}

      {status === "EXPLAINED" && !canReview && (
        <p className="text-xs text-ink-500">
          Đã gửi giải thích, đang chờ trưởng phòng hoặc Ban Giám đốc xem.
        </p>
      )}
    </div>
  );
}
