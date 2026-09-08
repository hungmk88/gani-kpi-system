/**
 * SAO LƯU DATABASE — GANI FOODY KPI System
 *
 * Chạy tay:        npm run backup
 * Chạy tự động:    bộ máy chạy nền gọi mỗi ngày lúc 00:30 (xem scripts/scheduler.mjs)
 *
 * Vì sao không chỉ copy file dev.db:
 *   SQLite đang chạy thì file .db có thể đang dở một giao dịch, và còn hai file
 *   phụ đi kèm (-wal, -shm) giữ những thay đổi chưa gộp vào file chính. Copy
 *   thẳng file .db lúc server đang ghi thì được một bản sao có khả năng hỏng —
 *   mà chỉ phát hiện ra đúng lúc cần khôi phục.
 *
 *   `VACUUM INTO` là lệnh của chính SQLite: nó tự chốt một ảnh nhất quán và ghi
 *   ra file mới, kể cả khi server đang chạy. Bản ra còn được nén lại, nhỏ hơn
 *   bản gốc.
 *
 * Quy tắc giữ bản sao (xem GIU_LAI bên dưới): giữ 14 bản gần nhất + bản đầu
 * tiên của mỗi tháng. Bản đầu tháng giữ vĩnh viễn, vì hỏng dữ liệu thường được
 * phát hiện muộn — sau khi 14 bản gần nhất đã cuốn qua và chép cả cái hỏng.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

try {
  process.loadEnvFile(".env");
} catch {
  /* dùng biến môi trường sẵn có */
}

const GIU_LAI = Number(process.env.BACKUP_KEEP_DAILY || 14);
const BACKUP_DIR = process.env.BACKUP_DIR || "backups";

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    "-" +
    p(d.getHours()) +
    p(d.getMinutes())
  );
}

function humanSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

export async function runBackup({ quiet = false } = {}) {
  const url = process.env.DATABASE_URL || "";
  if (!url.startsWith("file:")) {
    // Postgres có bộ sao lưu riêng của nhà cung cấp (Supabase/Neon đều có sẵn),
    // script này không cố làm thay và cũng không im lặng giả vờ đã xong.
    const msg =
      "DATABASE_URL không phải SQLite — dùng bộ sao lưu của nhà cung cấp Postgres, script này bỏ qua.";
    if (!quiet) console.log("· " + msg);
    return { skipped: true, reason: msg };
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const name = `kpi-${stamp()}.db`;
  const outPath = path.resolve(BACKUP_DIR, name);

  if (fs.existsSync(outPath)) {
    // VACUUM INTO từ chối ghi đè, nên xoá bản cùng phút trước khi chạy lại
    fs.rmSync(outPath);
  }

  const prisma = new PrismaClient();
  try {
    // Nháy đơn trong tên file sẽ phá câu lệnh — chặn thẳng thay vì tìm cách thoát
    if (outPath.includes("'")) {
      throw new Error("Đường dẫn thư mục sao lưu không được chứa dấu nháy đơn.");
    }
    await prisma.$executeRawUnsafe(`VACUUM INTO '${outPath.replace(/\\/g, "/")}'`);
  } finally {
    await prisma.$disconnect();
  }

  const size = fs.statSync(outPath).size;

  /* ------------------------- Dọn bản cũ ------------------------- */

  const all = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => /^kpi-\d{8}-\d{4}\.db$/.test(f))
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
      `   Khôi phục: dừng server, chép đè file này thành prisma/dev.db, xoá dev.db-wal và dev.db-shm nếu có.`
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
