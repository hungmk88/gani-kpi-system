import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import Shell from "@/components/shell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireSession();
  if (!user) redirect("/login");

  const [unread, me] = await Promise.all([
    prisma.notification.count({
      where: { userId: user.id, isRead: false },
    }),
    prisma.user.findUnique({
      where: { id: user.id },
      select: { productionRole: true, mustChangePassword: true },
    }),
  ]);

  // Mật khẩu do quản trị đặt hộ thì chặn lại ở trang đổi mật khẩu, chưa cho
  // xem gì khác. Trang đó nằm ngoài nhóm (app) nên không tự đá chính nó.
  if (me?.mustChangePassword) redirect("/doi-mat-khau");

  return (
    <Shell
      user={{ ...user, productionRole: me?.productionRole ?? null }}
      unread={unread}
    >
      {children}
    </Shell>
  );
}
