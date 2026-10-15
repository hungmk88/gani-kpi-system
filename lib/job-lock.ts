import { prisma } from "./db";

/**
 * Khoá chống chạy chồng cho việc nền (cron-job.org + bấm tay cùng lúc...).
 *
 * Không dùng pg_advisory_lock vì app đi qua pgbouncer chế độ transaction:
 * lệnh khoá và lệnh mở có thể rơi vào hai connection khác nhau. Thay bằng một
 * dòng trong bảng job_locks có hạn dùng — tiến trình chết giữa chừng thì khoá
 * tự hết hạn, không kẹt vĩnh viễn.
 */
export async function acquireJobLock(name: string, ttlSeconds: number) {
  const until = new Date(Date.now() + ttlSeconds * 1000);
  const now = new Date();
  const taken = await prisma.jobLock.updateMany({
    where: { name, lockedUntil: { lt: now } },
    data: { lockedUntil: until },
  });
  if (taken.count === 1) return true;
  try {
    await prisma.jobLock.create({ data: { name, lockedUntil: until } });
    return true;
  } catch {
    // Dòng đã tồn tại và còn hạn -> có lượt khác đang chạy
    return false;
  }
}

export async function releaseJobLock(name: string) {
  await prisma.jobLock
    .update({ where: { name }, data: { lockedUntil: new Date(0) } })
    .catch(() => undefined);
}
