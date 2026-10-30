"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
  MoreHorizontal,
  X,
  LogOut,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { Avatar } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/constants";
import { Toaster } from "@/components/toast";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: string[];
  mobile?: boolean;
  /** Chỉ hiện cho người có vai trò trong xưởng (hoặc BGĐ / quản trị). */
  productionOnly?: boolean;
  /** Nhóm trên thanh bên — menu phẳng 9 mục khó dò */
  group: "work" | "kpi" | "factory" | "system";
};

const GROUP_LABEL: Record<NavItem["group"], string> = {
  work: "Công việc",
  kpi: "KPI & đánh giá",
  factory: "Xưởng",
  system: "Hệ thống",
};

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Trang chủ", icon: Home, roles: ["EMPLOYEE", "MANAGER", "CEO", "ADMIN"], mobile: true, group: "work" },
  { href: "/tasks", label: "Công việc", icon: CheckSquare, roles: ["EMPLOYEE", "MANAGER", "CEO", "ADMIN"], mobile: true, group: "work" },
  { href: "/kpi", label: "KPI", icon: BarChart3, roles: ["EMPLOYEE", "MANAGER", "CEO", "ADMIN"], mobile: true, group: "kpi" },
  { href: "/requests", label: "Yêu cầu liên phòng", icon: Repeat2, roles: ["MANAGER", "CEO"], group: "work" },
  { href: "/leave-requests", label: "Nghỉ phép", icon: Palmtree, roles: ["EMPLOYEE", "MANAGER", "CEO", "ADMIN"], group: "work" },
  { href: "/reconciliation", label: "Đối soát dữ liệu", icon: Scale, roles: ["MANAGER", "CEO"], group: "kpi" },
  { href: "/production", label: "Xưởng sản xuất", icon: Factory, roles: ["EMPLOYEE", "MANAGER", "CEO", "ADMIN"], productionOnly: true, group: "factory" },
  { href: "/analytics", label: "Phân tích & Dự báo", icon: TrendingUp, roles: ["MANAGER", "CEO"], group: "kpi" },
  { href: "/ceo", label: "Bảng điều hành", icon: Target, roles: ["CEO"], mobile: true, group: "kpi" },
  { href: "/audit", label: "Nhật ký hệ thống", icon: ScrollText, roles: ["CEO", "ADMIN"], group: "system" },
  { href: "/admin", label: "Quản trị", icon: Settings, roles: ["ADMIN"], mobile: true, group: "system" },
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
  // Thanh dưới điện thoại theo vai trò: người trong xưởng cần "Xưởng" ngay
  // ở thanh dưới (trước đây phải mở Menu mới thấy); BGĐ cần Bảng điều hành;
  // quản trị cần Quản trị. Cộng Thông báo và "Thêm" mở toàn bộ menu.
  const pick = (href: string) => items.find((n) => n.href === href);
  const thirdItem =
    (user.productionRole ? pick("/production") : undefined) ??
    (user.role === "CEO" ? pick("/ceo") : undefined) ??
    (user.role === "ADMIN" ? pick("/admin") : undefined) ??
    pick("/kpi");
  const mobileItems = [pick("/dashboard"), pick("/tasks"), thirdItem].filter(
    (n): n is NavItem => !!n
  );

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  // Menu tài khoản (avatar trên thanh đầu trang, máy tính)
  const [accountOpen, setAccountOpen] = useState(false);

  // Chuyển trang thì đóng ngăn menu; Esc cũng đóng
  useEffect(() => {
    setMenuOpen(false);
    setAccountOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!accountOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAccountOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [accountOpen]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const groups = (["work", "kpi", "factory", "system"] as const)
    .map((g) => ({ g, list: items.filter((n) => n.group === g) }))
    .filter((x) => x.list.length > 0);
  const roleLine = `${ROLE_LABEL[user.role]}${
    user.departmentName && user.departmentName !== ROLE_LABEL[user.role]
      ? ` · ${user.departmentName}`
      : ""
  }`;

  const navList = (onNavigate?: () => void) => (
    <div className="space-y-4">
      {groups.map(({ g, list }) => (
        <div key={g}>
          <div className="mb-1 px-3 text-xs font-medium text-ink-400">
            {GROUP_LABEL[g]}
          </div>
          <div className="space-y-0.5">
            {list.map((n) => {
              const active = isActive(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${
                    active
                      ? "bg-brand-50 text-brand-800 before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-brand-600"
                      : "text-ink-600 hover:bg-ink-50 hover:text-ink-900"
                  }`}
                >
                  <n.icon size={18} strokeWidth={2} className="shrink-0" />
                  {n.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  const unreadBadge =
    unread > 0 ? (
      <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-xs leading-none font-semibold text-white">
        {unread > 99 ? "99+" : unread}
      </span>
    ) : null;

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
    <div className="flex min-h-screen flex-col">
      <Toaster />
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
      {/* ---------------- Thanh đầu trang (GANI Vivid) ----------------
          Gradient theo màu logo, chạy hết chiều ngang ở mọi kích thước màn
          hình. Logo đặt trên ô trắng để giữ đúng màu thương hiệu. */}
      <header className="vivid-bar sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 px-4 text-white shadow-[0_2px_12px_-4px_rgb(11_47_71/0.45)] lg:px-5 print:hidden">
        <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-white shadow-sm">
            <Image src="/logo-mark.png" alt="" width={26} height={26} />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[15px] font-bold tracking-tight">
              GANI FOODY
            </span>
            <span className="hidden text-xs text-white/75 sm:block">
              Công việc &amp; KPI
            </span>
          </span>
        </Link>

        <div className="flex items-center gap-1.5">
          <Link
            href="/notifications"
            aria-label={`Thông báo${unread > 0 ? ` (${unread} chưa đọc)` : ""}`}
            aria-current={isActive("/notifications") ? "page" : undefined}
            className="relative flex h-10 w-10 items-center justify-center rounded-[10px] text-white/90 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
          >
            <Bell size={20} strokeWidth={2} />
            {unread > 0 && (
              <span className="absolute top-1 right-1 min-w-4 rounded-full bg-red-600 px-1 text-center text-[11px] leading-4 font-semibold text-white ring-2 ring-[#114b70]">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Link>

          {/* Tài khoản (máy tính): avatar + tên, bấm ra Đổi mật khẩu / Đăng xuất */}
          <div className="relative hidden lg:block">
            <button
              onClick={() => setAccountOpen((v) => !v)}
              aria-expanded={accountOpen}
              aria-haspopup="menu"
              className="flex items-center gap-2 rounded-full border border-white/15 bg-white/10 py-1 pr-3 pl-1 text-sm hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
            >
              <Avatar name={user.fullName} size={30} className="ring-2 ring-white/30" />
              <span className="max-w-44 truncate font-medium">{user.fullName}</span>
              <ChevronDown size={16} className="text-white/75" />
            </button>
            {accountOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setAccountOpen(false)}
                  aria-hidden
                />
                <div
                  role="menu"
                  className="absolute right-0 z-50 mt-2 w-64 rounded-[14px] border border-ink-200 bg-white p-1.5 text-ink-700 shadow-lift"
                >
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <Avatar name={user.fullName} size={36} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink-900">
                        {user.fullName}
                      </div>
                      <div className="truncate text-xs text-ink-500">{roleLine}</div>
                    </div>
                  </div>
                  <div className="my-1 border-t border-ink-100" />
                  <Link
                    role="menuitem"
                    href="/doi-mat-khau"
                    className="flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-medium hover:bg-ink-50"
                  >
                    <KeyRound size={16} strokeWidth={2} /> Đổi mật khẩu
                  </Link>
                  <button
                    role="menuitem"
                    onClick={logout}
                    className="flex min-h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium hover:bg-ink-50"
                  >
                    <LogOut size={16} strokeWidth={2} /> Đăng xuất
                  </button>
                </div>
              </>
            )}
          </div>

          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Mở menu"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            className="flex h-10 w-10 items-center justify-center rounded-[10px] text-white hover:bg-white/10 lg:hidden"
          >
            <MenuIcon size={22} strokeWidth={2} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
      {/* ---------------- Sidebar (desktop) ---------------- */}
      {/* Dính theo màn hình: trang dài thì Thông báo / Đăng xuất vẫn trong tầm mắt */}
      <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 flex-col border-r border-ink-200 bg-white lg:flex print:hidden">
        <nav aria-label="Điều hướng chính" className="flex-1 overflow-y-auto p-3">
          {navList()}
        </nav>

        {/* Thông báo + tài khoản đã lên thanh đầu trang */}
        <div className="border-t border-ink-100 px-5 py-3 text-xs text-ink-400">
          GANI FOODY · Công việc &amp; KPI
        </div>
      </aside>

      {/* ---------------- Nội dung ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Ngăn menu nổi (điện thoại): phủ lên trang, không đẩy nội dung —
            trước đây menu mở ở đầu trang, đang cuộn giữa trang bấm thì
            tưởng không có gì xảy ra. */}
        {menuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden" id="mobile-menu">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setMenuOpen(false)}
              aria-hidden
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
              className="absolute inset-y-0 right-0 flex w-[min(320px,85vw)] flex-col bg-white shadow-xl"
            >
              <div className="flex h-14 items-center justify-between border-b border-ink-100 px-4">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink-900">
                    {user.fullName}
                  </div>
                  <div className="truncate text-xs text-ink-500">{roleLine}</div>
                </div>
                <button
                  onClick={() => setMenuOpen(false)}
                  aria-label="Đóng menu"
                  className="flex h-11 w-11 items-center justify-center rounded-md text-ink-600 hover:bg-ink-50"
                >
                  <X size={20} strokeWidth={2} />
                </button>
              </div>
              <nav aria-label="Menu" className="flex-1 overflow-y-auto p-3">
                {navList(() => setMenuOpen(false))}
                <div className="mt-4 space-y-0.5 border-t border-ink-100 pt-3">
                  <Link
                    href="/notifications"
                    onClick={() => setMenuOpen(false)}
                    className="flex min-h-11 items-center justify-between rounded-md px-3 text-sm font-medium text-ink-600"
                  >
                    <span className="flex items-center gap-3">
                      <Bell size={18} strokeWidth={2} /> Thông báo
                    </span>
                    {unreadBadge}
                  </Link>
                  <Link
                    href="/doi-mat-khau"
                    onClick={() => setMenuOpen(false)}
                    className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-ink-600"
                  >
                    <KeyRound size={18} strokeWidth={2} /> Đổi mật khẩu
                  </Link>
                  <button
                    onClick={logout}
                    className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium text-ink-600"
                  >
                    <LogOut size={18} strokeWidth={2} /> Đăng xuất
                  </button>
                </div>
              </nav>
            </div>
          </div>
        )}

        <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 py-5 pb-[calc(88px+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:pb-8">
          {children}
        </main>

        {/* Thanh dưới (điện thoại) — theo vai trò, chừa vùng an toàn iPhone */}
        <nav
          aria-label="Điều hướng nhanh"
          className="fixed inset-x-0 bottom-0 z-30 flex border-t border-ink-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden print:hidden"
        >
          {mobileItems.map((n) => {
            const active = isActive(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                  active ? "text-brand-700" : "text-ink-500"
                }`}
              >
                <span
                  className={`flex h-7 w-12 items-center justify-center rounded-full ${
                    active ? "bg-brand-50" : ""
                  }`}
                >
                  <n.icon size={20} strokeWidth={active ? 2.4 : 2} />
                </span>
                {n.href === "/production" ? "Xưởng" : n.href === "/ceo" ? "Điều hành" : n.label}
              </Link>
            );
          })}
          <Link
            href="/notifications"
            aria-current={isActive("/notifications") ? "page" : undefined}
            className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
              isActive("/notifications") ? "text-brand-700" : "text-ink-500"
            }`}
          >
            <span
              className={`relative flex h-7 w-12 items-center justify-center rounded-full ${
                isActive("/notifications") ? "bg-brand-50" : ""
              }`}
            >
              <Bell size={20} strokeWidth={2} />
              {unread > 0 && (
                <span className="absolute -top-0.5 right-1.5 h-2 w-2 rounded-full bg-red-600" />
              )}
            </span>
            Thông báo
          </Link>
          <button
            onClick={() => setMenuOpen(true)}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium text-ink-500"
          >
            <span className="flex h-7 w-12 items-center justify-center">
              <MoreHorizontal size={20} strokeWidth={2} />
            </span>
            Thêm
          </button>
        </nav>
      </div>
      </div>
    </div>
  );
}
