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

/**
 * @param {object} [opts]
 * @param {string} [opts.appUrl]
 * @param {string} [opts.databaseUrl]  mặc định DATABASE_URL
 * @param {string} [opts.overrideEnv]  biến môi trường =1 để cố tình cho qua
 *   (mặc định ALLOW_REMOTE_TARGET; seed dùng ALLOW_PROD_SEED).
 */
export function assertLocalTarget({
  appUrl,
  databaseUrl = process.env.DATABASE_URL,
  overrideEnv = "ALLOW_REMOTE_TARGET",
} = {}) {
  if (process.env[overrideEnv] === "1") return;
  const bad = [];
  if (appUrl && !LOCAL_HOSTS.has(hostOf(appUrl) ?? "")) bad.push(`APP_URL=${appUrl}`);
  if (databaseUrl && !LOCAL_HOSTS.has(hostOf(databaseUrl) ?? "")) {
    bad.push(`DATABASE_URL trỏ tới ${hostOf(databaseUrl) ?? "?"}`);
  }
  if (bad.length) {
    console.error(
      `❌ Từ chối chạy: ${bad.join(", ")} không phải máy local.\n` +
        `   Script này ghi/xoá dữ liệu. Cố tình chạy thì đặt ${overrideEnv}=1.`
    );
    process.exit(1);
  }
}
