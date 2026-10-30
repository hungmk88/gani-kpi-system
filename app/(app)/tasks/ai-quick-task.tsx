"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Wand2, Check } from "lucide-react";
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL } from "@/lib/constants";
import { fmtNum } from "@/lib/format";
import { isoToVnLocal, vnLocalToIso } from "@/lib/vn-input";
import { fetchJson, jsonInit } from "@/lib/fetch-json";

type Draft = {
  title: string;
  description: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  priority: string;
};

type ParseResponse = {
  suggestionId: string;
  draft: Draft;
  confidencePercent: number;
  rationale: string;
  missingInfo: string[];
  engine: "GEMINI" | "RULE_BASED";
  modelName: string | null;
  latencyMs: number;
  sanitizeFlagged: boolean;
  engineError: string | null;
};

const EXAMPLES = [
  "Nhờ Ngô Thị Lành kiểm tra lại lô chả ức gà cấp đông sáng nay, gấp, xong trước 5h chiều mai",
  "Giao Lê Thị Hồng gọi lại 20 khách sỉ chưa chốt đơn tuần này, hạn thứ 6",
  "Chuẩn bị mẫu bao bì 200g gửi khách xem",
];

export default function AiQuickTask({
  departments,
  users,
  myDepartmentId,
  role,
}: {
  departments: { id: string; name: string }[];
  users: {
    id: string;
    name: string;
    departmentId: string | null;
    jobTitle: string;
  }[];
  myDepartmentId: string | null;
  role: string;
}) {
  const router = useRouter();
  const fid = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<ParseResponse | null>(null);

  /**
   * Phòng ban mặc định: lấy phòng của người đang dùng nếu phòng đó có nhân sự
   * để giao việc. Ban Giám đốc thuộc phòng BGĐ vốn không có nhân viên nghiệp vụ,
   * nên với họ phải rơi về phòng ban đầu tiên thực sự có người.
   */
  const defaultDepartmentId =
    (myDepartmentId && users.some((u) => u.departmentId === myDepartmentId)
      ? myDepartmentId
      : departments.find((d) =>
          users.some((u) => u.departmentId === d.id)
        )?.id) ??
    departments[0]?.id ??
    "";

  // Bản nháp sau khi người dùng chỉnh tay
  const [form, setForm] = useState({
    title: "",
    description: "",
    departmentId: defaultDepartmentId,
    assigneeId: "",
    dueDate: "",
    priority: "MEDIUM",
  });

  async function parse() {
    setBusy(true);
    setError(null);
    setRes(null);
    try {
      const r = await fetchJson<ParseResponse>("/api/ai/parse-task", jsonInit("POST", { text }));
      const data = r.data;
      // AI chậm → 504 trang HTML của nền tảng; fetchJson đổi thành câu dễ hiểu
      if (!r.ok || !data.draft) {
        setError(r.message || "Không đọc được câu lệnh.");
        return;
      }
      setRes(data);

      // Máy đọc ra người nào thì nhảy luôn sang phòng ban của người đó.
      // Không làm bước này thì Ban Giám đốc (thuộc phòng BGĐ) sẽ thấy ô người
      // phụ trách chỉ liệt kê người phòng BGĐ, và cái tên vừa đọc ra rơi mất.
      const matched = data.draft.assigneeId
        ? users.find((u) => u.id === data.draft.assigneeId)
        : null;

      setForm({
        title: data.draft.title,
        description: data.draft.description ?? "",
        departmentId:
          matched?.departmentId ?? defaultDepartmentId,
        assigneeId: data.draft.assigneeId ?? "",
        // Hiện hạn theo giờ VN (không theo múi giờ của máy đang dùng)
        dueDate: isoToVnLocal(data.draft.dueDate),
        priority: data.draft.priority,
      });
    } catch {
      setError("Mất kết nối tới máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (!res) return;
    // Cùng quy ước với form giao việc tay: chuỗi trong ô là GIỜ VN. Trước đây
    // dùng new Date(form.dueDate) → hiểu theo múi giờ máy, lệch hạn chót.
    const dueIso = vnLocalToIso(form.dueDate);
    if (!dueIso) {
      setError("Hạn chót không hợp lệ.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetchJson<{ task?: { id: string } }>(
        `/api/ai/suggestions/${res.suggestionId}`,
        jsonInit("POST", {
          action: "ACCEPT",
          title: form.title,
          description: form.description || null,
          departmentId: form.departmentId,
          assigneeId: form.assigneeId || null,
          dueDate: dueIso,
          priority: form.priority,
        })
      );
      if (!r.ok || !r.data.task) {
        setError(r.message || "Không tạo được công việc.");
        return;
      }
      reset();
      router.push(`/tasks/${r.data.task.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (res) {
      // Ghi nhận "bỏ qua" chỉ để thống kê chất lượng AI — lỗi mạng ở đây không
      // được chặn người dùng đóng bản nháp (fetchJson không throw).
      await fetchJson(
        `/api/ai/suggestions/${res.suggestionId}`,
        jsonInit("POST", { action: "REJECT", reason: "Người dùng bỏ qua" })
      );
    }
    reset();
  }

  function reset() {
    setRes(null);
    setText("");
    setError(null);
    setOpen(false);
  }

  const deptUsers = users.filter((u) => u.departmentId === form.departmentId);
  const canSubmit = form.title.length >= 3 && !!form.dueDate;

  if (!open) {
    return (
      <button
        className="card mb-4 flex w-full items-center gap-3 p-3.5 text-left transition hover:shadow-lift"
        onClick={() => setOpen(true)}
      >
        <Wand2 size={20} strokeWidth={2} className="shrink-0 text-brand-600" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink-800">
            Gõ một câu, máy dựng thành việc
          </span>
          <span className="block truncate text-xs text-ink-500">
            Ví dụ: “{EXAMPLES[0]}”
          </span>
        </span>
        <span className="btn-ghost btn-sm shrink-0">Mở</span>
      </button>
    );
  }

  return (
    <div className="card mb-4 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-medium text-ink-900">
            <Wand2 size={16} strokeWidth={2} /> Trợ lý giao việc
          </div>
          <p className="mt-0.5 text-xs text-ink-500">
            Máy chỉ đọc và dựng bản nháp. Việc chỉ được tạo khi anh bấm xác nhận.
          </p>
        </div>
        <button className="btn-ghost btn-sm" onClick={reset}>
          Đóng
        </button>
      </div>

      {/* ---------------- ô nhập ---------------- */}
      {!res && (
        <>
          <textarea
            className="input min-h-24"
            aria-label="Câu lệnh giao việc"
            placeholder="Gõ như đang nhắn tin cho nhân viên..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex, i) => (
              <button
                key={i}
                className="rounded-md border border-ink-200 px-2 py-1 text-xs text-ink-500 hover:bg-ink-50"
                onClick={() => setText(ex)}
              >
                Thử câu {i + 1}
              </button>
            ))}
          </div>
          <button
            className="btn-primary mt-3"
            disabled={busy || text.trim().length < 5}
            onClick={parse}
          >
            {busy ? "Đang đọc..." : "Đọc câu lệnh"}
          </button>
        </>
      )}

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ---------------- bản nháp ---------------- */}
      {res && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <ConfidenceBadge value={res.confidencePercent} />
            <span className="badge border-transparent bg-ink-100 text-ink-700">
              {res.engine === "GEMINI"
                ? `Gemini · ${res.modelName}`
                : "Bộ đọc luật cứng (chưa cấu hình khoá AI)"}
            </span>
            <span className="text-xs text-ink-500 tabular-nums">
              {fmtNum(res.latencyMs, 0)} ms
            </span>
          </div>

          <div className="mb-3 rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-600">
            <b>Máy hiểu thế này:</b> {res.rationale}
          </div>

          {res.sanitizeFlagged && (
            <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Câu lệnh có đoạn giống lệnh điều khiển AI. Hệ thống đã cắt bỏ đoạn
              đó trước khi xử lý.
            </div>
          )}

          {res.engineError && (
            <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {res.engineError}
            </div>
          )}

          {res.missingInfo.length > 0 && (
            <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <b>Cần xác nhận:</b>
              <ul className="mt-1 list-inside list-disc text-xs">
                {res.missingInfo.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-3 border-t border-ink-100 pt-3">
            <div>
              <label className="label" htmlFor={`${fid}-title`}>Tên công việc</label>
              <input
                id={`${fid}-title`}
                className="input"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>

            {form.description && (
              <div>
                <label className="label" htmlFor={`${fid}-desc`}>Mô tả</label>
                <textarea
                  id={`${fid}-desc`}
                  className="input min-h-16"
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor={`${fid}-dept`}>Phòng ban</label>
                <select
                  id={`${fid}-dept`}
                  className="input"
                  value={form.departmentId}
                  disabled={role !== "CEO"}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      departmentId: e.target.value,
                      assigneeId: "",
                    })
                  }
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label" htmlFor={`${fid}-assignee`}>
                  Người phụ trách
                  {!res.draft.assigneeId && (
                    <span className="ml-1 text-amber-700">· cần chọn</span>
                  )}
                </label>
                <select
                  id={`${fid}-assignee`}
                  className={`input ${
                    !form.assigneeId ? "border-amber-300" : ""
                  }`}
                  value={form.assigneeId}
                  onChange={(e) =>
                    setForm({ ...form, assigneeId: e.target.value })
                  }
                >
                  <option value="">— Chưa giao —</option>
                  {deptUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                      {u.jobTitle ? ` — ${u.jobTitle}` : ""}
                    </option>
                  ))}
                </select>
                {res.draft.assigneeName && !res.draft.assigneeId && (
                  <p className="mt-1 text-xs text-amber-700">
                    Máy đọc ra “{res.draft.assigneeName}” nhưng không khớp ai
                    trong danh sách.
                  </p>
                )}
              </div>

              <div>
                <label className="label" htmlFor={`${fid}-due`}>
                  Hạn chót
                  {!res.draft.dueDate && (
                    <span className="ml-1 text-amber-700">· cần điền</span>
                  )}
                </label>
                <input
                  id={`${fid}-due`}
                  type="datetime-local"
                  className={`input ${!form.dueDate ? "border-amber-300" : ""}`}
                  value={form.dueDate}
                  onChange={(e) =>
                    setForm({ ...form, dueDate: e.target.value })
                  }
                />
              </div>

              <div>
                <label className="label" htmlFor={`${fid}-priority`}>Mức ưu tiên</label>
                <select
                  id={`${fid}-priority`}
                  className="input"
                  value={form.priority}
                  onChange={(e) =>
                    setForm({ ...form, priority: e.target.value })
                  }
                >
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {TASK_PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                className="btn-primary inline-flex items-center gap-1.5"
                disabled={busy || !canSubmit}
                onClick={accept}
              >
                {busy ? (
                  "Đang tạo..."
                ) : (
                  <>
                    <Check size={14} strokeWidth={2.5} /> Xác nhận & tạo việc
                  </>
                )}
              </button>
              <button className="btn-ghost" disabled={busy} onClick={reject}>
                Bỏ bản nháp này
              </button>
              {!canSubmit && (
                <span className="self-center text-xs text-amber-700">
                  Điền nốt hạn chót rồi mới tạo được.
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const tone =
    value >= 75
      ? "border-transparent px-0 text-leaf-700"
      : value >= 50
        ? "border-transparent bg-amber-50 text-amber-800"
        : "border-transparent bg-red-50 text-red-700";
  return (
    <span className={`badge ${tone}`}>Mức tự tin của máy: {value}%</span>
  );
}
