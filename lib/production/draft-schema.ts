import { z } from "zod";
import { PRODUCTION_STAGES, SHIFT_TYPES } from "./constants";

/**
 * Khuôn dữ liệu khai ca (bước 1) — dùng chung cho khai mới (POST
 * /api/production/shifts) và sửa lại ca bị KCS trả về (PUT
 * /api/production/shifts/[id]). Để ở đây vì file route của Next không được
 * export thứ gì ngoài các hàm GET/POST/…
 */

// Trần an toàn cho mọi số kg nhập tay: một ca thực tế không tới 100 tấn. Số
// vô lý (gõ thừa chữ số, Infinity) làm tràn cột tiền Int khi tính tổn thất.
export const MAX_KG = 100_000;
export const kgField = (label: string) =>
  z
    .number({ invalid_type_error: `${label} phải là số.` })
    .finite(`${label} không hợp lệ.`)
    .min(0, `${label} không được âm.`)
    .max(MAX_KG, `${label} vượt trần ${MAX_KG.toLocaleString("vi-VN")} kg.`);
const hours = (max: number) => z.number().finite().min(0).max(max);

export const shiftDraftSchema = z.object({
  // Ngày ca là NGÀY: nhận "YYYY-MM-DD", vẫn nhận ISO đầy đủ cho client cũ.
  shiftDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày ca không hợp lệ.")
    .or(z.string().datetime("Ngày ca không hợp lệ.")),
  shiftType: z.enum(SHIFT_TYPES),
  skuId: z.string().min(1, "Chưa chọn mã sản phẩm."),
  rawOutputKg: kgField("Sản lượng thô"),
  totalLaborHours: hours(100_000),
  downtimeHours: hours(100_000).default(0),
  rawMaterialInputKg: kgField("Nguyên liệu cấp vào"),
  draftNote: z.string().max(2000).optional(),
  participants: z
    .array(
      z.object({
        userId: z.string().min(1),
        stage: z.enum(PRODUCTION_STAGES),
        hoursWorked: hours(24),
        scheduledHours: hours(24).default(0),
      })
    )
    .min(1, "Phải khai ít nhất một người làm ca này."),
});

export type ShiftDraftBody = z.infer<typeof shiftDraftSchema>;
