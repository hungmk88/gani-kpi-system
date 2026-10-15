/**
 * SỬA DỮ LIỆU NGÀY GIỜ CŨ — chạy MỘT LẦN sau khi deploy bản sửa múi giờ.
 *
 *   node scripts/fix-dates.mjs            # chạy thử: chỉ in ra sẽ sửa gì
 *   node scripts/fix-dates.mjs --apply    # sửa thật (nên sao lưu trước: npm run backup)
 *
 * Hai việc:
 *
 * 1. Hạn chốt 2-4-5 của các kỳ KPI CHƯA CHỐT: tính lại đúng 23:59:59 giờ VN
 *    (bản cũ tính theo giờ server UTC nên lưu thành 06:59 hoặc 13:59 ngày hôm sau).
 *
 * 2. Ngày ca sản xuất (production_shift_logs.shiftDate): bản cũ nhận 00:00 giờ
 *    VN từ trình duyệt (= 17:00Z hôm trước) rồi setHours(0) theo giờ server
 *    UTC -> lưu thành 00:00Z HÔM TRƯỚC, tức lùi một ngày. Chuẩn mới là 00:00
 *    giờ VN (= 17:00Z hôm trước). Dòng có giờ đúng 00:00:00Z được cộng 17 tiếng.
 *    Dòng nào cộng xong đụng ca đã có (cùng ngày, ca, SKU) thì bỏ qua và in ra
 *    để xử lý tay.
 */
import { PrismaClient } from "@prisma/client";

try {
  process.loadEnvFile(".env");
} catch {
  /* dùng biến môi trường sẵn có */
}

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();
const OFFSET = 7 * 3600_000;

const vnDate = (y, m, d, h = 0, mi = 0, s = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, mi, s) - OFFSET);
const fmt = (d) =>
  new Date(d.getTime() + OFFSET).toISOString().replace("T", " ").slice(0, 19) + " (giờ VN)";

// Giữ khớp lib/constants.ts KPI_DEADLINE_DAYS
const DEADLINE_DAYS = { SELF_REVIEW: 2, MANAGER_REVIEW: 4, CEO_APPROVAL: 5 };

async function fixPeriods() {
  const periods = await prisma.kpiPeriod.findMany({
    where: { status: { not: "FINALIZED" } },
  });
  let changed = 0;
  for (const p of periods) {
    const at = (day) => vnDate(p.year, p.month + 1, day, 23, 59, 59);
    const next = {
      selfReviewDeadline: at(DEADLINE_DAYS.SELF_REVIEW),
      managerReviewDeadline: at(DEADLINE_DAYS.MANAGER_REVIEW),
      ceoApprovalDeadline: at(DEADLINE_DAYS.CEO_APPROVAL),
    };
    const diff = Object.entries(next).filter(
      ([k, v]) => p[k].getTime() !== v.getTime()
    );
    if (diff.length === 0) continue;
    changed++;
    console.log(`Kỳ ${p.name} (${p.status}):`);
    for (const [k, v] of diff) console.log(`   ${k}: ${fmt(p[k])}  ->  ${fmt(v)}`);
    if (APPLY) await prisma.kpiPeriod.update({ where: { id: p.id }, data: next });
  }
  console.log(`→ ${changed}/${periods.length} kỳ chưa chốt cần sửa hạn.\n`);
}

async function fixShiftDates() {
  const rows = await prisma.$queryRaw`
    SELECT id, "shiftDate", "shiftType", "skuId"
    FROM production_shift_logs
    WHERE "shiftDate" = date_trunc('day', "shiftDate")
  `;
  let fixed = 0;
  const conflicts = [];
  for (const r of rows) {
    const target = new Date(r.shiftDate.getTime() + 17 * 3600_000);
    const clash = await prisma.productionShiftLog.findFirst({
      where: { shiftDate: target, shiftType: r.shiftType, skuId: r.skuId, NOT: { id: r.id } },
      select: { id: true },
    });
    if (clash) {
      conflicts.push(r.id);
      continue;
    }
    fixed++;
    if (APPLY) {
      await prisma.productionShiftLog.update({
        where: { id: r.id },
        data: { shiftDate: target },
      });
    }
  }
  console.log(`→ ${fixed} ca sản xuất lùi một ngày ${APPLY ? "đã sửa" : "sẽ được sửa"}.`);
  if (conflicts.length) {
    console.log(`⚠ ${conflicts.length} ca bỏ qua vì trùng ca đã có (xử lý tay): ${conflicts.join(", ")}`);
  }
}

async function main() {
  console.log(APPLY ? "=== SỬA THẬT ===\n" : "=== CHẠY THỬ (thêm --apply để sửa) ===\n");
  await fixPeriods();
  await fixShiftDates();
  if (!APPLY) console.log("\nChưa ghi gì vào database.");
}

main()
  .catch((e) => {
    console.error("❌", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
