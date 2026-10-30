import { prisma } from "./db";
import { vnParts } from "./vn-time";

/** Ghép mã task: tối thiểu 4 chữ số, quá 9.999 thì cứ dài ra (TASK-2026-10000). */
export function formatTaskCode(prefix: string, n: number) {
  return `${prefix}${String(n).padStart(4, "0")}`;
}

/**
 * Sinh mã task dạng TASK-2026-0001 (số chạy theo năm).
 *
 * Lấy MAX theo GIÁ TRỊ SỐ của phần đuôi, không theo thứ tự chữ: so chữ thì
 * "TASK-2026-9999" > "TASK-2026-10000" (ký tự '9' > '1'), nên từ việc thứ
 * 10.000 trong năm mã sinh ra cứ lặp lại 10000 và vấp unique mãi. Query
 * tham số hoá; chỉ tính đuôi toàn chữ số.
 * Hai người tạo cùng lúc vẫn có thể ra cùng số -> retryOnCodeClash bên dưới.
 */
export async function nextTaskCode(): Promise<string> {
  const year = vnParts().year;
  const prefix = `TASK-${year}-`;
  const rows = await prisma.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(CAST(substr("code", ${prefix.length + 1}::int) AS BIGINT))::int AS "max"
    FROM "tasks"
    WHERE left("code", ${prefix.length}::int) = ${prefix}::text
      AND substr("code", ${prefix.length + 1}::int) ~ '^[0-9]{1,9}$'
  `;
  const max = rows[0]?.max ?? 0;
  return formatTaskCode(prefix, Number(max) + 1);
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
