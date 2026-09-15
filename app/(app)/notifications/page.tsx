import Link from "next/link";
import { Bell } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge, EmptyState, PageHeader, formatDateTime } from "@/components/ui";
import MarkAllRead from "./mark-all-read";
import TelegramLink from "./telegram-link";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = (await requireSession())!;

  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: { telegramChatId: true },
  });

  const items = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const unread = items.filter((n) => !n.isRead).length;

  return (
    <>
      <PageHeader
        title="Thông báo"
        subtitle={`${unread} chưa đọc trên tổng ${items.length} thông báo gần đây`}
        actions={unread > 0 ? <MarkAllRead /> : undefined}
      />

      <TelegramLink linked={!!me?.telegramChatId} />

      {items.length === 0 ? (
        <EmptyState
          icon={<Bell size={32} strokeWidth={1.75} />}
          title="Chưa có thông báo nào"
          hint="Khi có việc giao cho bạn, KPI được duyệt hoặc cảnh báo trễ hạn, thông báo sẽ hiện ở đây."
        />
      ) : (
        <div className="space-y-2">
          {items.map((n) => {
            const inner = (
              <div
                className={`card p-4 transition ${
                  n.isRead ? "opacity-70" : "border-brand-200 bg-brand-50/30"
                } ${n.linkUrl ? "hover:shadow-md" : ""}`}
              >
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink-900">{n.title}</span>
                  {n.level === "CRITICAL" && <Badge tone="red">Khẩn cấp</Badge>}
                  {n.level === "WARNING" && <Badge tone="amber">Cảnh báo</Badge>}
                  {n.channel === "TELEGRAM" && (
                    <Badge tone="sky">
                      {n.sentOk ? "Đã gửi Telegram" : "Telegram lỗi"}
                    </Badge>
                  )}
                  {!n.isRead && <Badge tone="brand">Mới</Badge>}
                </div>
                <div className="text-sm text-ink-600">{n.body}</div>
                <div className="mt-1.5 text-xs text-ink-400">
                  {formatDateTime(n.createdAt)}
                  {n.sendError && (
                    <span className="ml-2 text-red-500">
                      Lỗi gửi: {n.sendError.slice(0, 120)}
                    </span>
                  )}
                </div>
              </div>
            );
            return n.linkUrl ? (
              <Link key={n.id} href={n.linkUrl}>
                {inner}
              </Link>
            ) : (
              <div key={n.id}>{inner}</div>
            );
          })}
        </div>
      )}
    </>
  );
}
