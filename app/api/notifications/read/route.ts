import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";

export async function POST() {
  return handle(async () => {
    const user = await requireUser();
    const res = await prisma.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true },
    });
    return ok({ updated: res.count });
  });
}
