"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL } from "@/lib/constants";
import { addDays, vnDateKey } from "@/lib/vn-time";
import { vnLocalToIso } from "@/lib/vn-input";
import { fetchJson, jsonInit } from "@/lib/fetch-json";

type Opt = { id: string; name: string };

export default function NewTaskForm({
  initialMode = "task",
  role,
  myDepartmentId,
  departments,
  allDepartments,
  users,
  projects,
}: {
  initialMode?: "task" | "request";
  role: string;
  myDepartmentId: string | null;
  departments: Opt[];
  allDepartments: Opt[];
  users: {
    id: string;
    name: string;
    departmentId: string | null;
    departmentName: string;
    jobTitle: string;
  }[];
  projects: { id: string; name: string; departmentId: string }[];
}) {
  const router = useRouter();
  const fid = useId();

  // Khớp luật của /api/requests: chỉ trưởng phòng / Ban Giám đốc gửi yêu cầu
  // liên phòng ban, và phải còn ít nhất một phòng khác để gửi tới.
  const canRequest =
    (role === "MANAGER" || role === "CEO") &&
    allDepartments.some((d) => d.id !== myDepartmentId);
  const [mode, setMode] = useState<"task" | "request">(
    initialMode === "request" && canRequest ? "request" : "task"
  );

  // Ban Giám đốc thuộc phòng BGĐ vốn không có nhân viên nghiệp vụ, nên phải
  // mặc định về phòng ban đầu tiên thực sự có người để giao việc.
  const defaultDepartmentId =
    (myDepartmentId && users.some((u) => u.departmentId === myDepartmentId)
      ? myDepartmentId
      : departments.find((d) => users.some((u) => u.departmentId === d.id))
          ?.id) ??
    departments[0]?.id ??
    "";

  const [departmentId, setDepartmentId] = useState(defaultDepartmentId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [dueDate, setDueDate] = useState(defaultDue());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Yêu cầu liên phòng ban
  const [targetDeptId, setTargetDeptId] = useState(
    allDepartments.find((d) => d.id !== myDepartmentId)?.id ?? ""
  );

  const deptUsers = useMemo(
    () => users.filter((u) => u.departmentId === departmentId),
    [users, departmentId]
  );
  const deptProjects = useMemo(
    () => projects.filter((p) => p.departmentId === departmentId),
    [projects, departmentId]
  );

  async function submitTask(e: React.FormEvent) {
    e.preventDefault();
    const dueIso = vnLocalToIso(dueDate);
    if (!dueIso) {
      setError("Hạn chót không hợp lệ.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetchJson<{ task?: { id: string } }>(
        "/api/tasks",
        jsonInit("POST", {
          title,
          description: description || undefined,
          departmentId,
          assigneeId: assigneeId || null,
          projectId: projectId || null,
          dueDate: dueIso,
          priority,
        })
      );
      if (!res.ok || !res.data.task) {
        setError(res.message || "Không tạo được công việc.");
        return;
      }
      router.push(`/tasks/${res.data.task.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    const dueIso = vnLocalToIso(dueDate);
    if (!dueIso) {
      setError("Hạn chót không hợp lệ.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // fetchJson không throw: trước đây mất mạng ở đây là lỗi văng ra ngoài,
      // nút ngừng quay mà không báo gì (submitTask thì có catch, cái này không).
      const res = await fetchJson(
        "/api/requests",
        jsonInit("POST", {
          title,
          description: description || undefined,
          targetDeptId,
          dueDate: dueIso,
          priority,
        })
      );
      if (!res.ok) {
        setError(res.message || "Không gửi được yêu cầu.");
        return;
      }
      router.push("/requests");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      {/* Chọn kiểu: giao trong phòng hay nhờ phòng khác */}
      <div
        role="tablist"
        aria-label="Kiểu giao việc"
        className="mb-5 flex gap-5 overflow-x-auto border-b border-ink-200"
      >
        {(
          [
            ["task", "Giao việc trong phòng"],
            ["request", "Nhờ phòng ban khác"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`-mb-px border-b-2 px-1 py-2.5 text-sm font-medium whitespace-nowrap ${
              mode === m
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-ink-500 hover:text-ink-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "request" && (
        <div className="card mb-5 p-4 text-sm text-ink-700">
          <b>Vì sao phải đi đường này?</b> Ban Giám đốc đã chốt: không ai được
          giao việc thẳng cho nhân sự phòng ban khác. Yêu cầu của bạn sẽ tới
          trưởng phòng bên đó, họ nhận rồi tự phân công người làm.
        </div>
      )}

      <form
        onSubmit={mode === "task" ? submitTask : submitRequest}
        className="card space-y-4 p-5"
      >
        <div>
          <label className="label" htmlFor={`${fid}-title`}>Tên công việc *</label>
          <input
            id={`${fid}-title`}
            className="input"
            required
            minLength={3}
            placeholder="Ví dụ: Kiểm kê kho nguyên liệu ức gà cuối tháng"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor={`${fid}-desc`}>Mô tả chi tiết</label>
          <textarea
            id={`${fid}-desc`}
            className="input min-h-24"
            placeholder="Yêu cầu cụ thể, kết quả cần đạt, ai phối hợp..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {mode === "task" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor={`${fid}-dept`}>Phòng ban *</label>
                <select
                  id={`${fid}-dept`}
                  className="input"
                  value={departmentId}
                  onChange={(e) => {
                    setDepartmentId(e.target.value);
                    setAssigneeId("");
                    setProjectId("");
                  }}
                  disabled={role !== "CEO"}
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                {role !== "CEO" && (
                  <p className="mt-1.5 text-xs text-ink-500">
                    Bạn chỉ giao được trong phòng mình.
                  </p>
                )}
                {/* Lối tắt sang tab yêu cầu — việc liên phòng phải đi đường này */}
                {canRequest && (
                  <p className="mt-1 text-xs text-ink-500">
                    Cần người phòng khác?{" "}
                    <button
                      type="button"
                      onClick={() => setMode("request")}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      → Nhờ phòng ban khác
                    </button>
                  </p>
                )}
              </div>

              <div>
                <label className="label" htmlFor={`${fid}-assignee`}>Người phụ trách</label>
                <select
                  id={`${fid}-assignee`}
                  className="input"
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                >
                  <option value="">— Để trống, phân công sau —</option>
                  {deptUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                      {u.jobTitle ? ` — ${u.jobTitle}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {deptProjects.length > 0 && (
              <div>
                <label className="label" htmlFor={`${fid}-project`}>Thuộc dự án</label>
                <select
                  id={`${fid}-project`}
                  className="input"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                >
                  <option value="">— Không thuộc dự án nào —</option>
                  {deptProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        ) : (
          <div>
            <label className="label" htmlFor={`${fid}-target`}>Gửi tới phòng ban *</label>
            <select
              id={`${fid}-target`}
              className="input"
              value={targetDeptId}
              onChange={(e) => setTargetDeptId(e.target.value)}
              required
            >
              {allDepartments
                .filter((d) => d.id !== myDepartmentId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor={`${fid}-due`}>Hạn chót *</label>
            <input
              id={`${fid}-due`}
              type="datetime-local"
              className="input"
              required
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor={`${fid}-priority`}>Mức ưu tiên</label>
            <select
              id={`${fid}-priority`}
              className="input"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {TASK_PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
            {priority === "CRITICAL" && (
              <p className="mt-1.5 text-xs text-amber-700">
                Việc khẩn cấp sẽ bắn cảnh báo Telegram tới Ban Giám đốc ngay.
              </p>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy
              ? "Đang lưu..."
              : mode === "task"
                ? "Giao việc"
                : "Gửi yêu cầu"}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => router.back()}
          >
            Huỷ
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Hạn mặc định: 17:00 giờ VN, 3 ngày sau. Tính bằng lib/vn-time để server (UTC)
 * và trình duyệt render ra cùng một chuỗi — tránh lỗi hydration và lệch ngày.
 */
function defaultDue() {
  return `${vnDateKey(addDays(new Date(), 3))}T17:00`;
}
