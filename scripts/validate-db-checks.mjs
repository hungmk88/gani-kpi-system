/**
 * Kiểm dữ liệu CŨ với các CHECK constraint đang ở chế độ NOT VALID
 * (migration 20261016090000_money_int_and_checks), rồi xác nhận chúng.
 *
 *   node scripts/validate-db-checks.mjs            # chỉ báo dòng nào sai giá trị
 *   node scripts/validate-db-checks.mjs --apply    # xác nhận (VALIDATE) các constraint đã sạch
 *
 * Constraint NOT VALID vẫn chặn mọi dòng ghi mới; nhưng một dòng CŨ đang mang
 * giá trị sai sẽ không sửa được gì khác cho tới khi chính giá trị đó được sửa —
 * nên chạy script này sau khi migrate và sửa tay các dòng nó liệt kê.
 */
import { PrismaClient } from "@prisma/client";

try {
  process.loadEnvFile(".env");
} catch {
  /* dùng biến môi trường sẵn có */
}

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRaw`
    SELECT c.conname AS name, t.relname AS "table",
           pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.contype = 'c' AND NOT c.convalidated AND n.nspname = current_schema()
    ORDER BY 2, 1
  `;
  if (rows.length === 0) {
    console.log("✅ Mọi CHECK constraint đã được xác nhận, không còn gì để kiểm.");
    return;
  }
  let dirty = 0;
  for (const r of rows) {
    // def dạng: CHECK ((...)) NOT VALID
    const expr = r.def.replace(/^CHECK\s*/, "").replace(/\s*NOT VALID\s*$/, "");
    const [{ n }] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "${r.table}" WHERE NOT ${expr}`
    );
    if (n > 0) {
      dirty++;
      const col = r.name.slice(r.table.length + 1, -"_check".length);
      const sample = await prisma.$queryRawUnsafe(
        `SELECT id, "${col}" AS value FROM "${r.table}" WHERE NOT ${expr} LIMIT 10`
      );
      console.log(`❌ ${r.name}: ${n} dòng sai giá trị. Ví dụ:`, sample);
      continue;
    }
    if (APPLY) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${r.table}" VALIDATE CONSTRAINT "${r.name}"`);
      console.log(`✅ ${r.name}: sạch, đã xác nhận.`);
    } else {
      console.log(`✅ ${r.name}: sạch (chạy --apply để xác nhận).`);
    }
  }
  if (dirty) {
    console.log(`\n${dirty} constraint còn dữ liệu cũ sai — sửa các dòng trên rồi chạy lại.`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("❌", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
