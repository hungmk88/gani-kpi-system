import { ANTI_GAMING } from "./constants";
import type { ShiftFacts, ShiftMetrics } from "./kpi-engine";

/**
 * BỘ PHÁT HIỆN CHẠY CHỈ TIÊU.
 *
 * Ba luật lấy nguyên từ bản thiết kế. Nguyên tắc xử lý: phát hiện thì **khoá
 * thưởng tạm thời**, KHÔNG trừ điểm và KHÔNG kết tội. Máy đọc số có thể sai —
 * lô thịt đông rã nước nhiều hơn bình thường cũng ra đúng dấu hiệu như người cố
 * tình ép máy. Nên người phải được quyền giải trình, và Ban Giám đốc là người
 * quyết cuối.
 *
 * Hàm thuần tính toán, không đụng database.
 */

export type AuditFinding = {
  behaviorType: string;
  severity: "WARNING" | "CRITICAL";
  auditNote: string;
};

export function runAntiGamingRules(
  f: ShiftFacts,
  m: ShiftMetrics
): AuditFinding[] {
  const findings: AuditFinding[] = [];

  /* --- Luật 1: chạy được sản lượng nhưng phá nguyên liệu --- */
  const overrunLimit =
    f.stdMaterialNormKg * (1 + ANTI_GAMING.MATERIAL_OVERRUN_PERCENT / 100);

  if (
    f.stdMaterialNormKg > 0 &&
    f.targetOutputKg > 0 &&
    f.qcPassedKg >= f.targetOutputKg &&
    f.rawMaterialInputKg > overrunLimit
  ) {
    const overPercent =
      Math.round(
        ((f.rawMaterialInputKg / f.stdMaterialNormKg - 1) * 100) * 10
      ) / 10;
    findings.push({
      behaviorType: "PRODUCTIVITY_VS_MATERIAL_LOSS",
      severity: "CRITICAL",
      auditNote: `Đạt ${m.outputAchievementPercent}% chỉ tiêu sản lượng nhưng nguyên liệu cấp vào ${f.rawMaterialInputKg} kg, vượt định mức ${f.stdMaterialNormKg} kg tới ${overPercent}% (ngưỡng cho phép ${ANTI_GAMING.MATERIAL_OVERRUN_PERCENT}%). Nghi ép máy chạy cho đủ số, đổi lại phá nguyên liệu.`,
    });
  }

  /* --- Luật 2: báo phế bằng 0 nhưng hàng làm lại vọt cao --- */
  const reworkLimit =
    f.qcPassedKg * (ANTI_GAMING.REWORK_SUSPICIOUS_PERCENT / 100);

  if (f.scrapKg === 0 && f.qcPassedKg > 0 && f.reworkKg > reworkLimit) {
    const reworkPercent =
      Math.round((f.reworkKg / f.qcPassedKg) * 1000) / 10;
    findings.push({
      behaviorType: "REWORK_HIDING_SCRAP",
      severity: "WARNING",
      auditNote: `Báo phế phẩm bằng 0 nhưng hàng làm lại ${f.reworkKg} kg, bằng ${reworkPercent}% thành phẩm đạt (ngưỡng ${ANTI_GAMING.REWORK_SUSPICIOUS_PERCENT}%). Cần làm rõ phân loại: hỏng hẳn hay thật sự cứu được.`,
    });
  }

  /* --- Luật 3: lệch cân đối khối lượng --- */
  // Bản thiết kế chỉ có ngưỡng tuyệt đối 5 kg. Thêm ngưỡng tương đối để mẻ nhỏ
  // cũng bị soi: lệch 4 kg trên mẻ 50 kg là 8%, nghiêm trọng hơn nhiều so với
  // lệch 4 kg trên mẻ 500 kg.
  const accounted = f.qcPassedKg + f.reworkKg + f.scrapKg;
  const diff = Math.abs(f.rawOutputKg - accounted);
  const relPercent =
    f.rawOutputKg > 0 ? (diff / f.rawOutputKg) * 100 : 0;

  const overAbs = diff > ANTI_GAMING.MASS_BALANCE_ABS_KG;
  const overRel =
    f.rawOutputKg > 0 && relPercent > ANTI_GAMING.MASS_BALANCE_REL_PERCENT;

  if (overAbs || overRel) {
    findings.push({
      behaviorType: "MASS_BALANCE_MISMATCH",
      severity: "CRITICAL",
      auditNote: `Sản lượng thô khai ${f.rawOutputKg} kg nhưng tổng KCS xác nhận (đạt ${f.qcPassedKg} + làm lại ${f.reworkKg} + phế ${f.scrapKg}) chỉ ${Math.round(accounted * 100) / 100} kg — lệch ${Math.round(diff * 100) / 100} kg (${Math.round(relPercent * 10) / 10}%). Số cân không khớp nhau thì mọi tỷ lệ tính ra đều sai theo.`,
    });
  }

  return findings;
}
