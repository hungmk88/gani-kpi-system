import { prisma } from "@/lib/db";
import { notify } from "@/lib/notify";
import { BusinessError } from "@/lib/rbac";
import { ERR } from "@/lib/constants";
import { normalizeEmployeeCode } from "@/lib/employee-code";

/** Báo động cho mọi tài khoản Ban Giám đốc đang hoạt động (thay đổi quyền nhạy cảm). */
export async function alertCeos(title: string, body: string) {
  const ceos = await prisma.user.findMany({
    where: { role: "CEO", isActive: true },
    select: { id: true },
  });
  for (const c of ceos) {
    await notify({ userId: c.id, title, body, level: "CRITICAL" });
  }
}

/**
 * Chuẩn hoá mã NV gửi lên và chắc chắn chưa ai dùng (trừ chính tài khoản
 * đang sửa). Trả về mã đã chuẩn hoá, null = không có mã. Ràng buộc unique
 * trong DB vẫn là chốt cuối cho trường hợp hai người lưu cùng lúc.
 */
export async function resolveEmployeeCode(
  raw: string | null | undefined,
  excludeUserId?: string
): Promise<string | null> {
  const norm = normalizeEmployeeCode(raw);
  if (!norm.ok) throw new BusinessError(ERR.VALIDATION_FAILED, norm.error, 400);
  if (!norm.value) return null;
  const owner = await prisma.user.findFirst({
    where: {
      employeeCode: norm.value,
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
    select: { fullName: true },
  });
  if (owner) {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      `Mã NV ${norm.value} đã thuộc về ${owner.fullName}.`,
      409
    );
  }
  return norm.value;
}

/** Lỗi unique của Prisma có phải do cột employeeCode không (hai người lưu cùng lúc). */
export function isEmployeeCodeConflict(e: unknown) {
  const err = e as { code?: string; meta?: { target?: unknown } };
  return err?.code === "P2002" && JSON.stringify(err.meta?.target ?? "").includes("employeeCode");
}
