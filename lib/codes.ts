import { prisma } from "./db";

/**
 * Sinh mã task dạng TASK-2026-0001 (số chạy theo năm).
 * Dùng transaction đếm để tránh trùng khi 2 người tạo cùng lúc.
 */
export async function nextTaskCode(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `TASK-${year}-`;
  const last = await prisma.task.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  const n = last ? parseInt(last.code.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(n).padStart(4, "0")}`;
}

export async function nextProjectCode(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PRJ-${year}-`;
  const last = await prisma.project.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  const n = last ? parseInt(last.code.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(n).padStart(3, "0")}`;
}

export function periodName(month: number, year: number) {
  return `Tháng ${String(month).padStart(2, "0")}/${year}`;
}
