import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import LoginForm from "./login-form";

export const metadata = { title: "Đăng nhập — GANI FOODY KPI" };

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Cột trái: giới thiệu hệ thống */}
      <section className="hidden flex-col justify-between bg-gradient-to-br from-brand-800 via-brand-700 to-brand-900 p-12 text-white lg:flex">
        <div>
          <div className="mb-2 text-2xl font-bold tracking-tight">
            GANI FOODY
          </div>
          <div className="text-sm text-brand-200">
            Hệ thống Quản lý Công việc &amp; KPI
          </div>
        </div>

        <div className="max-w-md space-y-6">
          <h1 className="text-3xl leading-snug font-bold">
            Ban Giám đốc chỉ cần nhìn vào chỗ đang có vấn đề.
          </h1>
          <p className="text-brand-100/90">
            Hệ thống vận hành theo nguyên tắc quản trị ngoại lệ: việc chạy đúng
            thì im lặng, việc trục trặc thì nổi lên đầu bảng.
          </p>
          <ul className="space-y-3 text-sm text-brand-100/90">
            <li className="flex gap-3">
              <span className="mt-0.5">✓</span>
              <span>
                Chấm KPI theo thang 100, cho vượt chỉ tiêu, chặn trần ở 150%
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5">✓</span>
              <span>
                Luồng duyệt 3 cấp khoá tự động theo lịch ngày 2 – 4 – 5
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5">✓</span>
              <span>
                Cấm giao việc vượt cấp sang phòng ban khác, có đường đi chính
                thức thay thế
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5">✓</span>
              <span>
                Mọi lần sửa điểm KPI đã chốt đều để lại dấu vết không xoá được
              </span>
            </li>
          </ul>
        </div>

        <div className="text-xs text-brand-300">
          Phase 1 — MVP Core · Bản triển khai nội bộ
        </div>
      </section>

      {/* Cột phải: form đăng nhập */}
      <section className="flex items-center justify-center bg-white p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="text-xl font-bold text-brand-700">GANI FOODY</div>
            <div className="text-sm text-ink-500">
              Quản lý Công việc &amp; KPI
            </div>
          </div>

          <h2 className="mb-1 text-2xl font-bold text-ink-900">Đăng nhập</h2>
          <p className="mb-8 text-sm text-ink-500">
            Dùng email công ty để vào hệ thống.
          </p>

          <LoginForm />
        </div>
      </section>
    </main>
  );
}
