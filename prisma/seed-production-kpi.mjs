/**
 * Cấu hình KPI 6 chỉ tiêu ca sản xuất (KpiConfig), bậc thưởng (BonusConfig),
 * định mức hao hụt và SKU mẫu. Gọi từ prisma/seed.mjs — trước đây là seed.ts
 * nhưng không có script nào chạy nó, nên môi trường mới thiếu hẳn cấu hình.
 */
export async function seedProductionKpi(prisma) {
  console.log("🌱 Seeding GANI FOODY KPI System...");

  // ============ 1. SEED KPI CONFIGS (6 KPI PHÒNG SX) ============
  console.log("\n📊 Seeding KPI Configs...");

  const kpiConfigs = await Promise.all([
    prisma.kpiConfig.upsert({
      where: { code: "PROD_OUTPUT" },
      update: {},
      create: {
        code: "PROD_OUTPUT",
        name: "Sản Lượng Thực Tế",
        department: "PRODUCTION",
        unit: "kg/ca",
        isHigherBetter: true,
        weightPercent: 25,
        dataSource: "IPOS",
        baselineValue: 500,
        targetValue: 500,
        description: "Sản lượng thực tế trong ca (trần 500kg/ca HCM01)",
      },
    }),

    prisma.kpiConfig.upsert({
      where: { code: "PROD_WASTE" },
      update: {},
      create: {
        code: "PROD_WASTE",
        name: "Tỷ Lệ Hao Hụt",
        department: "PRODUCTION",
        unit: "%",
        isHigherBetter: false, // Thấp tốt
        weightPercent: 25,
        dataSource: "MANUAL",
        baselineValue: 4,
        targetValue: 4,
        description:
          "Tỷ lệ hao hụt trung bình (XX_SK: 5%, Burger48: 3%, Burger70: 3%, GaNugget: 5% → TB 4%)",
      },
    }),

    prisma.kpiConfig.upsert({
      where: { code: "PROD_QUALITY" },
      update: {},
      create: {
        code: "PROD_QUALITY",
        name: "Tỷ Lệ Chất Lượng (OK)",
        department: "PRODUCTION",
        unit: "%",
        isHigherBetter: true,
        weightPercent: 20,
        dataSource: "QA_CHECK",
        baselineValue: 95,
        targetValue: 95,
        description:
          "% batch pass QA check (không có lỗi theo tiêu chuẩn HACCP)",
      },
    }),

    prisma.kpiConfig.upsert({
      where: { code: "PROD_SPEC" },
      update: {},
      create: {
        code: "PROD_SPEC",
        name: "Tỷ Lệ Sản Phẩm Đúng Spec",
        department: "PRODUCTION",
        unit: "%",
        isHigherBetter: true,
        weightPercent: 15,
        dataSource: "IPOS",
        baselineValue: 98,
        targetValue: 98,
        description:
          "% sản phẩm đúng spec (trọng lượng, màu sắc, hình dáng)",
      },
    }),

    prisma.kpiConfig.upsert({
      where: { code: "PROD_SAFETY" },
      update: {},
      create: {
        code: "PROD_SAFETY",
        name: "An Toàn Lao Động",
        department: "PRODUCTION",
        unit: "điểm",
        isHigherBetter: true,
        weightPercent: 10,
        dataSource: "SYSTEM_CALC",
        baselineValue: 100,
        targetValue: 100,
        description:
          "Điểm an toàn (0-100 điểm/ca, từ KCS checklist + HSE audit)",
      },
    }),

    prisma.kpiConfig.upsert({
      where: { code: "PROD_DEADLINE" },
      update: {},
      create: {
        code: "PROD_DEADLINE",
        name: "Đúng Deadline Batch",
        department: "PRODUCTION",
        unit: "%",
        isHigherBetter: true,
        weightPercent: 5,
        dataSource: "IPOS",
        baselineValue: 100,
        targetValue: 100,
        description: "% Batch xong đúng giờ (theo IPOS timeline)",
      },
    }),
  ]);

  console.log(`✅ Created ${kpiConfigs.length} KPI Configs`);

  // ============ 2. SEED BONUS CONFIG (4 BẬC THANG THƯỞNG) ============
  console.log("\n💰 Seeding Bonus Config...");

  const bonusConfigs = await Promise.all([
    prisma.bonusConfig.upsert({
      where: { department_achievementMin: { department: "PRODUCTION", achievementMin: 120 } },
      update: {},
      create: {
        department: "PRODUCTION",
        achievementMin: 120,
        achievementMax: 200,
        bonusMultiplier: 1.5,
        baseSalary: 233000,
        description: "Vượt kế hoạch mạnh (≥120%)",
      },
    }),

    prisma.bonusConfig.upsert({
      where: { department_achievementMin: { department: "PRODUCTION", achievementMin: 100 } },
      update: {},
      create: {
        department: "PRODUCTION",
        achievementMin: 100,
        achievementMax: 119.99,
        bonusMultiplier: 1.0,
        baseSalary: 233000,
        description: "Đạt kế hoạch (100-119%)",
      },
    }),

    prisma.bonusConfig.upsert({
      where: { department_achievementMin: { department: "PRODUCTION", achievementMin: 90 } },
      update: {},
      create: {
        department: "PRODUCTION",
        achievementMin: 90,
        achievementMax: 99.99,
        bonusMultiplier: 0.75,
        baseSalary: 233000,
        description: "Còn chút nữa (90-99%)",
      },
    }),

    prisma.bonusConfig.upsert({
      where: { department_achievementMin: { department: "PRODUCTION", achievementMin: 0 } },
      update: {},
      create: {
        department: "PRODUCTION",
        achievementMin: 0,
        achievementMax: 89.99,
        bonusMultiplier: 0,
        baseSalary: 233000,
        description: "Không đạt (<90%)",
      },
    }),
  ]);

  console.log(`✅ Created ${bonusConfigs.length} Bonus Configs`);

  // ============ 3. SEED PRODUCT WASTE STANDARDS (4 SKU) ============
  console.log("\n📦 Seeding Product Waste Standards...");

  const wasteStandards = await Promise.all([
    prisma.productWasteStandard.upsert({
      where: { sku: "Xúc xích xông khói" },
      update: {},
      create: {
        sku: "Xúc xích xông khói",
        wastePercent: 5,
        dataSource: "ESTIMATED",
        description:
          "Định mức hao hụt GANI FOODY (5% - thực tế từ xưởng)",
      },
    }),

    prisma.productWasteStandard.upsert({
      where: { sku: "Burger bò 48g" },
      update: {},
      create: {
        sku: "Burger bò 48g",
        wastePercent: 3,
        dataSource: "ESTIMATED",
        description:
          "Định mức hao hụt GANI FOODY (3% - thực tế từ xưởng)",
      },
    }),

    prisma.productWasteStandard.upsert({
      where: { sku: "Burger bò 70g" },
      update: {},
      create: {
        sku: "Burger bò 70g",
        wastePercent: 3,
        dataSource: "ESTIMATED",
        description:
          "Định mức hao hụt GANI FOODY (3% - thực tế từ xưởng)",
      },
    }),

    prisma.productWasteStandard.upsert({
      where: { sku: "Gà Nugget" },
      update: {},
      create: {
        sku: "Gà Nugget",
        wastePercent: 5,
        dataSource: "ESTIMATED",
        description:
          "Định mức hao hụt GANI FOODY (5% - thực tế từ xưởng)",
      },
    }),
  ]);

  console.log(`✅ Created ${wasteStandards.length} Product Waste Standards`);

  // ============ 4. SEED PRODUCTION SKUS ============
  console.log("\n🏭 Seeding Product SKUs...");

  const skus = await Promise.all([
    prisma.productSku.upsert({
      where: { skuCode: "XX_XONG_KHOI" },
      update: {},
      create: {
        skuCode: "XX_XONG_KHOI",
        skuName: "Xúc xích xông khói",
        targetOutputKg: 500,
        stdMaterialLossRate: 5,
      },
    }),

    prisma.productSku.upsert({
      where: { skuCode: "BURGER_BO_48G" },
      update: {},
      create: {
        skuCode: "BURGER_BO_48G",
        skuName: "Burger bò 48g",
        targetOutputKg: 500,
        stdMaterialLossRate: 3,
      },
    }),

    prisma.productSku.upsert({
      where: { skuCode: "BURGER_BO_70G" },
      update: {},
      create: {
        skuCode: "BURGER_BO_70G",
        skuName: "Burger bò 70g",
        targetOutputKg: 500,
        stdMaterialLossRate: 3,
      },
    }),

    prisma.productSku.upsert({
      where: { skuCode: "GA_NUGGET" },
      update: {},
      create: {
        skuCode: "GA_NUGGET",
        skuName: "Gà Nugget",
        targetOutputKg: 500,
        stdMaterialLossRate: 5,
      },
    }),
  ]);

  console.log(`✅ Created ${skus.length} Product SKUs`);

  console.log("\n✨ ========================================");
  console.log("✨ SEED DATA HOÀN TẤT!");
  console.log("✨ ========================================");
  console.log("\n📊 Summary:");
  console.log(`  • 6 KPI Configs (Phòng SX)`);
  console.log(`  • 4 Bonus Configs (bậc thang thưởng)`);
  console.log(`  • 4 Product Waste Standards (định mức hao hụt)`);
  console.log(`  • 4 Product SKUs (mã sản phẩm)`);
  console.log("\n🎯 Tiếp theo: Xây dựng Page 'Năm Quyết Định' cho Phòng SX");
}
