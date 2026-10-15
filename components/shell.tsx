"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  Home,
  CheckSquare,
  BarChart3,
  Repeat2,
  Palmtree,
  Scale,
  Factory,
  TrendingUp,
  Target,
  ScrollText,
  Settings,
  Bell,
  KeyRound,
  Menu as MenuIcon,
  type LucideIcon,
} from "lucide-react";
import { ROLE_LABEL } from "@/lib/constants";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: string[];
  mobile?: boolean;
  /** Chỉ hiện cho người có vai trò trong xưởng (hoặc BGĐ / quản trị). */
  productionOnly?: boolean;
};

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Trang chủ", icon: Home, roles: ["EMPLOYEE", "MANAGER", "CEO", "ADMIN"], mobile: true },
  { href: "/tasks", label: "Công việc", icon: CheckSquare, roles: ["EMPLOYEE", "MANAGER", "CEO", "ADMIN"], mobile: true },
  { href: "/kpi", label: "KPI", icon: BarChart3, roles: ["EMPLOYEE", "MANAGER", "CEO", "ADMIN"], mobile: true },
  { href: "/requests", label: "Yêu cầu liên phòng", icon: Repeat2, roles: ["MANAGER", "CEO"] },
  { href: "/leave-requests", label: "Nghỉ phép", icon: Palmtree, roles: ["EMPLOYEE", "MANAGER", "CEO", "ADMIN"] },
  { href: "/reconciliation", label: "Đối soát dữ liệu", icon: Scale, roles: ["MANAGER", "CEO"] },
  { href: "/production", label: "Xưởng sản xuất", icon: Factory, roles: ["EMPLOYEE", "MANAGER", "CEO", "ADMIN"], productionOnly: true },
  { href: "/analytics", label: "Phân tích & Dự báo", icon: TrendingUp, roles: ["MANAGER", "CEO"] },
  { href: "/ceo", label: "Bảng điều hành", icon: Target, roles: ["CEO"], mobile: true },
  { href: "/audit", label: "Nhật ký hệ thống", icon: ScrollText, roles: ["CEO", "ADMIN"] },
  { href: "/admin", label: "Quản trị", icon: Settings, roles: ["ADMIN"], mobile: true },
];

export default function Shell({
  user,
  unread,
  children,
}: {
  user: {
    id: string;
    fullName: string;
    email: string;
    role: string;
    departmentName: string | null;
    productionRole?: string | null;
  };
  unread: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);

  const inFactory =
    user.role === "CEO" || user.role === "ADMIN" || !!user.productionRole;
  const items = NAV.filter(
    (n) => n.roles.includes(user.role) && (!n.productionOnly || inFactory)
  );
  const mobileItems = items.filter((n) => n.mobile).slice(0, 5);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  async function logout() {
    // Server chưa thu hồi được phiên thì ĐỪNG chuyển sang /login: trang đó sẽ
    // tự đưa ngược vào hệ thống và người dùng tưởng đã đăng xuất (nguy hiểm ở
    // máy dùng chung). Ở lại và báo rõ để bấm lại.
    let failed = false;
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      failed = !res.ok;
      if (failed) {
        const data = await res.json().catch(() => ({}));
        console.error("Đăng xuất lỗi:", data.message ?? res.status);
      }
    } catch (err) {
      failed = true;
      console.error("Đăng xuất lỗi:", err);
    } finally {
      // Không dùng alert(): bị chặn trong trình duyệt của Zalo/Telegram.
      if (failed) {
        setLogoutFailed(true);
      } else {
        router.push("/login");
        router.refresh();
      }
    }
  }

  return (
    <div className="flex min-h-screen">
      {logoutFailed && (
        <div
          role="alert"
          className="fixed inset-x-4 top-4 z-50 mx-auto flex max-w-md items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg"
        >
          <span className="flex-1">
            Chưa đăng xuất được (mạng hoặc máy chủ lỗi). Bạn VẪN đang đăng nhập —
            bấm Đăng xuất lại.
          </span>
          <button
            className="text-xs font-medium hover:underline"
            onClick={() => setLogoutFailed(false)}
          >
            Đóng
          </button>
        </div>
      )}
      {/* ---------------- Sidebar (desktop) ---------------- */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-ink-200 bg-white lg:flex">
        <div className="flex items-center gap-2.5 border-b border-ink-100 px-5 py-4">
          <Image src="/logo-mark.png" alt="" width={36} height={36} className="shrink-0" />
          <div>
            <div className="text-lg font-bold text-brand-700">GANI FOODY</div>
            <div className="text-xs text-ink-500">Công việc &amp; KPI</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {items.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive(n.href)
                  ? "bg-brand-50 text-brand-700"
                  : "text-ink-600 hover:bg-ink-50"
              }`}
            >
              <n.icon size={18} strokeWidth={2} className="shrink-0" />
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-ink-100 p-3">
          <Link
            href="/notifications"
            className="mb-2 flex items-center justify-between rounded-lg px-3 py-2 text-sm text-ink-600 hover:bg-ink-50"
          >
            <span className="flex items-center gap-3">
              <Bell size={18} strokeWidth={2} /> Thông báo
            </span>
            {unread > 0 && (
              <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </Link>
          <div className="rounded-lg bg-ink-50 px-3 py-2.5">
            <div className="truncate text-sm font-medium text-ink-800">
              {user.fullName}
            </div>
            <div className="truncate text-xs text-ink-500">
              {ROLE_LABEL[user.role]}
              {user.departmentName ? ` · ${user.departmentName}` : ""}
            </div>
            <div className="mt-2 flex items-center gap-3">
              <Link
                href="/doi-mat-khau"
                className="text-xs font-medium text-ink-600 hover:underline"
              >
                Đổi mật khẩu
              </Link>
              <button
                onClick={logout}
                className="text-xs font-medium text-red-600 hover:underline"
              >
                Đăng xuất
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ---------------- Nội dung ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Thanh trên (mobile) */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-ink-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2">
            <Image src="/logo-mark.png" alt="" width={28} height={28} className="shrink-0" />
            <div>
              <div className="font-bold text-brand-700">GANI FOODY</div>
              <div className="text-[11px] text-ink-500">
                {ROLE_LABEL[user.role]}
                {user.departmentName ? ` · ${user.departmentName}` : ""}
              </div>
            </div>
          </div>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="btn-ghost btn-sm inline-flex items-center gap-1.5"
          >
            <MenuIcon size={16} strokeWidth={2} /> Menu
          </button>
        </header>

        {menuOpen && (
          <div className="border-b border-ink-200 bg-white p-3 lg:hidden">
            {items.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setMenuOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                  isActive(n.href)
                    ? "bg-brand-50 text-brand-700"
                    : "text-ink-600"
                }`}
              >
                <n.icon size={18} strokeWidth={2} className="shrink-0" />
                {n.label}
              </Link>
            ))}
            <Link
              href="/notifications"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-600"
            >
              <Bell size={18} strokeWidth={2} /> Thông báo {unread > 0 && `(${unread})`}
            </Link>
            <Link
              href="/doi-mat-khau"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-600"
            >
              <KeyRound size={18} strokeWidth={2} /> Đổi mật khẩu
            </Link>
            <button
              onClick={logout}
              className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-red-600"
            >
              Đăng xuất
            </button>
          </div>
        )}

        <main className="flex-1 px-4 py-5 pb-24 sm:px-6 lg:px-8 lg:pb-8">
          {children}
        </main>

        {/* Thanh dưới (mobile) — thao tác 3 chạm cho nhân viên ngoài xưởng */}
        <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-ink-200 bg-white lg:hidden">
          {mobileItems.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${
                isActive(n.href) ? "text-brand-700" : "text-ink-500"
              }`}
            >
              <n.icon size={20} strokeWidth={2} />
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
