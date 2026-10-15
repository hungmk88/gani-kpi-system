import Link from "next/link";
import { Bell } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge, EmptyState, PageHeader, ShowingCount } from "@/components/ui";
import { fmtDateTime, fmtNum } from "@/lib/format";
import MarkAllRead from "./mark-all-read";
import TelegramLink from "./telegram-link";

export const dynamic = "force-dynamic";

/** Trang nạp chừng này thông báo gần nhất */
const LIMIT = 100;

export default async function NotificationsPage() {
  const user = (await requireSession())!;

  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: { telegramChatId: true },
  });

  // Đếm bằng count(): trước đây "chưa đọc" chỉ tính trong 100 thông báo đã
  // nạp, ai có hơn 100 thì con số bị thấp đi mà không biết.
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: LIMIT,
    }),
    prisma.notification.count({ where: { userId: user.id } }),
    prisma.notification.count({ where: { userId: user.id, isRead: false } }),
  ]);

  return (
    <>
      <PageHeader
        title="Thông báo"
        subtitle={
          total === 0
            ? "Chưa có thông báo nào"
            : `${fmtNum(unread)} chưa đọc trên tổng ${fmtNum(total)} thông báo`
        }
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
              // Đã đọc: đổi màu chữ (không dùng opacity — giảm tương phản cả
              // huy hiệu). Chưa đọc: vạch xanh thương hiệu bên trái, tiêu đề đậm.
              <div
                className={`card p-4 transition ${
                  n.isRead ? "" : "border-l-[3px] border-l-brand-600"
                } ${n.linkUrl ? "hover:shadow-md" : ""}`}
              >
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span
                    className={
                      n.isRead
                        ? "font-medium text-ink-600"
                        : "font-semibold text-ink-900"
                    }
                  >
                    {n.title}
                  </span>
                  {n.level === "CRITICAL" && <Badge tone="red">Khẩn cấp</Badge>}
                  {n.level === "WARNING" && <Badge tone="amber">Cảnh báo</Badge>}
                  {n.channel === "TELEGRAM" && (
                    <Badge tone={n.sentOk ? "slate" : "red"}>
                      {n.sentOk ? "Đã gửi Telegram" : "Telegram lỗi"}
                    </Badge>
                  )}
                  {!n.isRead && <Badge tone="brand">Mới</Badge>}
                </div>
                <div
                  className={`text-sm ${n.isRead ? "text-ink-500" : "text-ink-700"}`}
                >
                  {n.body}
                </div>
                <div className="mt-1.5 text-xs text-ink-500">
                  {fmtDateTime(n.createdAt)}
                  {/* Lỗi kỹ thuật thô chỉ để trong title (rê chuột xem) */}
                  {n.sendError && (
                    <span className="ml-2 text-red-700" title={n.sendError}>
                      Gửi Telegram lỗi
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
          <ShowingCount
            shown={items.length}
            total={total}
            hint="các thông báo gần nhất"
          />
        </div>
      )}
    </>
  );
}
