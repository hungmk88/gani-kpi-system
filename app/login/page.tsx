import { redirect } from "next/navigation";
import Image from "next/image";
import { Check } from "lucide-react";
import { getSession, loadActiveUser } from "@/lib/auth";
import LoginForm from "./login-form";

export const metadata = { title: "Đăng nhập — GANI FOODY KPI" };

export default async function LoginPage() {
  // Đối chiếu DB: token còn chữ ký nhưng đã bị thu hồi thì vẫn cho đăng nhập
  // lại, không redirect vòng /login <-> /dashboard.
  const active = await loadActiveUser(await getSession());
  if (active) redirect("/dashboard");

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Cột trái: giới thiệu hệ thống.
          Logo đầy đủ đứng đầu khối nội dung, thẳng lề với tiêu đề và danh
          sách bên dưới; cả khối canh giữa theo chiều dọc. Bỏ dòng logo nhỏ +
          chữ "GANI FOODY" cũ vì logo đầy đủ đã có sẵn chữ GANI. */}
      <section className="hidden flex-col border-r border-ink-200 bg-white p-12 text-brand-800 lg:flex">
        <div className="flex flex-1 flex-col justify-center">
          <div className="max-w-md">
            <Image
              src="/logo-full.png"
              alt="GANI FOODY — Giòn ngon tròn vị"
              width={168}
              height={169}
              priority
            />
            <div className="mt-4 text-sm font-medium text-brand-700">
              Hệ thống quản lý công việc &amp; KPI
            </div>

            <div className="mt-10 space-y-6">
                <div>
                  <h1 className="text-3xl leading-snug font-bold text-brand-800">
                    Ban Giám đốc chỉ cần nhìn vào chỗ đang có vấn đề.
                  </h1>
                  {/* Vạch lá xanh — để trang mang đủ hai màu của logo */}
                  <div aria-hidden className="mt-4 h-1 w-12 rounded-full bg-leaf-500" />
                </div>
                <p className="text-ink-600">
                  Hệ thống vận hành theo nguyên tắc quản trị ngoại lệ: việc chạy đúng
                  thì im lặng, việc trục trặc thì nổi lên đầu bảng.
                </p>
                <ul className="space-y-3 text-sm text-ink-700">
                  <li className="flex gap-3">
                    <span className="mt-0.5 text-leaf-600">
                      <Check size={16} strokeWidth={2.5} />
                    </span>
                    <span>
                      Chấm KPI theo thang 100, cho vượt chỉ tiêu, chặn trần ở 150%
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-0.5 text-leaf-600">
                      <Check size={16} strokeWidth={2.5} />
                    </span>
                    <span>
                      Luồng duyệt 3 cấp khoá tự động theo lịch ngày 2 – 4 – 5
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-0.5 text-leaf-600">
                      <Check size={16} strokeWidth={2.5} />
                    </span>
                    <span>
                      Cấm giao việc vượt cấp sang phòng ban khác, có đường đi chính
                      thức thay thế
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-0.5 text-leaf-600">
                      <Check size={16} strokeWidth={2.5} />
                    </span>
                    <span>
                      Mọi lần sửa điểm KPI đã chốt đều để lại dấu vết không xoá được
                    </span>
                  </li>
                </ul>
            </div>
          </div>
        </div>

        <div className="text-xs text-ink-500">© GANI FOODY</div>
      </section>

      {/* Cột phải: form đăng nhập */}
      <section className="flex items-center justify-center bg-white p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <Image src="/logo-mark.png" alt="" width={36} height={36} />
            <div>
              <div className="text-xl font-bold text-brand-700">GANI FOODY</div>
              <div className="text-sm text-ink-500">
                Quản lý công việc &amp; KPI
              </div>
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
