import { prisma } from "./db";

/**
 * Khoá chống chạy chồng cho việc nền (cron-job.org + bấm tay cùng lúc...).
 *
 * Không dùng pg_advisory_lock vì app đi qua pgbouncer chế độ transaction:
 * lệnh khoá và lệnh mở có thể rơi vào hai connection khác nhau. Thay bằng một
 * dòng trong bảng job_locks có hạn dùng — tiến trình chết giữa chừng thì khoá
 * tự hết hạn, không kẹt vĩnh viễn.
 */
export type JobLockHandle = { name: string; token: Date };

/**
 * Lấy khoá. Trả về handle (giữ để mở khoá) hoặc null nếu lượt khác đang giữ.
 *
 * Token sở hữu = chính giá trị lockedUntil vừa ghi (cộng thêm vài trăm ms ngẫu
 * nhiên để hai lượt lấy cùng một mili-giây không trùng token). Không cần cột
 * mới: ai còn đúng lockedUntil đó thì là chủ khoá.
 */
export async function acquireJobLock(
  name: string,
  ttlSeconds: number
): Promise<JobLockHandle | null> {
  const now = new Date();
  const until = new Date(now.getTime() + ttlSeconds * 1000 + Math.floor(Math.random() * 1000));
  const taken = await prisma.jobLock.updateMany({
    where: { name, lockedUntil: { lt: now } },
    data: { lockedUntil: until },
  });
  if (taken.count === 1) return { name, token: until };
  try {
    await prisma.jobLock.create({ data: { name, lockedUntil: until } });
    return { name, token: until };
  } catch (e) {
    // Dòng đã tồn tại và còn hạn -> có lượt khác đang chạy. Lỗi khác (mất kết
    // nối, thiếu bảng...) phải nổi lên, không được giả làm "đang bận".
    if ((e as { code?: string }).code === "P2002") return null;
    throw e;
  }
}

/**
 * Mở khoá CHỈ KHI còn là chủ. Lượt chạy quá TTL thì khoá đã hết hạn và có thể
 * đã bị lượt sau lấy — mở khoá vô điều kiện lúc đó sẽ thả luôn khoá của lượt
 * sau, để lượt thứ ba chạy chồng.
 */
export async function releaseJobLock(handle: JobLockHandle) {
  await prisma.jobLock
    .updateMany({
      where: { name: handle.name, lockedUntil: handle.token },
      data: { lockedUntil: new Date(0) },
    })
    .catch(() => undefined);
}
