"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Đăng nhập thất bại.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Không kết nối được. Kiểm tra mạng rồi thử lại.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">
            Email công ty
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="username"
            className="input"
            placeholder="ten.ban@ganifoody.vn"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="password">
            Mật khẩu
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            className="input"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? "Đang kiểm tra..." : "Đăng nhập"}
        </button>
      </form>

      {/* KHÔNG in sẵn tài khoản / mật khẩu mẫu ở đây: trang đăng nhập là công
          khai, ai mở cũng thấy. Tài khoản do quản trị cấp, mật khẩu tự đặt. */}
      <p className="mt-6 text-center text-xs text-ink-500">
        Chưa có tài khoản hoặc quên mật khẩu? Liên hệ quản trị hệ thống.
      </p>
    </>
  );
}
