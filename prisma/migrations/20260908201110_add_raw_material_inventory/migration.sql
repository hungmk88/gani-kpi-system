-- AlterTable
ALTER TABLE "product_skus" ADD COLUMN     "rawMaterialId" TEXT;

-- CreateTable
CREATE TABLE "raw_materials" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'kg',
    "currentStockKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "raw_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_material_transactions" (
    "id" TEXT NOT NULL,
    "rawMaterialId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantityKg" DOUBLE PRECISION NOT NULL,
    "balanceAfterKg" DOUBLE PRECISION NOT NULL,
    "shiftLogId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_material_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "raw_materials_code_key" ON "raw_materials"("code");

-- CreateIndex
CREATE INDEX "raw_material_transactions_rawMaterialId_createdAt_idx" ON "raw_material_transactions"("rawMaterialId", "createdAt");

-- AddForeignKey
ALTER TABLE "product_skus" ADD CONSTRAINT "product_skus_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "raw_materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_material_transactions" ADD CONSTRAINT "raw_material_transactions_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_material_transactions" ADD CONSTRAINT "raw_material_transactions_shiftLogId_fkey" FOREIGN KEY ("shiftLogId") REFERENCES "production_shift_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_material_transactions" ADD CONSTRAINT "raw_material_transactions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
