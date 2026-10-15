"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Circle, LogOut } from "lucide-react";
import { PASSWORD_MIN_LENGTH, SAMPLE_PASSWORDS } from "@/lib/password";

/**
 * Các luật hiển thị trực tiếp khi gõ — cùng luật với lib/password.ts (máy chủ
 * vẫn kiểm tra lại, đây chỉ là gợi ý để khỏi phải bấm rồi mới biết sai).
 */
function liveRules(
  pw: string,
  fullName: string | null,
  email: string | null
): { label: string; ok: boolean }[] {
  const lower = pw.toLowerCase();
  const emailLocal = (email ?? "").split("@")[0]?.toLowerCase() ?? "";
  const nameParts = (fullName ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((p) => p.length >= 4);
  const hasPersonal =
    (emailLocal.length >= 4 && lower.includes(emailLocal)) ||
    nameParts.some((p) => lower.includes(p));
  const typed = pw.length > 0;
  return [
    { label: `Tối thiểu ${PASSWORD_MIN_LENGTH} ký tự`, ok: pw.length >= PASSWORD_MIN_LENGTH },
    { label: "Có ít nhất một chữ cái", ok: /[A-Za-zÀ-ỹ]/.test(pw) },
    { label: "Có ít nhất một chữ số", ok: /[0-9]/.test(pw) },
    { label: "Không chứa khoảng trắng", ok: typed && !/\s/.test(pw) },
    {
      label: "Không dùng lại mật khẩu mẫu ghi trong tài liệu",
      ok: typed && !SAMPLE_PASSWORDS.includes(lower),
    },
    { label: "Không chứa tên hoặc email của bạn", ok: typed && !hasPersonal },
  ];
}

/**
 * Nút đăng xuất trên trang đổi mật khẩu. Máy dùng chung ở xưởng: người đăng
 * nhập trước bị bắt đổi mật khẩu thì người sau vẫn phải thoát ra được.
 * Máy chủ chưa thu hồi được phiên thì ở lại và báo — giống nút ở thanh bên.
 */
export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function logout() {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      router.push("/login");
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end">
      <button type="button" className="btn btn-sm" onClick={logout} disabled={busy}>
        <LogOut size={16} aria-hidden />
        {busy ? "Đang đăng xuất…" : "Đăng xuất"}
      </button>
      {failed && (
        <span role="alert" className="mt-1 text-xs text-red-700">
          Chưa đăng xuất được — bấm lại.
        </span>
      )}
    </div>
  );
}

export default function ChangePasswordForm({
  forced,
  fullName = null,
  email = null,
}: {
  forced: boolean;
  fullName?: string | null;
  email?: string | null;
}) {
  const router = useRouter();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const rules = liveRules(newPassword, fullName, email);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Bắt lỗi gõ nhầm ngay tại chỗ, khỏi phải chờ máy chủ trả lời
    if (newPassword !== confirm) {
      setError("Hai ô mật khẩu mới không giống nhau.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Đổi mật khẩu không thành công.");
        return;
      }
      setDone(true);
      setTimeout(() => {
        router.push("/dashboard");
        router.refresh();
      }, 900);
    } catch {
      setError("Không kết nối được máy chủ.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <p
        role="status"
        className="mt-5 flex items-center gap-2 text-sm font-medium text-leaf-700"
      >
        <Check size={16} strokeWidth={2.5} aria-hidden />
        Đã đổi mật khẩu. Đang đưa bạn vào hệ thống…
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-5 space-y-4">
      <div>
        <label className="label" htmlFor="current">
          Mật khẩu hiện tại
        </label>
        <input
          id="current"
          type="password"
          required
          autoComplete="current-password"
          className="input"
          value={currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="next">
          Mật khẩu mới
        </label>
        <input
          id="next"
          type="password"
          required
          autoComplete="new-password"
          className="input"
          value={newPassword}
          aria-describedby="pw-rules"
          onChange={(e) => setNext(e.target.value)}
        />
        <ul id="pw-rules" className="mt-2 space-y-1 rounded-md bg-ink-50 p-3 text-xs">
          {rules.map((r) => (
            <li
              key={r.label}
              className={`flex items-center gap-2 ${
                r.ok ? "text-leaf-700" : "text-ink-600"
              }`}
            >
              {r.ok ? (
                <Check size={14} strokeWidth={2.5} aria-hidden className="shrink-0" />
              ) : (
                <Circle size={12} aria-hidden className="mx-px shrink-0 text-ink-400" />
              )}
              <span>{r.label}</span>
              <span className="sr-only">{r.ok ? "— đã đạt" : "— chưa đạt"}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <label className="label" htmlFor="confirm">
          Nhập lại mật khẩu mới
        </label>
        <input
          id="confirm"
          type="password"
          required
          autoComplete="new-password"
          className="input"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <button type="submit" className="btn-primary w-full" disabled={loading}>
        {loading ? "Đang đổi…" : forced ? "Đặt mật khẩu và vào hệ thống" : "Đổi mật khẩu"}
      </button>
    </form>
  );
}
