"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const DEMO = [
  { label: "Ban Giám đốc", email: "ceo@ganifoody.vn" },
  { label: "Trưởng phòng Kinh doanh", email: "tp.sales@ganifoody.vn" },
  { label: "Nhân viên Kinh doanh", email: "nv.sales1@ganifoody.vn" },
  { label: "Quản trị hệ thống", email: "admin@ganifoody.vn" },
];

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
      setError("Không kết nối được máy chủ. Kiểm tra lại server đang chạy chưa.");
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

      <div className="mt-8 rounded-xl border border-ink-200 bg-ink-50/60 p-4">
        <div className="mb-2 text-xs font-semibold tracking-wide text-ink-500 uppercase">
          Tài khoản dùng thử
        </div>
        <div className="space-y-1">
          {DEMO.map((d) => (
            <button
              key={d.email}
              type="button"
              onClick={() => {
                setEmail(d.email);
                setPassword("Gani@2026");
              }}
              className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white"
            >
              <span className="text-ink-700">{d.label}</span>
              <span className="font-mono text-xs text-ink-400">{d.email}</span>
            </button>
          ))}
        </div>
        <div className="mt-2 text-xs text-ink-500">
          Mật khẩu chung: <span className="font-mono">Gani@2026</span> — bấm vào
          một dòng để điền nhanh.
        </div>
      </div>
    </>
  );
}
