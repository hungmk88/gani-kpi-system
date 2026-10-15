import { prisma } from "./db";
import { vnParts } from "./vn-time";

/**
 * Sinh mã task dạng TASK-2026-0001 (số chạy theo năm).
 * Dùng transaction đếm để tránh trùng khi 2 người tạo cùng lúc.
 */
export async function nextTaskCode(): Promise<string> {
  const year = vnParts().year;
  const prefix = `TASK-${year}-`;
  const last = await prisma.task.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  const n = last ? parseInt(last.code.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(n).padStart(4, "0")}`;
}

export function periodName(month: number, year: number) {
  return `Tháng ${String(month).padStart(2, "0")}/${year}`;
}

/**
 * Hai người tạo việc cùng lúc có thể cùng đọc ra một số chạy -> lần ghi sau
 * vấp ràng buộc unique của cột code (P2002). Thử lại vài lần với số mới.
 */
export async function retryOnCodeClash<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const clash =
        typeof e === "object" &&
        e !== null &&
        (e as { code?: string }).code === "P2002" &&
        JSON.stringify((e as { meta?: unknown }).meta ?? "").includes("code");
      if (!clash || i >= attempts - 1) throw e;
    }
  }
}
