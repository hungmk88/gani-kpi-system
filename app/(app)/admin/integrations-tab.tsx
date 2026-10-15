"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Check, Circle, Plus } from "lucide-react";
import { Badge, formatDateTime } from "@/components/ui";
import ConfirmDialog from "@/components/confirm-dialog";

export type SourceRow = {
  id: string;
  code: string;
  name: string;
  kind: string;
  priority: number;
  isActive: boolean;
  lastSeenAt: string | null;
  lastStatus: string | null;
};

export type LogRow = {
  id: string;
  sourceCode: string;
  endpoint: string;
  signatureOk: boolean;
  httpStatus: number;
  itemsReceived: number;
  itemsApplied: number;
  itemsRejected: number;
  error: string | null;
  ipAddress: string | null;
  createdAt: string;
};

const KINDS = [
  { value: "IPOS", label: "iPOS / phần mềm bán hàng" },
  { value: "CRM", label: "CRM" },
  { value: "ERP", label: "ERP" },
  { value: "SHEETS", label: "Google Sheets" },
  { value: "OTHER", label: "Khác" },
];
/** Mã loại nguồn → nhãn tiếng Việt (bảng không hiện mã thô IPOS/SHEETS) */
const KIND_LABEL: Record<string, string> = Object.fromEntries(
  KINDS.map((k) => [k.value, k.label])
);

export default function IntegrationsTab({
  sources,
  logs,
  appUrl,
  telegramReady,
  zaloReady,
}: {
  sources: SourceRow[];
  logs: LogRow[];
  appUrl: string;
  telegramReady: { enabled: boolean; hasToken: boolean; hasWebhookSecret: boolean };
  zaloReady: { enabled: boolean; hasToken: boolean };
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  // Đổi khoá / ngưng nhận dữ liệu: hai thao tác cắt luồng số liệu ngay lập tức
  const [pendingSrc, setPendingSrc] = useState<
    { kind: "rotate" | "toggle"; id: string; name: string; isActive: boolean } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [freshSecret, setFreshSecret] = useState<{
    code: string;
    secret: string;
    url: string;
  } | null>(null);

  const [f, setF] = useState({
    code: "",
    name: "",
    kind: "IPOS",
    priority: 10,
  });

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, code: f.code.toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message);
        return;
      }
      setFreshSecret({
        code: data.source.code,
        secret: data.secret,
        url: data.webhookUrl,
      });
      setAdding(false);
      setF({ code: "", name: "", kind: "IPOS", priority: 10 });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/integrations?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message);
        return;
      }
      if (data.secret) {
        const src = sources.find((s) => s.id === id);
        setFreshSecret({
          code: src?.code ?? "",
          secret: data.secret,
          url: `${appUrl}/api/integrations/${src?.code}/webhook`,
        });
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <ConfirmDialog
        open={pendingSrc !== null}
        busy={busy}
        tone={pendingSrc?.kind === "rotate" || pendingSrc?.isActive ? "danger" : "primary"}
        title={
          pendingSrc?.kind === "rotate"
            ? `Đổi khoá cho "${pendingSrc.name}"?`
            : pendingSrc?.isActive
              ? `Ngưng nhận dữ liệu từ "${pendingSrc.name}"?`
              : `Bật lại "${pendingSrc?.name ?? ""}"?`
        }
        confirmLabel={
          pendingSrc?.kind === "rotate"
            ? "Đổi khoá"
            : pendingSrc?.isActive
              ? "Ngưng nhận"
              : "Bật lại"
        }
        onClose={() => setPendingSrc(null)}
        onConfirm={async () => {
          if (!pendingSrc) return;
          const src = pendingSrc;
          setPendingSrc(null);
          await patch(
            src.id,
            src.kind === "rotate" ? { rotateSecret: true } : { isActive: !src.isActive }
          );
        }}
      >
        {pendingSrc?.kind === "rotate" ? (
          <p>
            Khoá cũ mất hiệu lực <b>ngay</b>. Bên gửi chưa cập nhật khoá mới sẽ
            bị chặn. Khoá mới chỉ hiện <b>một lần</b> — chép lại trước khi rời
            trang.
          </p>
        ) : pendingSrc?.isActive ? (
          <p>
            Mọi số liệu gửi về từ nguồn này sẽ bị từ chối cho tới khi bật lại. KPI
            lấy số từ nguồn này sẽ thiếu số.
          </p>
        ) : (
          <p>Nguồn này nhận số liệu lại bình thường.</p>
        )}
      </ConfirmDialog>

      {/* ---------------- trạng thái kênh gửi tin ---------------- */}
      <div className="card p-5">
        <h3 className="section-title mb-3">Kênh gửi thông báo</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <ChannelCard
            title="Telegram"
            enabled={telegramReady.enabled}
            checks={[
              { label: "TELEGRAM_BOT_TOKEN", ok: telegramReady.hasToken },
              { label: "TELEGRAM_ENABLED=true", ok: telegramReady.enabled },
              {
                label: "TELEGRAM_WEBHOOK_SECRET (cần cho nút bấm)",
                ok: telegramReady.hasWebhookSecret,
              },
            ]}
            note="Có webhook thì Ban Giám đốc duyệt KPI được ngay trong tin nhắn."
          />
          <ChannelCard
            title="Zalo ZNS"
            enabled={zaloReady.enabled}
            checks={[
              { label: "ZALO_ZNS_ACCESS_TOKEN", ok: zaloReady.hasToken },
              { label: "ZALO_ENABLED=true", ok: zaloReady.enabled },
            ]}
            note="Zalo chỉ gửi được theo mẫu đã đăng ký với Zalo, không gửi tự do."
          />
        </div>
        <p className="mt-3 text-xs text-ink-500">
          Không bật kênh nào thì hệ thống vẫn chạy — thông báo nằm đủ trong mục
          Thông báo của ứng dụng.
        </p>
      </div>

      {/* ---------------- khoá vừa tạo ---------------- */}
      {freshSecret && (
        <div role="alert" className="rounded-[10px] border border-amber-300 bg-amber-50 p-5">
          <div className="mb-2 flex items-start justify-between gap-3">
            <h3 className="flex items-center gap-1.5 font-semibold text-amber-900">
              <KeyRound size={15} strokeWidth={2} /> Khoá bí mật của nguồn &quot;{freshSecret.code}&quot;
            </h3>
            <button
              className="text-sm font-medium text-amber-900 hover:underline"
              onClick={() => setFreshSecret(null)}
            >
              Tôi đã chép xong
            </button>
          </div>
          <p className="mb-3 text-sm text-amber-900">
            Chép ngay và đưa cho bên gửi dữ liệu. Hệ thống <b>không hiện lại lần
            thứ hai</b> — mất thì phải tạo khoá mới.
          </p>
          <div className="space-y-2">
            <CopyRow label="Địa chỉ webhook" value={freshSecret.url} />
            <CopyRow label="Khoá bí mật" value={freshSecret.secret} mono />
          </div>
        </div>
      )}

      {/* ---------------- danh sách nguồn ---------------- */}
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="section-title">
            Nguồn dữ liệu bên ngoài ({sources.length.toLocaleString("vi-VN")})
          </h3>
          <button
            className="btn-primary btn-sm"
            onClick={() => setAdding(!adding)}
          >
            {adding ? (
              "Đóng"
            ) : (
              <>
                <Plus size={16} aria-hidden /> Thêm nguồn
              </>
            )}
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {adding && (
          <div className="mb-4 grid gap-3 rounded-md bg-ink-50 p-4 sm:grid-cols-4">
            <div>
              <label className="label">Mã nguồn</label>
              <input
                className="input lowercase"
                value={f.code}
                onChange={(e) =>
                  setF({ ...f, code: e.target.value.toLowerCase() })
                }
                placeholder="ipos"
              />
              <p className="mt-1 text-xs text-ink-500">
                Mã này nằm trong địa chỉ webhook.
              </p>
            </div>
            <div>
              <label className="label">Tên hiển thị</label>
              <input
                className="input"
                value={f.name}
                onChange={(e) => setF({ ...f, name: e.target.value })}
                placeholder="Phần mềm bán hàng iPOS"
              />
            </div>
            <div>
              <label className="label">Loại</label>
              <select
                className="input"
                value={f.kind}
                onChange={(e) => setF({ ...f, kind: e.target.value })}
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Độ tin cậy</label>
              <input
                type="number"
                className="input"
                value={f.priority}
                onChange={(e) =>
                  setF({ ...f, priority: Number(e.target.value) })
                }
              />
              <p className="mt-1 text-xs text-ink-500">
                Số nhỏ = tin hơn. Chỉ dùng khi các nguồn đã khớp nhau.
              </p>
            </div>
            <div className="sm:col-span-4">
              <button
                className="btn-primary"
                disabled={busy || !f.code || !f.name}
                onClick={create}
              >
                {busy ? "Đang tạo..." : "Tạo nguồn & sinh khoá"}
              </button>
            </div>
          </div>
        )}

        {sources.length === 0 ? (
          <p className="text-sm text-ink-500">
            Chưa khai nguồn nào. Muốn iPOS hay CRM tự đẩy số vào thì tạo một nguồn
            ở đây rồi đưa địa chỉ webhook và khoá bí mật cho bên kỹ thuật của họ.
          </p>
        ) : (
          <div className="-mx-5 overflow-x-auto border-t border-ink-200">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Tên</th>
                  <th>Loại</th>
                  <th className="text-right">Độ tin cậy</th>
                  <th>Lần gọi gần nhất</th>
                  <th>Trạng thái</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id} className={s.isActive ? "" : "opacity-50"}>
                    <td className="font-mono text-xs text-ink-600">{s.code}</td>
                    <td className="font-medium text-ink-800">{s.name}</td>
                    <td className="text-ink-600">{KIND_LABEL[s.kind] ?? s.kind}</td>
                    <td className="text-right text-ink-600 tabular-nums">
                      {s.priority.toLocaleString("vi-VN")}
                    </td>
                    <td className="text-xs text-ink-500">
                      {s.lastSeenAt ? formatDateTime(s.lastSeenAt) : "chưa gọi bao giờ"}
                      {s.lastStatus && (
                        <div className="text-xs">{s.lastStatus}</div>
                      )}
                    </td>
                    <td>
                      {s.isActive ? (
                        <Badge tone="green">Đang nhận</Badge>
                      ) : (
                        <Badge tone="red">Tạm ngưng</Badge>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      <button
                        className="text-xs text-brand-700 hover:underline"
                        disabled={busy}
                        onClick={() =>
                          setPendingSrc({ kind: "rotate", id: s.id, name: s.name, isActive: s.isActive })
                        }
                      >
                        Đổi khoá
                      </button>
                      <button
                        className={`ml-3 text-xs hover:underline ${
                          s.isActive ? "text-red-700" : "text-brand-700"
                        }`}
                        disabled={busy}
                        onClick={() =>
                          setPendingSrc({ kind: "toggle", id: s.id, name: s.name, isActive: s.isActive })
                        }
                      >
                        {s.isActive ? "Ngưng" : "Bật lại"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---------------- nhật ký webhook ---------------- */}
      <div className="card p-5">
        <h3 className="section-title mb-1">Nhật ký hệ thống bên ngoài gọi vào</h3>
        <p className="mb-3 text-xs text-ink-500">
          Ghi cả những lần bị chặn vì sai chữ ký — nhiều dòng đỏ liên tiếp nghĩa
          là bên kia cấu hình sai, hoặc có người đang dò khoá.
        </p>

        {logs.length === 0 ? (
          <p className="text-sm text-ink-500">Chưa có lần gọi nào.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto border-t border-ink-200">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Thời điểm</th>
                  <th>Nguồn</th>
                  <th>Chữ ký</th>
                  <th className="text-right">HTTP</th>
                  <th className="text-right">Nhận / Vào</th>
                  <th>Lỗi</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className={l.signatureOk ? "" : "bg-red-50/50"}>
                    <td className="text-xs whitespace-nowrap text-ink-500">
                      {formatDateTime(l.createdAt)}
                    </td>
                    <td className="font-mono text-xs text-ink-600">
                      {l.sourceCode}
                    </td>
                    <td>
                      {l.signatureOk ? (
                        <Badge tone="green">Hợp lệ</Badge>
                      ) : (
                        <Badge tone="red">Bị chặn</Badge>
                      )}
                    </td>
                    <td className="text-right text-ink-600 tabular-nums">{l.httpStatus}</td>
                    <td className="text-right text-ink-600 tabular-nums">
                      {l.itemsReceived.toLocaleString("vi-VN")} /{" "}
                      {l.itemsApplied.toLocaleString("vi-VN")}
                    </td>
                    <td className="max-w-xs text-xs text-ink-600">
                      {l.error ? (
                        <span className="line-clamp-2">{l.error}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="font-mono text-xs text-ink-500">
                      {l.ipAddress ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ChannelCard({
  title,
  enabled,
  checks,
  note,
}: {
  title: string;
  enabled: boolean;
  checks: { label: string; ok: boolean }[];
  note: string;
}) {
  return (
    <div className="rounded-md bg-ink-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium text-ink-800">{title}</span>
        {enabled ? (
          <Badge tone="green">Đang bật</Badge>
        ) : (
          <Badge tone="slate">Đang tắt</Badge>
        )}
      </div>
      <ul className="space-y-1 text-xs">
        {checks.map((c) => (
          <li key={c.label} className="flex items-center gap-1.5">
            <span className={c.ok ? "text-leaf-700" : "text-ink-400"}>
              {c.ok ? <Check size={13} strokeWidth={2.5} /> : <Circle size={13} strokeWidth={2} />}
            </span>
            <code className={c.ok ? "text-ink-700" : "text-ink-500"}>
              {c.label}
            </code>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-500">{note}</p>
    </div>
  );
}

function CopyRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-amber-900">{label}</div>
      <div className="flex gap-2">
        <input
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className={`input bg-white ${mono ? "font-mono text-xs" : "text-xs"}`}
        />
        <button
          className="btn-ghost btn-sm shrink-0"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Đã chép" : "Chép"}
        </button>
      </div>
    </div>
  );
}
