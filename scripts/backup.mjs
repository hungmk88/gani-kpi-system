/**
 * SAO LƯU DATABASE POSTGRES — GANI FOODY KPI System
 *
 * Chạy tay:        npm run backup          (cần pg_dump cùng phiên bản lớn với server)
 * Chạy tự động:    GitHub Actions mỗi đêm  (.github/workflows/backup.yml)
 *
 * Dùng `pg_dump --format=custom`: một ảnh nhất quán của cả database, nén sẵn,
 * khôi phục được từng bảng bằng pg_restore. Kết nối qua DIRECT_URL (cổng 5432)
 * — pooler pgbouncer (6543) không chạy được pg_dump.
 *
 * Quy tắc giữ bản sao (GIU_LAI): giữ 14 bản gần nhất + bản đầu tiên của mỗi
 * tháng. Bản đầu tháng giữ vĩnh viễn, vì hỏng dữ liệu thường được phát hiện
 * muộn — sau khi 14 bản gần nhất đã cuốn qua và chép cả cái hỏng.
 *
 * Khôi phục (vào một database TRỐNG, đừng đè thẳng production):
 *   pg_restore --no-owner --no-privileges -d "<DIRECT_URL đích>" backups/kpi-YYYYMMDD-HHmm.dump
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

try {
  process.loadEnvFile(".env");
} catch {
  /* dùng biến môi trường sẵn có */
}

const GIU_LAI = Number(process.env.BACKUP_KEEP_DAILY || 14);
const BACKUP_DIR = process.env.BACKUP_DIR || "backups";
const PG_DUMP = process.env.PG_DUMP_BIN || "pg_dump";

/** Dấu thời gian theo giờ Việt Nam: YYYYMMDD-HHmm */
function stamp(d = new Date()) {
  const v = new Date(d.getTime() + 7 * 3600_000);
  const p = (n) => String(n).padStart(2, "0");
  return (
    v.getUTCFullYear() +
    p(v.getUTCMonth() + 1) +
    p(v.getUTCDate()) +
    "-" +
    p(v.getUTCHours()) +
    p(v.getUTCMinutes())
  );
}

function humanSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function runPgDump(url, outPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      PG_DUMP,
      ["--format=custom", "--no-owner", "--no-privileges", "--file", outPath, url],
      { stdio: ["ignore", "inherit", "pipe"] }
    );
    let stderr = "";
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", (e) =>
      reject(
        new Error(
          e.code === "ENOENT"
            ? `Không tìm thấy ${PG_DUMP}. Cài PostgreSQL client (cùng phiên bản lớn với server) hoặc đặt PG_DUMP_BIN.`
            : e.message
        )
      )
    );
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`pg_dump thoát mã ${code}: ${stderr.trim()}`))
    );
  });
}

export async function runBackup({ quiet = false } = {}) {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL || "";
  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new Error("Thiếu DIRECT_URL (postgresql://...) để sao lưu.");
  }
  if (/pgbouncer=true|:6543\//.test(url)) {
    throw new Error("Đang trỏ vào pooler (6543). Đặt DIRECT_URL cổng 5432 để chạy pg_dump.");
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `kpi-${stamp()}.dump`;
  const outPath = path.resolve(BACKUP_DIR, name);

  await runPgDump(url, outPath);
  const size = fs.statSync(outPath).size;

  /* ------------------------- Dọn bản cũ ------------------------- */

  const all = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => /^kpi-\d{8}-\d{4}\.dump$/.test(f))
    .sort()
    .reverse(); // mới nhất trước

  const giu = new Set(all.slice(0, GIU_LAI));

  // Bản đầu tiên của mỗi tháng: giữ vĩnh viễn
  const dauThang = new Map();
  for (const f of [...all].reverse()) {
    const thang = f.slice(4, 10); // YYYYMM
    if (!dauThang.has(thang)) dauThang.set(thang, f);
  }
  for (const f of dauThang.values()) giu.add(f);

  let xoa = 0;
  for (const f of all) {
    if (giu.has(f)) continue;
    fs.rmSync(path.join(BACKUP_DIR, f));
    xoa++;
  }

  const result = {
    skipped: false,
    file: name,
    dir: path.resolve(BACKUP_DIR),
    sizeBytes: size,
    kept: giu.size,
    deleted: xoa,
  };

  if (!quiet) {
    console.log(`✅ Đã sao lưu: ${BACKUP_DIR}/${name} (${humanSize(size)})`);
    console.log(`   Đang giữ ${giu.size} bản, vừa dọn ${xoa} bản cũ.`);
    console.log(
      `   Khôi phục vào database trống: pg_restore --no-owner --no-privileges -d "<url>" ${BACKUP_DIR}/${name}`
    );
  }

  return result;
}

// Chạy trực tiếp từ dòng lệnh
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBackup().catch((e) => {
    console.error("❌ Sao lưu thất bại:", e.message);
    process.exit(1);
  });
}
