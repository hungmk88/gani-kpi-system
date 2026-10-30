"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { fetchJson, jsonInit } from "@/lib/fetch-json";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJson("/api/auth/login", jsonInit("POST", { email, password }));
      if (!res.ok) {
        setError(res.message || "Đăng nhập thất bại.");
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
          {/* Không đặt placeholder "••••••••" — trông như ô đã điền sẵn */}
          <div className="relative">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="current-password"
              className="input pr-11"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-ink-500 outline-none hover:text-ink-800 focus-visible:ring-2 focus-visible:ring-brand-600"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
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
