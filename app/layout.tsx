import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import "./globals.css";

/*
 * Font chính: Be Vietnam Pro — thiết kế cho tiếng Việt, dấu không chồng chéo.
 * Tải qua next/font nên tự host, không gọi Google lúc người dùng mở trang;
 * mọi máy (Windows, Mac, điện thoại) hiện cùng một kiểu chữ.
 */
const beVietnam = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-be-vietnam",
});

export const metadata: Metadata = {
  title: {
    default: "GANI FOODY — Quản lý Công việc & KPI",
    template: "%s · GANI KPI",
  },
  description:
    "Hệ thống quản lý công việc và đánh giá KPI nội bộ của GANI FOODY",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "GANI KPI",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  // Cho phép nội dung chạy tới mép màn hình iPhone; thanh điều hướng dưới tự
  // chừa vùng an toàn bằng env(safe-area-inset-bottom).
  viewportFit: "cover",
  themeColor: "#176ca3",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi" className={beVietnam.variable}>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
