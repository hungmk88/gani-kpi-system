"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip } from "lucide-react";
import { toast } from "@/components/toast";
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL } from "@/lib/constants";
import { isHttpUrl } from "@/lib/http-url";

type Task = {
  id: string;
  status: string;
  priority: string;
  progress: number;
  assigneeId: string | null;
};

/**
 * Cột cập nhật phụ của việc: tiến độ, ưu tiên, người phụ trách, trao đổi và
 * bằng chứng. Nút đổi trạng thái nằm ở đầu trang (status-actions.tsx) — đó là
 * thứ người làm cần bấm nhiều nhất, không để chìm dưới đáy.
 */
export default function TaskActions({
  task,
  canManage,
  assignableUsers,
  isManagerRole,
}: {
  task: Task;
  /** Người giao việc / trưởng phòng phụ trách / BGĐ — khớp luật ở API */
  canManage: boolean;
  /** Trưởng phòng: nhắc danh sách người nhận chỉ trong phòng */
  isManagerRole: boolean;
  assignableUsers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(task.progress);
  const [comment, setComment] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");

  async function patch(payload: Record<string, unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "Không cập nhật được.");
        return;
      }
      toast(done);
      router.refresh();
    } catch {
      setError("Mất kết nối tới máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  const url = evidenceUrl.trim();
  const urlInvalid = url !== "" && !isHttpUrl(url);

  async function postComment() {
    if (!comment.trim() || urlInvalid) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Có đường dẫn thì là bằng chứng, không thì là trao đổi thường
        body: JSON.stringify(
          url
            ? { body: comment, kind: "EVIDENCE", fileUrl: url }
            : { body: comment }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "Không gửi được.");
        return;
      }
      setComment("");
      setEvidenceUrl("");
      toast(url ? "Đã thêm bằng chứng" : "Đã gửi trao đổi");
      router.refresh();
    } catch {
      setError("Mất kết nối tới máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <h3 className="section-title mb-3">Cập nhật công việc</h3>

      {error && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* Tiến độ */}
      <div className="mb-4">
        <label className="label" htmlFor="task-progress">
          Tiến độ: {progress}%
        </label>
        <input
          id="task-progress"
          type="range"
          min={0}
          max={100}
          step={5}
          value={progress}
          onChange={(e) => setProgress(Number(e.target.value))}
          className="w-full accent-brand-600"
        />
        {progress !== task.progress && (
          <button
            disabled={busy}
            onClick={() => patch({ progress }, `Đã lưu tiến độ ${progress}%`)}
            className="btn-ghost btn-sm mt-2 w-full"
          >
            Lưu tiến độ {progress}%
          </button>
        )}
      </div>

      {/* Quyền người quản việc */}
      {canManage && (
        <>
          <div className="mb-4">
            <label className="label" htmlFor="task-priority">
              Mức ưu tiên
            </label>
            <select
              id="task-priority"
              className="input"
              value={task.priority}
              disabled={busy}
              onChange={(e) =>
                patch(
                  { priority: e.target.value },
                  `Đã đổi mức ưu tiên sang ${TASK_PRIORITY_LABEL[e.target.value] ?? e.target.value}`
                )
              }
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {TASK_PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </div>

          {assignableUsers.length > 0 && (
            <div className="mb-4">
              <label className="label" htmlFor="task-assignee">
                Người phụ trách
              </label>
              <select
                id="task-assignee"
                className="input"
                value={task.assigneeId ?? ""}
                disabled={busy}
                onChange={(e) =>
                  patch(
                    { assigneeId: e.target.value || null },
                    e.target.value ? "Đã chuyển giao việc" : "Đã bỏ người phụ trách"
                  )
                }
              >
                <option value="">— Chưa giao —</option>
                {assignableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              {isManagerRole && (
                <p className="mt-1.5 text-xs text-ink-500">
                  Danh sách chỉ gồm nhân sự phòng bạn — hệ thống chặn giao việc
                  vượt cấp.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* Trao đổi + bằng chứng */}
      <div className="border-t border-ink-100 pt-4">
        <label className="label" htmlFor="task-comment">
          Viết trao đổi
        </label>
        <textarea
          id="task-comment"
          className="input min-h-20"
          placeholder="Báo cáo tiến độ, hỏi ý kiến, mô tả bằng chứng..."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <label className="label mt-3" htmlFor="task-evidence">
          <Paperclip size={12} strokeWidth={2} className="mr-1 inline -mt-0.5" aria-hidden />
          Đường dẫn bằng chứng (tuỳ chọn)
        </label>
        <input
          id="task-evidence"
          type="url"
          inputMode="url"
          className="input"
          placeholder="https://drive.google.com/…"
          value={evidenceUrl}
          onChange={(e) => setEvidenceUrl(e.target.value)}
          aria-invalid={urlInvalid}
        />
        {urlInvalid ? (
          <p className="mt-1 text-xs text-red-700">
            Đường dẫn phải bắt đầu bằng http:// hoặc https://.
          </p>
        ) : (
          <p className="mt-1 text-xs text-ink-500">
            Ảnh, biên bản, tệp trên Drive… Có đường dẫn thì dòng này được đánh
            dấu là bằng chứng.
          </p>
        )}
        <button
          disabled={busy || !comment.trim() || urlInvalid}
          onClick={postComment}
          className="btn-ghost mt-2 w-full"
        >
          {url ? "Gửi bằng chứng" : "Gửi trao đổi"}
        </button>
      </div>
    </div>
  );
}
