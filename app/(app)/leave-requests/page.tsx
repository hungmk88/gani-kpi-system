import { Download, CircleCheck } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge, EmptyState, PageHeader, formatDateTime } from "@/components/ui";
import { getAnnualLeaveQuota, leaveReportScope } from "@/lib/services/leave-service";
import { formatVnDate, vnParts } from "@/lib/vn-time";
import LeaveRequestForm from "./leave-request-form";
import LeaveRequestActions from "./leave-request-actions";

export const dynamic = "force-dynamic";

export default async function LeaveRequestsPage() {
  const user = (await requireSession())!;
  const exportScope = await leaveReportScope(user);
  const quota = await getAnnualLeaveQuota(user.id, vnParts(new Date()).year);

  const where =
    user.role === "CEO" || user.role === "ADMIN"
      ? {}
      : user.role === "MANAGER"
        ? {
            OR: [
              { employeeId: user.id },
              {
                departmentId: user.departmentId ?? "__none__",
                employee: { role: { not: "MANAGER" as const } },
              },
            ],
          }
        : { employeeId: user.id };

  const requests = await prisma.leaveRequest.findMany({
    where,
    include: {
      employee: {
        select: {
          id: true,
          fullName: true,
          role: true,
          department: { select: { name: true } },
        },
      },
      reviewedBy: { select: { id: true, fullName: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  // Đúng người phải duyệt — khớp luật ở app/api/leave-requests/[id]/route.ts:
  // Trưởng phòng duyệt nhân viên phòng mình; BGĐ duyệt Trưởng phòng/Admin.
  const inbox = requests.filter((r) => {
    if (r.status !== "PENDING") return false;
    if (user.role === "MANAGER") {
      return (
        r.departmentId === user.departmentId && r.employee.role !== "MANAGER"
      );
    }
    if (user.role === "CEO") {
      return r.employee.role === "MANAGER" || r.employee.role === "ADMIN";
    }
    return false;
  });

  // Riêng BGĐ: xem TOÀN BỘ đơn đang chờ trong công ty, kể cả đơn không cần
  // chính CEO duyệt — để nắm tình hình chung, không chỉ phần việc của mình.
  const allPending =
    user.role === "CEO"
      ? requests.filter((r) => r.status === "PENDING" && !inbox.includes(r))
      : [];

  const mine = requests.filter((r) => r.employeeId === user.id);
  const history = requests.filter(
    (r) => r.status !== "PENDING" && r.employeeId !== user.id
  );

  return (
    <>
      <PageHeader
        title="Nghỉ phép"
        subtitle="Phải gửi trước giờ bắt đầu nghỉ ít nhất 24 tiếng. Gửi trễ hơn vẫn gửi được nhưng hệ thống gắn nhãn khẩn cấp để người duyệt biết."
        actions={
          exportScope ? (
            <a href="/api/leave-requests/export" className="btn-ghost btn-sm inline-flex items-center gap-1.5">
              <Download size={14} strokeWidth={2} /> Tải tổng hợp tháng trước —{" "}
              {exportScope === "ALL" ? "toàn công ty" : "phòng của bạn"} (Excel)
            </a>
          ) : undefined
        }
      />

      {user.role !== "CEO" && (
        <section className="mb-8">
          <h2 className="section-title mb-3">Gửi đơn mới</h2>
          <LeaveRequestForm />
        </section>
      )}

      {(user.role === "MANAGER" || user.role === "CEO") && (
        <section className="mb-8">
          <h2 className="section-title mb-3">
            Đang chờ bạn duyệt ({inbox.length})
          </h2>
          {inbox.length === 0 ? (
            <EmptyState
              icon={<CircleCheck size={32} strokeWidth={1.75} />}
              title="Không có đơn nào chờ bạn"
              hint="Khi nhân sự trong tầm quản lý của bạn xin nghỉ, đơn sẽ hiện ở đây."
            />
          ) : (
            <div className="space-y-3">
              {inbox.map((r) => (
                <LeaveRequestCard key={r.id} r={r} actionable />
              ))}
            </div>
          )}
        </section>
      )}

      {allPending.length > 0 && (
        <section className="mb-8">
          <h2 className="section-title mb-3">
            Toàn bộ đơn đang chờ trong công ty ({allPending.length})
          </h2>
          <div className="space-y-3">
            {allPending.map((r) => (
              <LeaveRequestCard key={r.id} r={r} actionable={false} />
            ))}
          </div>
        </section>
      )}

      <section className="mb-8">
        <h2 className="section-title mb-3">Đơn của tôi ({mine.length})</h2>
        {mine.length === 0 ? (
          <div className="card p-4 text-sm text-ink-500">
            Bạn chưa gửi đơn nghỉ phép nào.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Thời gian nghỉ</th>
                  <th>Lý do</th>
                  <th>Trạng thái</th>
                  <th>Ngày phép còn lại</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((r) => (
                  <tr key={r.id}>
                    <td className="text-ink-800">
                      {formatVnDate(r.startDate)} → {formatVnDate(r.endDate)}
                      {r.isUrgent && (
                        <span className="ml-2">
                          <Badge tone="red">Khẩn cấp</Badge>
                        </span>
                      )}
                    </td>
                    <td className="text-ink-600">
                      {r.reason}
                      {r.reviewNote && (
                        <div className="mt-1 text-xs text-ink-500">
                          Ghi chú người duyệt: {r.reviewNote}
                        </div>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="text-ink-600">
                      {quota.remaining}/{quota.total} ngày
                    </td>
                    <td>
                      {r.status === "PENDING" && (
                        <LeaveRequestActions
                          requestId={r.id}
                          mode="cancel"
                        />
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
          <h2 className="section-title mb-3">Lịch sử phòng ban</h2>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Người xin nghỉ</th>
                  <th>Thời gian nghỉ</th>
                  <th>Người duyệt</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id}>
                    <td className="text-ink-800">{r.employee.fullName}</td>
                    <td className="text-ink-600">
                      {formatVnDate(r.startDate)} → {formatVnDate(r.endDate)}
                    </td>
                    <td className="text-ink-600">
                      {r.reviewedBy?.fullName ?? "—"}
                    </td>
                    <td>
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

function LeaveRequestCard({
  r,
  actionable,
}: {
  r: {
    id: string;
    startDate: Date;
    endDate: Date;
    reason: string;
    isUrgent: boolean;
    createdAt: Date;
    employee: { fullName: string; department: { name: string } | null };
  };
  actionable: boolean;
}) {
  return (
    <div className="card p-4">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium text-ink-900">
            {r.employee.fullName}
            {r.isUrgent && (
              <span className="ml-2">
                <Badge tone="red">Khẩn cấp — không đủ 24h báo trước</Badge>
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-ink-500">
            {r.employee.department?.name ?? "—"} · Gửi lúc{" "}
            {formatDateTime(r.createdAt)}
          </div>
        </div>
      </div>
      <p className="mb-3 text-sm whitespace-pre-wrap text-ink-600">
        {r.reason}
      </p>
      <div className="mb-3 text-sm text-ink-600">
        Nghỉ từ <b className="text-ink-800">{formatVnDate(r.startDate)}</b>{" "}
        đến <b className="text-ink-800">{formatVnDate(r.endDate)}</b>
      </div>
      {actionable && <LeaveRequestActions requestId={r.id} mode="review" />}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "APPROVED") return <Badge tone="green">Đã duyệt</Badge>;
  if (status === "REJECTED") return <Badge tone="red">Đã từ chối</Badge>;
  if (status === "CANCELLED") return <Badge tone="slate">Đã huỷ</Badge>;
  return <Badge tone="amber">Đang chờ</Badge>;
}
