import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkConstraintName, DB_CHECK_CONSTRAINTS } from "@/lib/db-constraints";
import { computeQualityLoss } from "@/lib/production/kpi-engine";

const migration = readFileSync(
  path.resolve(__dirname, "../prisma/migrations/20261016090000_money_int_and_checks/migration.sql"),
  "utf8"
);

describe("CHECK constraint khớp hằng số trong code", () => {
  for (const c of DB_CHECK_CONSTRAINTS) {
    it(`${c.table}.${c.column}`, () => {
      const name = checkConstraintName(c.table, c.column);
      const line = migration
        .split("\n")
        .find((l) => l.includes(`ADD CONSTRAINT "${name}"`));
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
