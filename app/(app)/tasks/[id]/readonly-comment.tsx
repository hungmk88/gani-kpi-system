"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toast";

/**
 * Ô trao đổi cho người CHỈ được xem + trao đổi (người gửi Yêu cầu liên phòng
 * ban đã sinh ra việc này). Không có tiến độ / ưu tiên / người phụ trách như
 * task-actions.tsx — họ theo dõi việc nhờ phòng khác, không điều hành nó.
 */
export default function ReadonlyComment({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function postComment() {
    if (!comment.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: comment }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "Không gửi được.");
        return;
      }
      setComment("");
      toast("Đã gửi trao đổi");
      router.refresh();
    } catch {
      setError("Mất kết nối tới máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <h3 className="section-title mb-1">Trao đổi với phòng thực hiện</h3>
      <p className="mb-3 text-xs text-ink-500">
        Bạn đang theo dõi việc này với tư cách người gửi yêu cầu liên phòng ban —
        chỉ xem và trao đổi, không sửa được.
      </p>
      {error && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}
      <label className="label" htmlFor="task-comment-readonly">
        Viết trao đổi
      </label>
      <textarea
        id="task-comment-readonly"
        className="input min-h-20"
        placeholder="Hỏi tiến độ, bổ sung thông tin cho phòng thực hiện..."
        value={comment}
        maxLength={2000}
        onChange={(e) => setComment(e.target.value)}
      />
      <button
        disabled={busy || !comment.trim()}
        onClick={postComment}
        className="btn-ghost mt-2 w-full"
      >
        Gửi trao đổi
      </button>
    </div>
  );
}
