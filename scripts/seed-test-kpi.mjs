import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding test data...");

  // 1. Create test user
  const passwordHash = await bcrypt.hash("test123", 10);
  const user = await prisma.user.upsert({
    where: { email: "test-ceo@example.com" },
    update: {},
    create: {
      email: "test-ceo@example.com",
      passwordHash,
      fullName: "Test CEO",
      role: "CEO",
      isActive: true,
    },
  });
  console.log("✅ User:", user.id);

  // 2. Create SKU
  const sku = await prisma.productSku.upsert({
    where: { code: "TEST-SKU" },
    update: {},
    create: {
      code: "TEST-SKU",
      name: "Test Product",
      targetOutputPerShift: 500,
      stdWastePercent: 0.07,
      isActive: true,
    },
  });
  console.log("✅ SKU:", sku.id);

  // 3. Create Period
  const now = new Date();
  const period = await prisma.kpiPeriod.upsert({
    where: {
      month_year: {
        month: now.getMonth() + 1,
        year: now.getFullYear(),
      },
    },
    update: {},
    create: {
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      name: `Test Period ${now.getMonth() + 1}/${now.getFullYear()}`,
      selfReviewDeadline: new Date(),
      managerReviewDeadline: new Date(),
      ceoApprovalDeadline: new Date(),
    },
  });
  console.log("✅ Period:", period.id);

  // 4. Create Period Target
  const periodTarget = await prisma.kpiPeriodTarget.upsert({
    where: {
      periodId_department: {
        periodId: period.id,
        department: "PRODUCTION",
      },
    },
    update: {},
    create: {
      periodId: period.id,
      department: "PRODUCTION",
      output_target: 500,
      waste_target: 4,
      quality_target: 95,
      spec_target: 98,
      safety_target: 100,
      deadline_target: 100,
      createdById: user.id,
      status: "APPROVED",
    },
  });
  console.log("✅ Period Target:", periodTarget.id);

  // 5. Create Bonus Configs
  await prisma.bonusConfig.upsert({
    where: {
      department_achievementMin: {
        department: "PRODUCTION",
        achievementMin: 120,
      },
    },
    update: {},
    create: {
      department: "PRODUCTION",
      achievementMin: 120,
      achievementMax: 150,
      bonusMultiplier: 1.5,
      baseSalary: 233000,
    },
  });

  await prisma.bonusConfig.upsert({
    where: {
      department_achievementMin: {
        department: "PRODUCTION",
        achievementMin: 100,
      },
    },
    update: {},
    create: {
      department: "PRODUCTION",
      achievementMin: 100,
      achievementMax: 119.99,
      bonusMultiplier: 1.0,
      baseSalary: 233000,
    },
  });

  await prisma.bonusConfig.upsert({
    where: {
      department_achievementMin: {
        department: "PRODUCTION",
        achievementMin: 90,
      },
    },
    update: {},
    create: {
      department: "PRODUCTION",
      achievementMin: 90,
      achievementMax: 99.99,
      bonusMultiplier: 0.75,
      baseSalary: 233000,
    },
  });
  console.log("✅ Bonus Configs");

  // 6. Create Shift
  const shift = await prisma.productionShiftLog.create({
    data: {
      skuId: sku.id,
      shiftDate: new Date(),
      shiftType: "MORNING",
      status: "LOCKED",
      createdById: user.id,
      rawOutputKg: 480,
      totalLaborHours: 8,
      rawMaterialInputKg: 510,
      qcPassedKg: 470,
      reworkKg: 5,
      scrapKg: 5,
      haccpViolationCount: 0,
      qcOfficerId: user.id,
      qcApprovedAt: new Date(),
      lockedById: user.id,
      lockedAt: new Date(),
    },
  });
  console.log("✅ Shift:", shift.id);

  console.log("\n" + "=".repeat(60));
  console.log("🎯 TEST DATA READY!");
  console.log("=".repeat(60));
  console.log(`Period Target ID: ${periodTarget.id}`);
  console.log(`Shift Log ID:     ${shift.id}`);
  console.log("");
  console.log("📝 Test API (need auth token first)");
  console.log(`curl -X POST http://localhost:3001/api/kpi/calculate \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -d '{`);
  console.log(`    "shiftLogId": "${shift.id}",`);
  console.log(`    "periodTargetId": "${periodTarget.id}",`);
  console.log(`    "kpiResults": {`);
  console.log(`      "output_actual": 480,`);
  console.log(`      "waste_actual": 3.5,`);
  console.log(`      "quality_actual": 98,`);
  console.log(`      "spec_actual": 97,`);
  console.log(`      "safety_actual": 95,`);
  console.log(`      "deadline_actual": 100`);
  console.log(`    }`);
  console.log(`  }'`);
  console.log("=".repeat(60));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
