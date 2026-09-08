"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ChangePasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

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
      <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        Đã đổi mật khẩu. Đang đưa bạn vào hệ thống…
      </div>
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
          onChange={(e) => setNext(e.target.value)}
        />
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
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <button type="submit" className="btn btn-primary w-full" disabled={loading}>
        {loading ? "Đang đổi…" : forced ? "Đặt mật khẩu và vào hệ thống" : "Đổi mật khẩu"}
      </button>
    </form>
  );
}
