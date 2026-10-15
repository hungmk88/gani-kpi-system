"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleX } from "lucide-react";
import { Badge, formatDateTime } from "@/components/ui";
import {
  DATA_SOURCES,
  ROLE_LABEL,
  ROLES,
} from "@/lib/constants";
import {
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABEL,
} from "@/lib/production/constants";
import IntegrationsTab, {
  type LogRow,
  type SourceRow as IntegrationRow,
} from "./integrations-tab";
import UserImport from "./user-import";
import ConfirmDialog from "@/components/confirm-dialog";

type UserRow = {
  id: string;
  email: string;
  fullName: string;
  jobTitle: string;
  role: string;
  employmentType: string;
  departmentId: string | null;
  departmentName: string | null;
  telegramChatId: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
};
type DeptRow = { id: string; code: string; name: string; userCount: number };
type DefRow = {
  id: string;
  code: string;
  name: string;
  unit: string;
  isHigherBetter: boolean;
  dataSource: string;
  defaultWeight: number;
  isActive: boolean;
  departmentId: string | null;
  departmentName: string | null;
};
const TABS = [
  { id: "users", label: "Tài khoản" },
  { id: "departments", label: "Phòng ban" },
  { id: "kpis", label: "Danh mục KPI" },
  { id: "integrations", label: "Tích hợp" },
  { id: "system", label: "Kết nối & cấu hình" },
] as const;

export default function AdminPanel({
  users,
  departments,
  definitions,
  settings,
  importLogs,
  integrationSources,
  webhookLogs,
  appUrl,
  telegramReady,
  zaloReady,
}: {
  users: UserRow[];
  departments: DeptRow[];
  definitions: DefRow[];
  settings: { key: string; value: string; label: string }[];
  importLogs: {
    id: string;
    fileName: string;
    source: string;
    uploadedBy: string;
    rowsOk: number;
    rowsError: number;
    createdAt: string;
    errorLog: string | null;
  }[];
  integrationSources: IntegrationRow[];
  webhookLogs: LogRow[];
  appUrl: string;
  telegramReady: { enabled: boolean; hasToken: boolean; hasWebhookSecret: boolean };
  zaloReady: { enabled: boolean; hasToken: boolean };
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("users");

  return (
    <>
      <div className="mb-5 flex flex-wrap gap-1 rounded-xl border border-ink-200 bg-white p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
              tab === t.id
                ? "bg-brand-600 text-white"
                : "text-ink-600 hover:bg-ink-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "users" && (
        <UsersTab users={users} departments={departments} />
      )}
      {tab === "departments" && <DepartmentsTab departments={departments} />}
      {tab === "kpis" && (
        <KpisTab definitions={definitions} departments={departments} />
      )}
      {tab === "integrations" && (
        <IntegrationsTab
          sources={integrationSources}
          logs={webhookLogs}
          appUrl={appUrl}
          telegramReady={telegramReady}
          zaloReady={zaloReady}
        />
      )}
      {tab === "system" && (
        <SystemTab settings={settings} importLogs={importLogs} />
      )}
    </>
  );
}

/* ------------------------------------------------------------ TÀI KHOẢN */

function UsersTab({
  users,
  departments,
}: {
  users: UserRow[];
  departments: DeptRow[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Thao tác nhạy cảm đang chờ xác nhận (khoá, đặt lại MK, đổi vai trò…)
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [newPw, setNewPw] = useState("");
  const [showPw, setShowPw] = useState(false);

  const [form, setForm] = useState({
    email: "",
    fullName: "",
    jobTitle: "",
    role: "EMPLOYEE",
    departmentId: departments[0]?.id ?? "",
    password: "",
  });

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          departmentId: form.departmentId || null,
          jobTitle: form.jobTitle || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Không tạo được tài khoản.");
        return;
      }
      setAdding(false);
      setNotice(`Đã tạo tài khoản ${form.email}.`);
      setForm({
        email: "",
        fullName: "",
        jobTitle: "",
        role: "EMPLOYEE",
        departmentId: departments[0]?.id ?? "",
        password: "",
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  /** Gọi API sửa tài khoản. Trả về thông báo lỗi (null = thành công). */
  async function patch(
    id: string,
    payload: Record<string, unknown>
  ): Promise<string | null> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return data.message || "Không cập nhật được.";
      }
      router.refresh();
      return null;
    } catch {
      return "Mất kết nối tới máy chủ. Kiểm tra mạng rồi thử lại.";
    } finally {
      setBusy(false);
    }
  }

  function ask(action: PendingAction) {
    setDialogError(null);
    setNewPw("");
    setShowPw(false);
    setPending(action);
  }

  /** Thực hiện thao tác đã được xác nhận trong hộp thoại. */
  async function runPending() {
    if (!pending) return;
    const u = pending.user;
    let payload: Record<string, unknown>;
    let done: string;
    switch (pending.kind) {
      case "lock":
        payload = { isActive: false };
        done = `Đã khoá tài khoản ${u.fullName}.`;
        break;
      case "unlock":
        payload = { isActive: true };
        done = `Đã mở lại tài khoản ${u.fullName}.`;
        break;
      case "reset":
        payload = { newPassword: newPw };
        done = `Đã đặt lại mật khẩu cho ${u.fullName}. Người này phải tự đổi ở lần đăng nhập sau.`;
        break;
      case "unlinkTelegram":
        payload = { telegramChatId: null };
        done = `Đã gỡ liên kết Telegram của ${u.fullName}.`;
        break;
      case "role":
        payload = { role: pending.value };
        done = `Đã đổi vai trò của ${u.fullName} sang ${ROLE_LABEL[pending.value ?? ""] ?? pending.value}.`;
        break;
      case "department":
        payload = { departmentId: pending.value || null };
        done = `Đã chuyển phòng ban cho ${u.fullName}.`;
        break;
      case "employment":
        payload = { employmentType: pending.value };
        done = `Đã đổi loại nhân sự của ${u.fullName}.`;
        break;
    }
    const err = await patch(u.id, payload);
    if (err) {
      setDialogError(err);
      return;
    }
    setPending(null);
    setEditing(null);
    setNotice(done);
  }

  const pwChecks = passwordChecks(newPw);
  const pwOk = pwChecks.every((c) => c.ok);

  return (
    <>
      <UserImport />

      {notice && (
        <div
          role="status"
          className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
        >
          <span>{notice}</span>
          <button
            className="text-xs text-emerald-700 hover:underline"
            onClick={() => setNotice(null)}
          >
            Đóng
          </button>
        </div>
      )}

      <ConfirmDialog
        open={pending !== null}
        busy={busy}
        error={dialogError}
        onClose={() => setPending(null)}
        onConfirm={runPending}
        tone={
          pending?.kind === "lock" || pending?.kind === "unlinkTelegram"
            ? "danger"
            : "primary"
        }
        confirmDisabled={pending?.kind === "reset" && !pwOk}
        title={
          !pending
            ? ""
            : pending.kind === "lock"
              ? `Khoá tài khoản ${pending.user.fullName}?`
              : pending.kind === "unlock"
                ? `Mở lại tài khoản ${pending.user.fullName}?`
                : pending.kind === "reset"
                  ? `Đặt lại mật khẩu cho ${pending.user.fullName}`
                  : pending.kind === "unlinkTelegram"
                    ? `Gỡ liên kết Telegram của ${pending.user.fullName}?`
                    : pending.kind === "role"
                      ? "Đổi vai trò"
                      : pending.kind === "department"
                        ? "Chuyển phòng ban"
                        : "Đổi loại nhân sự"
        }
        confirmLabel={
          pending?.kind === "lock"
            ? "Khoá tài khoản"
            : pending?.kind === "unlock"
              ? "Mở lại"
              : pending?.kind === "reset"
                ? "Đặt lại mật khẩu"
                : pending?.kind === "unlinkTelegram"
                  ? "Gỡ liên kết"
                  : "Lưu thay đổi"
        }
      >
        {pending?.kind === "lock" && (
          <>
            <p>
              <b>{pending.user.email}</b> bị đăng xuất ngay trên mọi thiết bị và
              không đăng nhập được nữa cho tới khi mở lại.
            </p>
            <p className="text-ink-500">
              Việc đang giao và điểm KPI của người này giữ nguyên. Nhớ giao lại
              các việc đang mở cho người khác.
            </p>
          </>
        )}
        {pending?.kind === "unlock" && (
          <p>
            <b>{pending.user.email}</b> đăng nhập lại được bằng mật khẩu hiện
            có.
          </p>
        )}
        {pending?.kind === "unlinkTelegram" && (
          <p>
            Người này sẽ không nhận thông báo và không bấm duyệt qua Telegram
            nữa cho tới khi tự nối lại bằng mã liên kết trong trang Thông báo.
          </p>
        )}
        {(pending?.kind === "role" ||
          pending?.kind === "department" ||
          pending?.kind === "employment") && (
          <p>
            {pending.user.fullName}:{" "}
            <b>{describeValue(pending.kind, currentValue(pending), departments)}</b>{" "}
            → <b>{describeValue(pending.kind, pending.value ?? "", departments)}</b>
            {pending.kind === "role" && pending.value === "ADMIN" && (
              <span className="mt-2 block rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                Quản trị hệ thống được tạo, khoá tài khoản và đổi cấu hình tích
                hợp. Ban Giám đốc sẽ được báo về thay đổi này.
              </span>
            )}
            {pending.kind === "role" && pending.value === "MANAGER" && (
              <span className="mt-2 block text-ink-500">
                Trưởng phòng được duyệt KPI và giao việc cho cả phòng.
              </span>
            )}
          </p>
        )}
        {pending?.kind === "reset" && (
          <>
            <p className="text-ink-500">
              Người này phải tự đổi mật khẩu ở lần đăng nhập sau. Mọi phiên đăng
              nhập cũ và liên kết Telegram bị ngắt.
            </p>
            <div>
              <label
                htmlFor="admin-new-password"
                className="mb-1 block text-sm font-medium text-ink-700"
              >
                Mật khẩu mới
              </label>
              <div className="flex gap-2">
                <input
                  id="admin-new-password"
                  className="input font-mono"
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-ghost btn-sm shrink-0"
                  onClick={() => setShowPw(!showPw)}
                >
                  {showPw ? "Ẩn" : "Hiện"}
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    setNewPw(generatePassword());
                    setShowPw(true);
                  }}
                >
                  Tạo mật khẩu ngẫu nhiên
                </button>
                {newPw && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => navigator.clipboard?.writeText(newPw)}
                  >
                    Chép
                  </button>
                )}
              </div>
              <ul className="mt-2 space-y-0.5 text-xs">
                {pwChecks.map((c) => (
                  <li
                    key={c.label}
                    className={c.ok ? "text-emerald-700" : "text-ink-500"}
                  >
                    {c.ok ? "✓" : "○"} {c.label}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </ConfirmDialog>

      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-ink-500">{users.length} tài khoản</div>
        <button className="btn-primary btn-sm" onClick={() => setAdding(!adding)}>
          {adding ? "Đóng" : "+ Thêm tài khoản"}
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {adding && (
        <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-2">
          <div>
            <label className="label">Email công ty</label>
            <input
              className="input"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="ten.ban@ganifoody.vn"
            />
          </div>
          <div>
            <label className="label">Họ tên</label>
            <input
              className="input"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Chức danh</label>
            <input
              className="input"
              value={form.jobTitle}
              onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Vai trò</label>
            <select
              className="input"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              {/* Tài khoản Ban Giám đốc chỉ Ban Giám đốc tạo — API chặn quản trị. */}
              {ROLES.filter((r) => r !== "CEO").map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Phòng ban</label>
            <select
              className="input"
              value={form.departmentId}
              onChange={(e) =>
                setForm({ ...form, departmentId: e.target.value })
              }
            >
              <option value="">— Không thuộc phòng ban —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Mật khẩu khởi tạo</label>
            <input
              className="input"
              type="text"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Tối thiểu 10 ký tự, có chữ và số"
            />
          </div>
          <div className="sm:col-span-2">
            <button className="btn-primary" disabled={busy} onClick={create}>
              {busy ? "Đang tạo..." : "Tạo tài khoản"}
            </button>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table className="tbl tbl-stack">
          <thead>
            <tr>
              <th>Họ tên · email</th>
              <th>Vai trò</th>
              <th>Loại nhân sự</th>
              <th>Phòng ban</th>
              <th>Telegram Chat ID</th>
              <th>Đăng nhập gần nhất</th>
              <th>Trạng thái</th>
              <th className="sticky right-0 bg-ink-50">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className="min-w-52">
                  <div className="font-medium whitespace-nowrap text-ink-800">
                    {u.fullName}
                  </div>
                  <div className="text-xs break-all text-ink-500">{u.email}</div>
                  {u.jobTitle && (
                    <div className="text-xs text-ink-500">{u.jobTitle}</div>
                  )}
                </td>
                <td data-label="Vai trò">
                  {editing === u.id && u.role !== "CEO" ? (
                    <select
                      className="input py-1 text-xs"
                      value={u.role}
                      onChange={(e) =>
                        ask({ kind: "role", user: u, value: e.target.value })
                      }
                    >
                      {ROLES.filter((r) => r !== "CEO").map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Badge tone={u.role === "CEO" ? "violet" : "slate"}>
                      {ROLE_LABEL[u.role]}
                    </Badge>
                  )}
                </td>
                <td data-label="Loại nhân sự">
                  {editing === u.id ? (
                    <select
                      className="input py-1 text-xs"
                      value={u.employmentType}
                      onChange={(e) =>
                        ask({ kind: "employment", user: u, value: e.target.value })
                      }
                    >
                      {EMPLOYMENT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {EMPLOYMENT_TYPE_LABEL[t]}
                        </option>
                      ))}
                    </select>
                  ) : u.employmentType === "OFFICIAL" ? (
                    <span className="text-xs text-ink-500">
                      {EMPLOYMENT_TYPE_LABEL[u.employmentType]}
                    </span>
                  ) : (
                    <Badge tone="amber">
                      {EMPLOYMENT_TYPE_LABEL[u.employmentType]}
                    </Badge>
                  )}
                </td>
                <td data-label="Phòng ban">
                  {editing === u.id ? (
                    <select
                      className="input py-1 text-xs"
                      value={u.departmentId ?? ""}
                      onChange={(e) =>
                        ask({ kind: "department", user: u, value: e.target.value })
                      }
                    >
                      <option value="">—</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-ink-600">
                      {u.departmentName ?? "—"}
                    </span>
                  )}
                </td>
                <td data-label="Telegram">
                  {/* Quản trị KHÔNG được điền sẵn Chat ID: ai trỏ được Telegram
                      của người khác về chat của mình là nhận thông báo / bấm
                      nút thay họ. Chính chủ tự nối bằng mã liên kết ở trang
                      Thông báo; quản trị chỉ được gỡ liên kết. */}
                  <span className="font-mono text-xs text-ink-500">
                    {u.telegramChatId ?? "chưa nối"}
                  </span>
                  {editing === u.id && u.role !== "CEO" && u.telegramChatId && (
                    <button
                      className="ml-2 text-xs text-red-600 hover:underline"
                      disabled={busy}
                      onClick={() => ask({ kind: "unlinkTelegram", user: u })}
                    >
                      Gỡ liên kết Telegram
                    </button>
                  )}
                </td>
                <td data-label="Đăng nhập gần nhất" className="text-xs text-ink-500">
                  {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "chưa bao giờ"}
                </td>
                <td data-label="Trạng thái">
                  {u.isActive ? (
                    <Badge tone="green">Đang dùng</Badge>
                  ) : (
                    <Badge tone="red">Đã khoá</Badge>
                  )}
                </td>
                <td
                  data-label=""
                  className="sticky right-0 bg-white whitespace-nowrap shadow-[-8px_0_8px_-8px_rgb(0_0_0/0.12)]"
                >
                  <button
                    className="text-xs text-brand-600 hover:underline"
                    onClick={() => setEditing(editing === u.id ? null : u.id)}
                  >
                    {editing === u.id ? "Xong" : "Sửa"}
                  </button>
                  {u.role === "CEO" ? (
                    // Mật khẩu, Telegram, vai trò, khoá/mở của tài khoản Ban
                    // Giám đốc chỉ Ban Giám đốc đổi — API chặn quản trị.
                    <span
                      className="ml-3 text-xs text-ink-400"
                      title="Mật khẩu, Telegram, vai trò và khoá/mở tài khoản Ban Giám đốc chỉ Ban Giám đốc thay đổi."
                    >
                      Chỉ BGĐ đổi MK/khoá
                    </span>
                  ) : (
                    <>
                      <button
                        className="ml-3 text-xs text-ink-500 hover:underline"
                        onClick={() => ask({ kind: "reset", user: u })}
                      >
                        Đặt lại MK
                      </button>
                      <button
                        className={`ml-3 text-xs hover:underline ${
                          u.isActive ? "text-red-600" : "text-emerald-600"
                        }`}
                        onClick={() =>
                          ask({ kind: u.isActive ? "lock" : "unlock", user: u })
                        }
                      >
                        {u.isActive ? "Khoá" : "Mở"}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ PHÒNG BAN */

function DepartmentsTab({ departments }: { departments: DeptRow[] }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.toUpperCase(), name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message);
        return;
      }
      setCode("");
      setName("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        <div className="w-40">
          <label className="label">Mã phòng</label>
          <input
            className="input uppercase"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="QC"
          />
        </div>
        <div className="min-w-52 flex-1">
          <label className="label">Tên phòng ban</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Kiểm soát chất lượng"
          />
        </div>
        <button
          className="btn-primary"
          disabled={busy || !code || !name}
          onClick={create}
        >
          + Thêm phòng ban
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Mã</th>
              <th>Tên phòng ban</th>
              <th className="text-right">Số nhân sự</th>
            </tr>
          </thead>
          <tbody>
            {departments.map((d) => (
              <tr key={d.id}>
                <td className="font-mono text-xs text-ink-600">{d.code}</td>
                <td className="font-medium text-ink-800">{d.name}</td>
                <td className="text-right text-ink-600">{d.userCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ DANH MỤC KPI */

function KpisTab({
  definitions,
  departments,
}: {
  definitions: DefRow[];
  departments: DeptRow[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    code: "",
    name: "",
    unit: "%",
    departmentId: departments[0]?.id ?? "",
    isHigherBetter: true,
    dataSource: "MANUAL",
    defaultWeight: 20,
  });

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/kpi-definitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...f,
          code: f.code.toUpperCase(),
          departmentId: f.departmentId || null,
          defaultWeight: Number(f.defaultWeight),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message);
        return;
      }
      setAdding(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id: string, isActive: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/kpi-definitions?id=${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive }),
        }
      );
      if (!res.ok) {
        // Báo đúng lý do server trả về thay vì im lặng như đã thành công
        const data = await res.json().catch(() => null);
        setError(data?.message || "Không cập nhật được trạng thái chỉ tiêu.");
        return;
      }
      router.refresh();
    } catch {
      setError("Mất kết nối tới máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-ink-500">
          {definitions.length} chỉ tiêu ·{" "}
          {definitions.filter((d) => d.isActive).length} đang dùng
        </div>
        <button className="btn-primary btn-sm" onClick={() => setAdding(!adding)}>
          {adding ? "Đóng" : "+ Thêm chỉ tiêu"}
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {adding && (
        <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-3">
          <div>
            <label className="label">Mã chỉ tiêu</label>
            <input
              className="input uppercase"
              value={f.code}
              onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })}
              placeholder="PROD_YIELD"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Tên chỉ tiêu</label>
            <input
              className="input"
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              placeholder="Tỷ lệ thu hồi thành phẩm trên nguyên liệu"
            />
          </div>
          <div>
            <label className="label">Đơn vị</label>
            <input
              className="input"
              value={f.unit}
              onChange={(e) => setF({ ...f, unit: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Phòng ban</label>
            <select
              className="input"
              value={f.departmentId}
              onChange={(e) => setF({ ...f, departmentId: e.target.value })}
            >
              <option value="">— Dùng chung —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Trọng số mặc định (%)</label>
            <input
              type="number"
              className="input"
              value={f.defaultWeight}
              onChange={(e) =>
                setF({ ...f, defaultWeight: Number(e.target.value) })
              }
            />
          </div>
          <div>
            <label className="label">Chiều tốt</label>
            <select
              className="input"
              value={f.isHigherBetter ? "1" : "0"}
              onChange={(e) =>
                setF({ ...f, isHigherBetter: e.target.value === "1" })
              }
            >
              <option value="1">Càng cao càng tốt</option>
              <option value="0">Càng thấp càng tốt</option>
            </select>
          </div>
          <div>
            <label className="label">Nguồn số liệu</label>
            <select
              className="input"
              value={f.dataSource}
              onChange={(e) => setF({ ...f, dataSource: e.target.value })}
            >
              {DATA_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s === "MANUAL"
                    ? "Nhập tay"
                    : s === "EXCEL"
                      ? "Nạp từ Excel"
                      : "iPOS / API"}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-3">
            <button className="btn-primary" disabled={busy} onClick={create}>
              {busy ? "Đang lưu..." : "Tạo chỉ tiêu"}
            </button>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Mã</th>
              <th>Tên chỉ tiêu</th>
              <th>Phòng ban</th>
              <th>Đơn vị</th>
              <th>Chiều</th>
              <th>Nguồn</th>
              <th className="text-right">Trọng số</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {definitions.map((d) => (
              <tr key={d.id} className={d.isActive ? "" : "opacity-50"}>
                <td className="font-mono text-xs text-ink-600">{d.code}</td>
                <td className="font-medium text-ink-800">{d.name}</td>
                <td className="text-ink-600">{d.departmentName ?? "chung"}</td>
                <td className="text-ink-600">{d.unit}</td>
                <td className="text-xs text-ink-600">
                  {d.isHigherBetter ? "↑ cao tốt" : "↓ thấp tốt"}
                </td>
                <td className="text-xs text-ink-600">
                  {d.dataSource === "IPOS_API"
                    ? "iPOS/API"
                    : d.dataSource === "EXCEL"
                      ? "Excel"
                      : "nhập tay"}
                </td>
                <td className="text-right text-ink-600">{d.defaultWeight}%</td>
                <td>
                  <button
                    className="text-xs text-brand-600 hover:underline"
                    onClick={() => toggle(d.id, !d.isActive)}
                  >
                    {d.isActive ? "Ngưng dùng" : "Dùng lại"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ 6 CHỈ TIÊU (KPI SẢN XUẤT) */
function SystemTab({
  settings,
  importLogs,
}: {
  settings: { key: string; value: string; label: string }[];
  importLogs: {
    id: string;
    fileName: string;
    source: string;
    uploadedBy: string;
    rowsOk: number;
    rowsError: number;
    createdAt: string;
    errorLog: string | null;
  }[];
}) {
  const [chatId, setChatId] = useState("");
  const [result, setResult] = useState<React.ReactNode | null>(null);
  const [busy, setBusy] = useState(false);

  async function test() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/telegram-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId }),
      });
      const data = await res.json().catch(() => ({}));
      setResult(
        res.ok && data.ok ? (
          <span className="inline-flex items-center gap-1.5">
            <CircleCheck size={14} strokeWidth={2} /> Gửi thành công. Kiểm tra Telegram xem đã nhận chưa.
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <CircleX size={14} strokeWidth={2} />{" "}
            {data.error || data.message || "Gửi thất bại."}
          </span>
        )
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <h3 className="mb-1 font-semibold text-ink-900">
          Kiểm tra kết nối Telegram
        </h3>
        <p className="mb-4 text-sm text-ink-500">
          Tạo bot bằng @BotFather, dán token vào <code>TELEGRAM_BOT_TOKEN</code>{" "}
          trong file .env, đặt <code>TELEGRAM_ENABLED=&quot;true&quot;</code>,
          khởi động lại server, rồi nhập Chat ID vào đây để bắn thử.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            className="input max-w-xs"
            placeholder="Chat ID, ví dụ 123456789"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
          />
          <button className="btn-primary" disabled={busy || !chatId} onClick={test}>
            {busy ? "Đang gửi..." : "Gửi tin thử"}
          </button>
        </div>
        {result && <div className="mt-3 text-sm text-ink-700">{result}</div>}
      </div>

      <div className="card p-5">
        <h3 className="mb-3 font-semibold text-ink-900">
          Quy tắc nghiệp vụ đang áp dụng
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {settings.map((s) => (
            <div
              key={s.key}
              className="flex items-center justify-between rounded-lg border border-ink-200 px-3 py-2"
            >
              <span className="text-sm text-ink-600">{s.label}</span>
              <span className="font-mono text-sm font-medium text-ink-900">
                {s.value}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-500">
          Các quy tắc này do Ban Giám đốc chốt và được cài cứng trong mã nguồn
          tại <code>lib/constants.ts</code>. Bảng trên là bản ghi tham chiếu —
          muốn đổi thật thì phải sửa mã nguồn và triển khai lại, tránh việc ai đó
          lặng lẽ nới trần điểm KPI.
        </p>
      </div>

      <div className="card p-5">
        <h3 className="mb-3 font-semibold text-ink-900">
          Lịch sử nạp dữ liệu gần đây
        </h3>
        {importLogs.length === 0 ? (
          <p className="text-sm text-ink-500">Chưa có lần nạp nào.</p>
        ) : (
          <div className="space-y-2">
            {importLogs.map((l) => (
              <div
                key={l.id}
                className="rounded-lg border border-ink-200 px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-ink-800">{l.fileName}</span>
                  <span className="text-xs text-ink-500">
                    {formatDateTime(l.createdAt)} · {l.uploadedBy}
                  </span>
                </div>
                <div className="mt-1 text-xs">
                  <span className="text-emerald-700">{l.rowsOk} dòng vào</span>
                  {l.rowsError > 0 && (
                    <span className="ml-2 text-red-600">
                      {l.rowsError} dòng lỗi
                    </span>
                  )}
                </div>
                {l.errorLog && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-ink-500">
                      Xem chi tiết lỗi
                    </summary>
                    <pre className="mt-1 max-h-40 overflow-auto rounded bg-ink-50 p-2 text-[11px] whitespace-pre-wrap text-ink-600">
                      {l.errorLog}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ hộp xác nhận */

type PendingAction = {
  kind:
    | "lock"
    | "unlock"
    | "reset"
    | "unlinkTelegram"
    | "role"
    | "department"
    | "employment";
  user: UserRow;
  value?: string;
};

function currentValue(p: PendingAction) {
  if (p.kind === "role") return p.user.role;
  if (p.kind === "department") return p.user.departmentId ?? "";
  return p.user.employmentType;
}

function describeValue(
  kind: PendingAction["kind"],
  v: string,
  departments: { id: string; name: string }[]
) {
  if (kind === "role") return ROLE_LABEL[v] ?? v;
  if (kind === "department") return departments.find((d) => d.id === v)?.name ?? "—";
  return EMPLOYMENT_TYPE_LABEL[v as keyof typeof EMPLOYMENT_TYPE_LABEL] ?? v;
}

/**
 * Cùng luật với lib/password.ts (máy chủ vẫn kiểm lại lần nữa): đủ 10 ký tự,
 * có chữ, có số, không khoảng trắng. Hiện từng điều kiện để người đặt thấy
 * ngay còn thiếu gì, thay vì gửi lên rồi mới bị từ chối.
 */
function passwordChecks(pw: string) {
  return [
    { label: "Từ 10 ký tự trở lên", ok: pw.length >= 10 },
    { label: "Có ít nhất một chữ cái", ok: /[A-Za-zÀ-ỹ]/.test(pw) },
    { label: "Có ít nhất một chữ số", ok: /[0-9]/.test(pw) },
    { label: "Không có khoảng trắng", ok: pw.length > 0 && !/\s/.test(pw) },
  ];
}

/** Mật khẩu tạm 14 ký tự, bỏ các ký tự dễ nhầm (0/O, 1/l/I). */
function generatePassword() {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = letters + digits;
  const buf = new Uint32Array(14);
  crypto.getRandomValues(buf);
  const chars = Array.from(buf, (n) => all[n % all.length]);
  // Bảo đảm có ít nhất một chữ và một số
  chars[3] = letters[buf[3] % letters.length];
  chars[9] = digits[buf[9] % digits.length];
  return chars.join("");
}
