/**
 * BỘ MÁY CHẠY NỀN — GANI FOODY KPI System
 *
 * Chạy song song với server web:  npm run scheduler
 *
 * Lịch chạy:
 *   - 23:59 ngày 2 hàng tháng  → khoá bước nhân viên tự khai
 *   - 23:59 ngày 4 hàng tháng  → khoá bước trưởng phòng duyệt, đẩy lên BGĐ
 *   - 08:00 ngày 5 hàng tháng  → nhắc Ban Giám đốc còn kỳ chưa chốt
 *   - 08:00 hàng ngày          → nhắc hạn cho ai còn việc chưa làm
 *   - mỗi 2 tiếng              → đối soát dữ liệu + quét rủi ro công việc
 *   - 00:30 hàng ngày          → sao lưu database
 *
 * Mỗi lần chạy làm đủ 5 việc: khoá KPI theo lịch, đối soát dữ liệu đa nguồn,
 * tính lại điểm, quét rủi ro, nhắc hạn. Chạy lại nhiều lần vẫn an toàn — lời
 * nhắc có chặn trùng, mỗi người chỉ nhận một lần mỗi ngày.
 *
 * Script này chỉ gọi vào endpoint /api/cron/run của server web, nên toàn bộ
 * nghiệp vụ vẫn nằm một chỗ, không bị lệch logic giữa hai nơi.
 */
import cron from "node-cron";
import { runBackup } from "./backup.mjs";

try {
  process.loadEnvFile(".env");
} catch {
  /* dùng biến môi trường sẵn có */
}

const APP_URL = process.env.APP_URL || "http://localhost:3000";
const CRON_SECRET = process.env.CRON_SECRET || "";

if (!CRON_SECRET) {
  console.error(
    "❌ Thiếu CRON_SECRET trong .env — bộ máy chạy nền sẽ bị server từ chối."
  );
  process.exit(1);
}

async function fire(label) {
  const stamp = new Date().toLocaleString("vi-VN");
  try {
    const res = await fetch(`${APP_URL}/api/cron/run`, {
      method: "POST",
      headers: { "x-cron-secret": CRON_SECRET },
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`[${stamp}] ${label} — LỖI:`, data.message ?? res.status);
      return;
    }
    console.log(`[${stamp}] ${label} — xong.`);
    if (Array.isArray(data.kpiLock)) {
      data.kpiLock.forEach((line) => console.log(`    · ${line}`));
    }
    if (data.reconciliation) {
      const r = data.reconciliation;
      console.log(
        `    · Đối soát: ${r.checked} ô có nhiều nguồn, ${r.matched} khớp, ${r.mismatched} đang lệch (treo chờ quyết).`
      );
    }
    if (data.riskScan) {
      const r = data.riskScan;
      console.log(
        `    · Quét rủi ro: ${r.scanned} việc, ${r.newCritical} việc vừa lên báo động đỏ, ${r.remindersSent} lượt nhắc, ${r.overloaded} việc thuộc người quá tải, ${r.blockedByLate} việc chờ mắt xích đã trễ.`
      );
    }
    if (data.reminders) {
      const r = data.reminders;
      const total =
        r.selfReminders + r.managerReminders + r.ceoReminders;
      if (total > 0) {
        console.log(
          `    · Nhắc hạn: ${r.selfReminders} nhân viên, ${r.managerReminders} trưởng phòng, ${r.ceoReminders} Ban Giám đốc, ${r.approvalRequests} yêu cầu duyệt gửi qua Telegram.`
        );
      }
    }
    if (data.staleMismatch?.stale > 0) {
      console.log(
        `    · ⚠ ${data.staleMismatch.stale} ô KPI treo vì lệch số quá lâu, chưa ai quyết.`
      );
    }
  } catch (e) {
    console.error(`[${stamp}] ${label} — không gọi được server:`, e.message);
  }
}

// Múi giờ Việt Nam để lịch 2-4-5 chạy đúng ngày
const OPTS = { timezone: "Asia/Ho_Chi_Minh" };

cron.schedule("59 23 2 * *", () => fire("Khoá bước nhân viên tự khai"), OPTS);
cron.schedule("59 23 4 * *", () => fire("Khoá bước trưởng phòng duyệt"), OPTS);
cron.schedule("0 8 5 * *", () => fire("Nhắc Ban Giám đốc chốt kỳ"), OPTS);
cron.schedule("0 8 * * *", () => fire("Nhắc hạn hàng ngày"), OPTS);
cron.schedule("0 */2 * * *", () => fire("Đối soát dữ liệu & quét rủi ro"), OPTS);

// Sao lưu chạy lúc nửa đêm hơn, lúc không ai làm việc — VACUUM INTO đọc toàn bộ
// database nên trên ổ cứng cơ nó cũng ngốn một lúc.
cron.schedule(
  "30 0 * * *",
  async () => {
    const stamp = new Date().toLocaleString("vi-VN");
    try {
      const r = await runBackup({ quiet: true });
      if (r.skipped) {
        console.log(`[${stamp}] Sao lưu — bỏ qua: ${r.reason}`);
        return;
      }
      console.log(
        `[${stamp}] Sao lưu — xong: ${r.file} (${(r.sizeBytes / 1024 / 1024).toFixed(1)} MB), đang giữ ${r.kept} bản, dọn ${r.deleted} bản cũ.`
      );
    } catch (e) {
      // Sao lưu hỏng mà im lặng là tệ nhất: tưởng có bản sao mà thật ra không có
      console.error(`[${stamp}] ❌ SAO LƯU THẤT BẠI: ${e.message}`);
      console.error(`   Kiểm tra ngay — từ lúc này hệ thống KHÔNG có bản sao mới.`);
    }
  },
  OPTS
);

console.log("✅ Bộ máy chạy nền GANI KPI đã khởi động.");
console.log(`   Server: ${APP_URL}`);
console.log("   Lịch: khoá KPI 23:59 ngày 2 và ngày 4, nhắc BGĐ 08:00 ngày 5,");
console.log("         nhắc hạn 08:00 hàng ngày, đối soát + quét rủi ro mỗi 2 tiếng,");
console.log("         sao lưu database 00:30 hàng ngày.");
console.log("   Nhấn Ctrl+C để dừng.\n");

// Chạy một nhịp ngay khi khởi động để trạng thái luôn tươi
fire("Chạy nhịp đầu tiên khi khởi động");
