"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Ban, Check, Undo2, CircleCheck, type LucideIcon } from "lucide-react";
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL } from "@/lib/constants";

type Task = {
  id: string;
  status: string;
  priority: string;
  progress: number;
  assigneeId: string | null;
  dueDate: string;
};

/** Nút bấm nhanh — nhân viên ngoài xưởng cập nhật việc trong 3 chạm. */
const QUICK: Record<
  string,
  { label: string; icon: LucideIcon; status: string; cls: string }[]
> = {
  TO_DO: [
    { label: "Bắt đầu làm", icon: Play, status: "IN_PROGRESS", cls: "btn-primary" },
    { label: "Báo tắc", icon: Ban, status: "BLOCKED", cls: "btn-ghost" },
  ],
  IN_PROGRESS: [
    { label: "Xong, xin nghiệm thu", icon: Check, status: "REVIEW", cls: "btn-success" },
    { label: "Báo tắc", icon: Ban, status: "BLOCKED", cls: "btn-ghost" },
  ],
  BLOCKED: [
    { label: "Đã gỡ, làm tiếp", icon: Play, status: "IN_PROGRESS", cls: "btn-primary" },
  ],
  REVIEW: [
    { label: "Làm lại", icon: Undo2, status: "IN_PROGRESS", cls: "btn-ghost" },
  ],
  DONE: [{ label: "Mở lại việc", icon: Undo2, status: "IN_PROGRESS", cls: "btn-ghost" }],
};

export default function TaskActions({
  task,
  role,
  assignableUsers,
}: {
  task: Task;
  role: string;
  assignableUsers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState(task.progress);
  const [comment, setComment] = useState("");

  const canApprove = role === "MANAGER" || role === "CEO";

  async function patch(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, note: note || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Không cập nhật được.");
        return;
      }
      setNote("");
      router.refresh();
    } catch {
      setError("Mất kết nối tới máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  async function postComment() {
    if (!comment.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: comment }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Không gửi được.");
        return;
      }
      setComment("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const quick = QUICK[task.status] ?? [];

  return (
    <div className="card p-5">
      <h3 className="section-title mb-3">Cập nhật công việc</h3>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Thao tác nhanh */}
      <div className="mb-4 space-y-2">
        {quick.map((q) => (
          <button
            key={q.status}
            disabled={busy}
            onClick={() => patch({ status: q.status })}
            className={`${q.cls} inline-flex w-full items-center justify-center gap-1.5`}
          >
            <q.icon size={14} strokeWidth={2} /> {q.label}
          </button>
        ))}
        {task.status === "REVIEW" && canApprove && (
          <button
            disabled={busy}
            onClick={() => patch({ status: "DONE" })}
            className="btn-success inline-flex w-full items-center justify-center gap-1.5"
          >
            <CircleCheck size={14} strokeWidth={2} /> Nghiệm thu · Hoàn thành
          </button>
        )}
      </div>

      {/* Ghi chú kèm thao tác */}
      <div className="mb-4">
        <label className="label">Ghi chú kèm theo (tuỳ chọn)</label>
        <input
          className="input"
          placeholder="Ví dụ: đang chờ nguyên liệu về"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {/* Tiến độ */}
      <div className="mb-4">
        <label className="label">Tiến độ: {progress}%</label>
        <input
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
            onClick={() => patch({ progress })}
            className="btn-ghost btn-sm mt-2 w-full"
          >
            Lưu tiến độ {progress}%
          </button>
        )}
      </div>

      {/* Quyền trưởng phòng trở lên */}
      {canApprove && (
        <>
          <div className="mb-4">
            <label className="label">Mức ưu tiên</label>
            <select
              className="input"
              value={task.priority}
              disabled={busy}
              onChange={(e) => patch({ priority: e.target.value })}
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
              <label className="label">Người phụ trách</label>
              <select
                className="input"
                value={task.assigneeId ?? ""}
                disabled={busy}
                onChange={(e) =>
                  patch({ assigneeId: e.target.value || null })
                }
              >
                <option value="">— Chưa giao —</option>
                {assignableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              {role === "MANAGER" && (
                <p className="mt-1.5 text-xs text-ink-500">
                  Danh sách chỉ gồm nhân sự phòng bạn — hệ thống chặn giao việc
                  vượt cấp.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* Bình luận */}
      <div className="border-t border-ink-100 pt-4">
        <label className="label">Viết trao đổi</label>
        <textarea
          className="input min-h-20"
          placeholder="Báo cáo tiến độ, hỏi ý kiến, gửi bằng chứng..."
          value={comment}
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
    </div>
  );
}
