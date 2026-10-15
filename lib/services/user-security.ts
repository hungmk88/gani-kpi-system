import { prisma } from "@/lib/db";
import { notify } from "@/lib/notify";

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
