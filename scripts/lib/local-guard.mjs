/**
 * Chốt chặn cho script kiểm thử / reset: CHỈ chạy vào máy local.
 *
 * Smoke test ghi và xoá dữ liệu thật qua Prisma; db:reset xoá sạch database.
 * Lỡ để APP_URL / DATABASE_URL trỏ vào production là mất dữ liệu thật. Muốn
 * cố tình chạy vào môi trường khác thì phải đặt ALLOW_REMOTE_TARGET=1.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function assertLocalTarget({ appUrl, databaseUrl = process.env.DATABASE_URL } = {}) {
  if (process.env.ALLOW_REMOTE_TARGET === "1") return;
  const bad = [];
  if (appUrl && !LOCAL_HOSTS.has(hostOf(appUrl) ?? "")) bad.push(`APP_URL=${appUrl}`);
  if (databaseUrl && !LOCAL_HOSTS.has(hostOf(databaseUrl) ?? "")) {
    bad.push(`DATABASE_URL trỏ tới ${hostOf(databaseUrl) ?? "?"}`);
  }
  if (bad.length) {
    console.error(
      `❌ Từ chối chạy: ${bad.join(", ")} không phải máy local.\n` +
        "   Script này ghi/xoá dữ liệu. Cố tình chạy thì đặt ALLOW_REMOTE_TARGET=1."
    );
    process.exit(1);
  }
}
