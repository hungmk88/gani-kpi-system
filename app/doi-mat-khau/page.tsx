import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import Image from "next/image";
import ChangePasswordForm, { LogoutButton } from "./change-password-form";

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
    select: {
      mustChangePassword: true,
      passwordChangedAt: true,
      fullName: true,
      email: true,
    },
  });

  const forced = me?.mustChangePassword ?? false;

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Image src="/logo-mark.png" alt="" width={36} height={36} priority />
            <div>
              <div className="text-lg font-bold tracking-tight text-brand-700">
                GANI FOODY
              </div>
              <div className="text-sm text-ink-500">
                Hệ thống quản lý công việc &amp; KPI
              </div>
            </div>
          </div>
          {/* Máy dùng chung ở xưởng: người khác phải thoát được khỏi trang
              bắt buộc đổi mật khẩu này mà không cần biết mật khẩu cũ. */}
          <LogoutButton />
        </div>

        <div className="card p-6 sm:p-8">
          <h1 className="text-xl font-bold text-ink-900">
            {forced ? "Đặt mật khẩu riêng của bạn" : "Đổi mật khẩu"}
          </h1>

          {forced ? (
            <p className="mt-2 text-sm leading-relaxed text-ink-600">
              Mật khẩu hiện tại do quản trị đặt hộ, nghĩa là{" "}
              <strong className="font-semibold text-ink-800">
                không chỉ mình bạn biết nó
              </strong>
              . Hệ thống này chấm điểm KPI và tính thưởng, nên bạn phải tự đặt
              một mật khẩu riêng trước khi xem được gì khác.
            </p>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-ink-600">
              Bạn cần nhập mật khẩu đang dùng để xác nhận đúng là bạn — kể cả khi
              máy đang mở sẵn phiên đăng nhập.
            </p>
          )}

          <ChangePasswordForm
            forced={forced}
            fullName={me?.fullName ?? null}
            email={me?.email ?? null}
          />
        </div>

        {!forced && (
          <p className="mt-4 text-center text-sm text-ink-500">
            <a href="/dashboard" className="hover:text-ink-800 hover:underline">
              ← Quay lại hệ thống
            </a>
          </p>
        )}
      </div>
    </main>
  );
}
