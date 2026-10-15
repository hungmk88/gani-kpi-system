/**
 * Kiểm dữ liệu CŨ với các CHECK constraint đang ở chế độ NOT VALID
 * (migration 20261016090000_money_int_and_checks), rồi xác nhận chúng.
 *
 *   node scripts/validate-db-checks.mjs --preflight  # TRƯỚC migrate: đếm dòng sẽ vi phạm
 *   node scripts/validate-db-checks.mjs              # SAU migrate: chỉ báo dòng nào sai giá trị
 *   node scripts/validate-db-checks.mjs --apply      # xác nhận (VALIDATE) các constraint đã sạch
 *
 * --preflight không cần constraint tồn tại: đọc định nghĩa CHECK thẳng từ
 * prisma/migrations/<thư mục>/migration.sql (lấy bản ADD CONSTRAINT MỚI NHẤT theo tên,
 * bỏ qua cái đã DROP mà không ADD lại), rồi đếm
 * `SELECT count(*) FROM bảng WHERE NOT (điều kiện)` trên database hiện tại.
 * Kèm kiểm cột tiền vượt giới hạn INTEGER (migration đổi Float -> INTEGER sẽ
 * hỏng nếu có). Chỉ ĐỌC, không ghi gì.
 *
 * Constraint NOT VALID vẫn chặn mọi dòng ghi mới; nhưng một dòng CŨ đang mang
 * giá trị sai sẽ không sửa được gì khác cho tới khi chính giá trị đó được sửa —
 * nên chạy script này sau khi migrate và sửa tay các dòng nó liệt kê.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

try {
  process.loadEnvFile(".env");
} catch {
  /* dùng biến môi trường sẵn có */
}

const APPLY = process.argv.includes("--apply");
const PREFLIGHT = process.argv.includes("--preflight");
if (APPLY && PREFLIGHT) {
  console.error("❌ --preflight (trước migrate) và --apply (sau migrate) không dùng chung được.");
  process.exit(2);
}
const prisma = new PrismaClient();

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../prisma/migrations"
);

/** Bỏ comment `-- ...` rồi tách câu lệnh theo dấu `;`. */
function statementsOf(sql) {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((st) => st.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Lấy biểu thức trong cặp ngoặc cân bằng bắt đầu tại vị trí `start` (ký tự "("). */
function balancedParen(text, start) {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === "'") inStr = false;
      continue;
    }
    if (ch === "'") inStr = true;
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/**
 * CHECK constraint theo trạng thái cuối cùng của chuỗi migration:
 * Map<tên, { table, expr, migration }>.
 */
function checksFromMigrations(dir = MIGRATIONS_DIR) {
  const checks = new Map();
  const money = new Map(); // "bảng.cột" -> { table, column }
  const folders = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const folder of folders) {
    const file = path.join(dir, folder, "migration.sql");
    if (!fs.existsSync(file)) continue;
    const sql = fs.readFileSync(file, "utf8");
    for (const st of statementsOf(sql)) {
      const drop = /^ALTER TABLE "([^"]+)" DROP CONSTRAINT (?:IF EXISTS )?"([^"]+)"/i.exec(st);
      if (drop) {
        checks.delete(drop[2]);
        continue;
      }
      const add = /^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" CHECK\s*\(/i.exec(st);
      if (add) {
        const expr = balancedParen(st, add[0].length - 1);
        if (expr) checks.set(add[2], { table: add[1], expr, migration: folder });
      }
    }
    // Kiểm tràn INTEGER trước khi đổi kiểu tiền (khối DO $$ ... $$)
    for (const m of sql.matchAll(
      /FROM "([^"]+)" WHERE abs\("([^"]+)"\) > 2147483647/g
    )) {
      money.set(`${m[1]}.${m[2]}`, { table: m[1], column: m[2] });
    }
  }
  return { checks, money: [...money.values()] };
}

async function preflight() {
  const { checks, money } = checksFromMigrations();
  console.log(
    `→ Preflight: ${checks.size} CHECK constraint + ${money.length} cột tiền, đọc từ prisma/migrations (chỉ đọc DB).\n`
  );
  let dirty = 0;
  let failed = 0;
  for (const [name, c] of [...checks.entries()].sort()) {
    try {
      const [{ n }] = await prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM "${c.table}" WHERE NOT ${c.expr}`
      );
      if (n > 0) {
        dirty++;
        const col = name.startsWith(`${c.table}_`) && name.endsWith("_check")
          ? name.slice(c.table.length + 1, -"_check".length)
          : null;
        const sample = col
          ? await prisma.$queryRawUnsafe(
              `SELECT id, "${col}" AS value FROM "${c.table}" WHERE NOT ${c.expr} LIMIT 10`
            )
          : [];
        console.log(`❌ ${name}: ${n} dòng sẽ vi phạm. Ví dụ:`, sample);
      } else {
        console.log(`✅ ${name}: sạch`);
      }
    } catch (e) {
      failed++;
      console.log(`⚠️  ${name}: không kiểm được (${e.message?.split("\n").pop() ?? e})`);
    }
  }
  for (const m of money) {
    try {
      const [{ n }] = await prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM "${m.table}" WHERE abs("${m.column}") > 2147483647`
      );
      if (n > 0) {
        dirty++;
        console.log(`❌ ${m.table}.${m.column}: ${n} dòng vượt giới hạn INTEGER — migration tiền sẽ hỏng.`);
      } else {
        console.log(`✅ ${m.table}.${m.column}: trong giới hạn INTEGER`);
      }
    } catch (e) {
      failed++;
      console.log(`⚠️  ${m.table}.${m.column}: không kiểm được (${e.message?.split("\n").pop() ?? e})`);
    }
  }
  if (dirty || failed) {
    console.log(
      `\n${dirty} mục có dữ liệu sai, ${failed} mục không kiểm được. Sửa dữ liệu trước khi chạy prisma migrate deploy.`
    );
    process.exitCode = 1;
  } else {
    console.log("\n✅ Dữ liệu hiện tại sạch — có thể chạy prisma migrate deploy.");
  }
}

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

(PREFLIGHT ? preflight() : main())
  .catch((e) => {
    console.error("❌", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
