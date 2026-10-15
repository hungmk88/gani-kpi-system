import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkConstraintName, DB_CHECK_CONSTRAINTS } from "@/lib/db-constraints";
import { computeQualityLoss } from "@/lib/production/kpi-engine";

/**
 * Trạng thái CUỐI của mỗi CHECK constraint sau toàn bộ chuỗi migration: đọc mọi
 * prisma/migrations/<thư mục>/migration.sql theo thứ tự tên (= thứ tự chạy), dòng
 * `ADD CONSTRAINT "<tên>"` xuất hiện sau cùng thắng (DROP mà không ADD lại = đã bỏ). Migration mới DROP/ADD lại
 * constraint (thêm giá trị) thì test tự so với bản mới, không cần sửa test.
 */
function latestConstraintLines(): Map<string, string> {
  const dir = path.resolve(__dirname, "../prisma/migrations");
  const latest = new Map<string, string>();
  const folders = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const folder of folders) {
    const file = path.join(dir, folder, "migration.sql");
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.trimStart().startsWith("--")) continue;
      // DROP rồi không ADD lại = constraint đã bị bỏ -> test phải báo thiếu
      const drop = /DROP CONSTRAINT (?:IF EXISTS )?"([^"]+)"/.exec(line);
      if (drop) latest.delete(drop[1]);
      const add = /ADD CONSTRAINT "([^"]+)"/.exec(line);
      if (add) latest.set(add[1], line);
    }
  }
  return latest;
}

const constraintLines = latestConstraintLines();

describe("CHECK constraint khớp hằng số trong code", () => {
  for (const c of DB_CHECK_CONSTRAINTS) {
    it(`${c.table}.${c.column}`, () => {
      const name = checkConstraintName(c.table, c.column);
      const line = constraintLines.get(name);
      expect(line, `migration thiếu constraint ${name}`).toBeTruthy();
      const inList = /IN \(([^)]*)\)/.exec(line!)![1];
      const values = [...inList.matchAll(/'([^']+)'/g)].map((m) => m[1]);
      expect(values.sort()).toEqual([...c.values].sort());
      expect(line!.includes("IS NULL")).toBe(c.nullable);
    });
  }
});

describe("tiền là số nguyên VND", () => {
  it("tổn thất quy ra tiền làm tròn đến đồng", () => {
    const r = computeQualityLoss(
      { scrapKg: 1.333, reworkKg: 0, rawMaterialInputKg: 100, stdMaterialNormKg: 100 },
      12_345
    );
    expect(Number.isInteger(r.qualityLossVnd)).toBe(true);
    expect(r.qualityLossVnd).toBe(Math.round(1.333 * 12_345));
  });
});
