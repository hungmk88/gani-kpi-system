import type { NextConfig } from "next";

// Force Vietnam timezone
process.env.TZ = "Asia/Ho_Chi_Minh";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["exceljs", "bcryptjs"],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
