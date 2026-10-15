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

  async function patch(id: string, payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Không cập nhật được.");
        return;
      }
      setEditing(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <UserImport />

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
              placeholder="Tối thiểu 8 ký tự"
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
        <table className="tbl">
          <thead>
            <tr>
              <th>Họ tên</th>
              <th>Email</th>
              <th>Vai trò</th>
              <th>Loại nhân sự</th>
              <th>Phòng ban</th>
              <th>Telegram Chat ID</th>
              <th>Đăng nhập gần nhất</th>
              <th>Trạng thái</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="font-medium text-ink-800">{u.fullName}</div>
                  <div className="text-xs text-ink-500">{u.jobTitle}</div>
                </td>
                <td className="font-mono text-xs text-ink-600">{u.email}</td>
                <td>
                  {editing === u.id && u.role !== "CEO" ? (
                    <select
                      className="input py-1 text-xs"
                      defaultValue={u.role}
                      onChange={(e) => patch(u.id, { role: e.target.value })}
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
                <td>
                  {editing === u.id ? (
                    <select
                      className="input py-1 text-xs"
                      defaultValue={u.employmentType}
                      onChange={(e) =>
                        patch(u.id, { employmentType: e.target.value })
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
                <td>
                  {editing === u.id ? (
                    <select
                      className="input py-1 text-xs"
                      defaultValue={u.departmentId ?? ""}
                      onChange={(e) =>
                        patch(u.id, { departmentId: e.target.value || null })
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
                <td>
                  {editing === u.id && u.role !== "CEO" ? (
                    <input
                      className="input py-1 text-xs"
                      defaultValue={u.telegramChatId ?? ""}
                      placeholder="vd: 123456789"
                      onBlur={(e) =>
                        patch(u.id, {
                          telegramChatId: e.target.value || null,
                        })
                      }
                    />
                  ) : (
                    <span className="font-mono text-xs text-ink-500">
                      {u.telegramChatId ?? "chưa nối"}
                    </span>
                  )}
                </td>
                <td className="text-xs text-ink-500">
                  {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "chưa bao giờ"}
                </td>
                <td>
                  {u.isActive ? (
                    <Badge tone="green">Đang dùng</Badge>
                  ) : (
                    <Badge tone="red">Đã khoá</Badge>
                  )}
                </td>
                <td className="whitespace-nowrap">
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
                        onClick={() => {
                          const p = prompt(
                            `Đặt lại mật khẩu cho ${u.fullName} (tối thiểu 8 ký tự). Telegram của người này sẽ bị ngắt, họ tự nối lại sau khi đổi mật khẩu:`
                          );
                          if (p) patch(u.id, { newPassword: p });
                        }}
                      >
                        Đặt lại MK
                      </button>
                      <button
                        className={`ml-3 text-xs hover:underline ${
                          u.isActive ? "text-red-600" : "text-emerald-600"
                        }`}
                        onClick={() => patch(u.id, { isActive: !u.isActive })}
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
