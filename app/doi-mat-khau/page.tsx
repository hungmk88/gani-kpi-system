import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { PASSWORD_MIN_LENGTH } from "@/lib/password";
import ChangePasswordForm from "./change-password-form";

export const metadata = { title: "Đổi mật khẩu — GANI FOODY KPI" };

/**
 * Trang này cố ý nằm NGOÀI nhóm (app).
 *
 * Người bị bắt buộc đổi mật khẩu sẽ bị layout của (app) đá về đây; nếu trang
 * này cũng nằm trong (app) thì nó tự đá chính nó, thành vòng lặp vô tận.
 */
export default async function ChangePasswordPage() {
  const session = await requireSession({ allowMustChange: true });
  if (!session) redirect("/login");

  const me = await prisma.user.findUnique({
    where: { id: session.id },
    select: { mustChangePassword: true, passwordChangedAt: true },
  });

  const forced = me?.mustChangePassword ?? false;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6">
          <div className="text-lg font-bold tracking-tight text-slate-900">
            GANI FOODY
          </div>
          <div className="text-sm text-slate-500">
            Hệ thống Quản lý Công việc &amp; KPI
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-xl font-bold text-slate-900">
            {forced ? "Đặt mật khẩu riêng của bạn" : "Đổi mật khẩu"}
          </h1>

          {forced ? (
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Mật khẩu hiện tại do quản trị đặt hộ, nghĩa là{" "}
              <strong className="font-semibold text-slate-800">
                không chỉ mình bạn biết nó
              </strong>
              . Hệ thống này chấm điểm KPI và tính thưởng, nên bạn phải tự đặt
              một mật khẩu riêng trước khi xem được gì khác.
            </p>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Bạn cần nhập mật khẩu đang dùng để xác nhận đúng là bạn — kể cả khi
              máy đang mở sẵn phiên đăng nhập.
            </p>
          )}

          <ul className="mt-4 space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            <li>· Tối thiểu {PASSWORD_MIN_LENGTH} ký tự, có cả chữ và số</li>
            <li>· Không chứa khoảng trắng</li>
            <li>· Không trùng tên hoặc email của bạn</li>
            <li>· Không dùng lại mật khẩu mẫu ghi trong tài liệu</li>
          </ul>

          <ChangePasswordForm forced={forced} />
        </div>

        {!forced && (
          <p className="mt-4 text-center text-sm text-slate-500">
            <a href="/dashboard" className="hover:text-slate-800 hover:underline">
              ← Quay lại hệ thống
            </a>
          </p>
        )}
      </div>
    </main>
  );
}
