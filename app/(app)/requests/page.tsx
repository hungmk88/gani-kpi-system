import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleCheck, Plus } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge, EmptyState, PageHeader, PriorityBadge, formatDateTime } from "@/components/ui";
import RequestActions from "./request-actions";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  const user = (await requireSession())!;
  if (user.role !== "MANAGER" && user.role !== "CEO") redirect("/dashboard");

  const requests = await prisma.crossDeptRequest.findMany({
    where:
      user.role === "CEO"
        ? {}
        : {
            OR: [
              { requesterId: user.id },
              { targetDeptId: user.departmentId ?? "__none__" },
            ],
          },
    include: {
      requester: { include: { department: true } },
      targetDept: true,
      approver: true,
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  const inbox = requests.filter(
    (r) =>
      r.status === "PENDING" &&
      (user.role === "CEO" || r.targetDeptId === user.departmentId)
  );
  const outbox = requests.filter((r) => r.requesterId === user.id);
  const history = requests.filter((r) => r.status !== "PENDING");

  const myTeam = await prisma.user.findMany({
    where: {
      departmentId: user.departmentId ?? "__none__",
      isActive: true,
      role: { not: "ADMIN" },
    },
    orderBy: { fullName: "asc" },
  });

  return (
    <>
      <PageHeader
        title="Yêu cầu liên phòng ban"
        subtitle="Vì hệ thống cấm giao việc vượt cấp, mọi việc nhờ phòng khác đều đi qua đây để trưởng phòng bên đó tiếp nhận."
        actions={
          // Mở thẳng tab "Nhờ phòng ban khác" — không để rơi vào tab giao việc trong phòng
          <Link href="/tasks/new?mode=request" className="btn-primary">
            <Plus size={16} aria-hidden /> Gửi yêu cầu mới
          </Link>
        }
      />

      <section className="mb-8">
        <h2 className="section-title mb-3">
          Đang chờ bạn xử lý ({inbox.length})
        </h2>
        {inbox.length === 0 ? (
          <EmptyState
            icon={<CircleCheck size={32} strokeWidth={1.75} />}
            title="Không có yêu cầu nào chờ bạn"
            hint="Khi phòng ban khác cần phòng bạn làm việc gì, yêu cầu sẽ hiện ở đây."
          />
        ) : (
          <div className="space-y-3">
            {inbox.map((r) => (
              <div key={r.id} className="card p-4">
                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-ink-900">{r.title}</div>
                    <div className="mt-1 text-xs text-ink-500">
                      Từ {r.requester.fullName} · Phòng{" "}
                      {r.requester.department?.name ?? "—"} · Gửi lúc{" "}
                      {formatDateTime(r.createdAt)}
                    </div>
                  </div>
                  <PriorityBadge priority={r.priority} />
                </div>
                {r.description && (
                  <p className="mb-3 text-sm whitespace-pre-wrap text-ink-600">
                    {r.description}
                  </p>
                )}
                <div className="mb-3 text-sm text-ink-600">
                  Hạn mong muốn:{" "}
                  <b className="text-ink-800">{formatDateTime(r.dueDate)}</b>
                </div>
                <RequestActions
                  requestId={r.id}
                  team={myTeam.map((u) => ({
                    id: u.id,
                    name: `${u.fullName}${u.jobTitle ? ` — ${u.jobTitle}` : ""}`,
                  }))}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="section-title mb-3">Bạn đã gửi đi ({outbox.length})</h2>
        {outbox.length === 0 ? (
          <div className="card p-4 text-sm text-ink-500">
            Bạn chưa gửi yêu cầu nào cho phòng ban khác.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="tbl tbl-stack">
              <thead>
                <tr>
                  <th>Nội dung</th>
                  <th>Gửi tới</th>
                  <th>Hạn</th>
                  <th>Ưu tiên</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {outbox.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium text-ink-800">
                      {r.title}
                      {r.rejectReason && (
                        <div className="mt-1 text-xs text-red-700">
                          Lý do từ chối: {r.rejectReason}
                        </div>
                      )}
                    </td>
                    <td data-label="Gửi tới" className="text-ink-600">{r.targetDept.name}</td>
                    <td data-label="Hạn" className="text-ink-600">{formatDateTime(r.dueDate)}</td>
                    <td data-label="Ưu tiên">
                      <PriorityBadge priority={r.priority} />
                    </td>
                    <td data-label="Trạng thái">
                      <StatusBadge status={r.status} />
                      {r.createdTaskId && (
                        <Link
                          href={`/tasks/${r.createdTaskId}`}
                          className="ml-2 text-xs text-brand-600 hover:underline"
                        >
                          Xem việc →
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {history.length > 0 && (
        <section>
          <h2 className="section-title mb-3">Lịch sử đã xử lý</h2>
          <div className="table-wrap">
            <table className="tbl tbl-stack">
              <thead>
                <tr>
                  <th>Nội dung</th>
                  <th>Người gửi</th>
                  <th>Phòng nhận</th>
                  <th>Người xử lý</th>
                  <th>Kết quả</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id}>
                    <td className="text-ink-800">{r.title}</td>
                    <td data-label="Người gửi" className="text-ink-600">{r.requester.fullName}</td>
                    <td data-label="Phòng nhận" className="text-ink-600">{r.targetDept.name}</td>
                    <td data-label="Người xử lý" className="text-ink-600">
                      {r.approver?.fullName ?? "—"}
                    </td>
                    <td data-label="Kết quả">
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ACCEPTED") return <Badge tone="green">Đã tiếp nhận</Badge>;
  if (status === "REJECTED") return <Badge tone="red">Đã từ chối</Badge>;
  return <Badge tone="amber">Đang chờ</Badge>;
}
