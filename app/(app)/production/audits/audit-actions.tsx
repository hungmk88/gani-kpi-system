"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Ban } from "lucide-react";

/**
 * Hai thao tác trên một cảnh báo:
 *   - Quản đốc / tổ trưởng viết giải trình
 *   - Ban Giám đốc chấp nhận (mở khoá thưởng) hoặc từ chối (giữ khoá)
 *
 * Thưởng chỉ mở khi ca đó hết sạch cảnh báo treo và không cái nào bị từ chối.
 * Duyệt một cái mà còn hai cái đang chờ thì vẫn khoá — hệ thống nói rõ điều đó.
 *
 * Tách bạch: ai viết giải trình thì không tự quyết giải trình đó (máy chủ cũng
 * chặn). Tổ trưởng chỉ giải trình ca mình có làm / mình khai.
 */
export default function AuditActions({
  auditId,
  shiftId,
  status,
  canExplain,
  isCeo,
  explainedByMe = false,
}: {
  auditId: string;
  shiftId: string;
  status: string;
  canExplain: boolean;
  isCeo: boolean;
  /** Người đang xem chính là người viết giải trình → không được tự quyết */
  explainedByMe?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");

  async function call(payload: unknown) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/production/audits/${auditId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Thao tác thất bại.");
        return;
      }
      if (data.bonusUnlocked === true) {
        setMessage("Đã mở khoá thưởng cho cả ca.");
      } else if (data.bonusUnlocked === false && data.stillOpen > 0) {
        setMessage(
          `Đã ghi nhận, nhưng ca này còn ${data.stillOpen} cảnh báo chưa xử lý nên thưởng vẫn khoá.`
        );
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

  const done = status === "CEO_APPROVED" || status === "REJECTED";

  return (
    <div className="border-t border-ink-100 pt-3">
      {error && (
        <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {message && (
        <div className="mb-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </div>
      )}

      {status === "PENDING_EXPLANATION" && canExplain && (
        <div className="space-y-2">
          <label className="label">
            Giải trình (tối thiểu 20 ký tự) — nói rõ nguyên nhân, dẫn được chứng
            từ thì càng tốt
          </label>
          <textarea
            className="input min-h-20"
            placeholder="Ví dụ: lô thịt đông ngày 07/09 rã đông hao nước cao hơn thường lệ 3,5% nên phải cấp thêm NVL cho đủ kg thành phẩm. Có biên bản bàn giao kho kèm theo."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            className="btn-primary btn-sm"
            disabled={busy || text.trim().length < 20}
            onClick={() =>
              call({ action: "EXPLAIN", explanationText: text })
            }
          >
            {busy ? "Đang gửi..." : "Gửi giải trình cho Ban Giám đốc"}
          </button>
        </div>
      )}

      {status === "PENDING_EXPLANATION" && !canExplain && (
        <p className="text-xs text-ink-500">
          Đang chờ tổ trưởng của ca, quản đốc hoặc Giám đốc Sản xuất vào giải
          trình.
        </p>
      )}

      {status === "EXPLAINED" && isCeo && explainedByMe && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Bạn là người viết giải trình này nên không tự quyết được. Cần một thành
          viên Ban Giám đốc khác xem xét.
        </p>
      )}

      {status === "EXPLAINED" && isCeo && !explainedByMe && (
        <div className="space-y-2">
          <label className="label">
            Ý kiến của bạn (tối thiểu 10 ký tự) — người bị khoá thưởng sẽ đọc
            được câu này
          </label>
          <input
            className="input"
            placeholder="Ví dụ: chấp nhận, nhưng yêu cầu KCS kiểm soát khâu rã đông từ tuần sau"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-success btn-sm inline-flex items-center gap-1.5"
              disabled={busy || note.trim().length < 10}
              onClick={() =>
                call({ action: "REVIEW", approved: true, reviewNote: note })
              }
            >
              <Check size={14} strokeWidth={2.5} /> Đồng ý — mở khoá thưởng
            </button>
            <button
              className="btn-danger btn-sm inline-flex items-center gap-1.5"
              disabled={busy || note.trim().length < 10}
              onClick={() =>
                call({ action: "REVIEW", approved: false, reviewNote: note })
              }
            >
              <Ban size={14} strokeWidth={2} /> Từ chối — giữ khoá thưởng
            </button>
          </div>
        </div>
      )}

      {status === "EXPLAINED" && !isCeo && (
        <p className="text-xs text-ink-500">
          Đã gửi giải trình. Đang chờ Ban Giám đốc quyết.
        </p>
      )}

      <Link
        href={`/production/${shiftId}`}
        className={`inline-block text-xs text-brand-600 hover:underline ${done ? "" : "mt-2"}`}
      >
        Xem chi tiết ca sản xuất →
      </Link>
    </div>
  );
}
