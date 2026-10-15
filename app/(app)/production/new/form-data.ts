import { prisma } from "@/lib/db";
import { canEnterDraft } from "@/lib/services/production-service";

/**
 * Dữ liệu cho form khai ca — dùng chung cho khai mới và sửa ca bị KCS trả về.
 */
export async function loadDraftFormData() {
  const [skus, staff] = await Promise.all([
    prisma.productSku.findMany({
      where: { isActive: true },
      orderBy: { skuCode: "asc" },
    }),
    // Ai làm ca: người có vai trò trong xưởng, hoặc nhân sự phòng Sản xuất
    prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { productionRole: { not: null } },
          { department: { code: "PROD" } },
        ],
      },
      include: { department: true },
      orderBy: { fullName: "asc" },
    }),
  ]);

  return {
    skus: skus.map((s) => ({
      id: s.id,
      skuCode: s.skuCode,
      skuName: s.skuName,
      targetOutputKg: s.targetOutputKg,
      stdMaterialLossRate: s.stdMaterialLossRate,
    })),
    staff: staff.map((u) => ({
      id: u.id,
      name: u.fullName,
      role: u.productionRole,
      jobTitle: u.jobTitle ?? "",
    })),
  };
}

/** Ai được khai ca — cùng một luật với máy chủ (canEnterDraft). */
export const canDraftShift = canEnterDraft;
