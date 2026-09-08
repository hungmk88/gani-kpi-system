import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GANI FOODY — Quản lý Công việc & KPI",
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
  themeColor: "#1b6ef5",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
