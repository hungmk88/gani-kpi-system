-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_product_skus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skuCode" TEXT NOT NULL,
    "skuName" TEXT NOT NULL,
    "targetOutputKg" REAL NOT NULL DEFAULT 500,
    "stdMaterialLossRate" REAL NOT NULL DEFAULT 8,
    "stdKgPerLaborHour" REAL NOT NULL DEFAULT 0,
    "unitPriceVnd" REAL NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_product_skus" ("id", "skuCode", "skuName", "targetOutputKg", "stdMaterialLossRate", "isActive", "createdAt")
SELECT "id", "code", "name", "targetOutputPerShift", "stdWastePercent" * 100, "isActive", "createdAt" FROM "product_skus";
DROP TABLE "product_skus";
ALTER TABLE "new_product_skus" RENAME TO "product_skus";
CREATE UNIQUE INDEX "product_skus_skuCode_key" ON "product_skus"("skuCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
