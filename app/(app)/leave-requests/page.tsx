import Link from "next/link";
import { Download, CircleCheck, CalendarClock } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge, EmptyState, PageHeader, ShowingCount } from "@/components/ui";
import {
  canCancelLeave,
  findTasksDueDuringLeave,
  getAnnualLeaveQuota,
  leaveDaysBetween,
  leaveReportScope,
  type LeaveConflictTask,
} from "@/lib/services/leave-service";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/format";
import { vnParts } from "@/lib/vn-time";
import LeaveRequestForm from "./leave-request-form";
import LeaveRequestActions from "./leave-request-actions";

export const dynamic = "force-dynamic";

/** Lịch sử phòng ban hiện tối đa chừng này đơn gần nhất */
const HISTORY_LIMIT = 50;
/** Thẻ đơn chờ duyệt liệt kê tối đa chừng này việc trùng ngày nghỉ */
const CONFLICT_PREVIEW = 5;

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

  const now = new Date();
  const mine = requests.filter((r) => r.employeeId === user.id);
  const history = requests.filter(
    (r) => r.status !== "PENDING" && r.employeeId !== user.id
  );
  const historyShown = history.slice(0, HISTORY_LIMIT);

  // Việc của người xin nghỉ có hạn rơi vào ngày nghỉ — một truy vấn cho mọi
  // đơn đang chờ mà người xem nhìn thấy (không truy vấn từng đơn).
  const conflicts = await findTasksDueDuringLeave([...inbox, ...allPending]);

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

      {/* Người duyệt: hàng đợi "chờ tôi duyệt" lên đầu trang — đó là việc
          của họ khi mở trang này, form gửi đơn của chính họ xếp sau. */}
      {(user.role === "MANAGER" || user.role === "CEO") && (
        <section className="mb-8">
          <h2 className="section-title mb-3">
            Chờ tôi duyệt ({fmtNum(inbox.length)})
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
                <LeaveRequestCard
                  key={r.id}
                  r={r}
                  actionable
                  conflicts={conflicts.get(r.id) ?? []}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {user.role !== "CEO" && (
        <section className="mb-8">
          <h2 className="section-title mb-3">Gửi đơn mới</h2>
          <LeaveRequestForm />
        </section>
      )}

      {allPending.length > 0 && (
        <section className="mb-8">
          <h2 className="section-title mb-3">
            Toàn bộ đơn đang chờ trong công ty ({fmtNum(allPending.length)})
          </h2>
          <div className="space-y-3">
            {allPending.map((r) => (
              <LeaveRequestCard
                key={r.id}
                r={r}
                actionable={false}
                conflicts={conflicts.get(r.id) ?? []}
              />
            ))}
          </div>
        </section>
      )}

      <section className="mb-8">
        <h2 className="section-title mb-3">Đơn của tôi ({fmtNum(mine.length)})</h2>
        {mine.length === 0 ? (
          <div className="card p-4 text-sm text-ink-500">
            Bạn chưa gửi đơn nghỉ phép nào.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="tbl tbl-stack">
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
                      {fmtDate(r.startDate)} → {fmtDate(r.endDate)}
                      <div className="text-xs text-ink-500">
                        <LeaveDays r={r} />
                      </div>
                      {r.isUrgent && (
                        <span className="ml-2">
                          <Badge tone="red">Khẩn cấp</Badge>
                        </span>
                      )}
                    </td>
                    <td data-label="Lý do" className="text-ink-600">
                      {r.reason}
                      {r.reviewNote && (
                        <div className="mt-1 text-xs text-ink-500">
                          Ghi chú người duyệt: {r.reviewNote}
                        </div>
                      )}
                    </td>
                    <td data-label="Trạng thái">
                      <StatusBadge status={r.status} />
                    </td>
                    <td data-label="Ngày phép còn lại" className="text-ink-600">
                      {fmtNum(quota.remaining)}/{fmtNum(quota.total)} ngày
                    </td>
                    <td data-label="">
                      {canCancelLeave(user, r, now) && (
                        <LeaveRequestActions
                          requestId={r.id}
                          mode="cancel"
                          approved={r.status === "APPROVED"}
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
            <table className="tbl tbl-stack">
              <thead>
                <tr>
                  <th>Người xin nghỉ</th>
                  <th>Thời gian nghỉ</th>
                  <th>Người duyệt</th>
                  <th>Trạng thái</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {historyShown.map((r) => (
                  <tr key={r.id}>
                    <td className="text-ink-800">{r.employee.fullName}</td>
                    <td data-label="Thời gian nghỉ" className="text-ink-600">
                      {fmtDate(r.startDate)} → {fmtDate(r.endDate)}
                      <div className="text-xs text-ink-500">
                        <LeaveDays r={r} />
                      </div>
                    </td>
                    <td data-label="Người duyệt" className="text-ink-600">
                      {r.reviewedBy?.fullName ?? "—"}
                    </td>
                    <td data-label="Trạng thái">
                      <StatusBadge status={r.status} />
                    </td>
                    <td data-label="">
                      {/* Đơn đã duyệt, chưa tới ngày nghỉ: người có quyền duyệt được huỷ hộ */}
                      {canCancelLeave(user, r, now) && (
                        <LeaveRequestActions requestId={r.id} mode="cancel-other" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ShowingCount
            shown={historyShown.length}
            total={history.length}
            hint="các đơn gần nhất; tải Excel để xem đủ"
          />
        </section>
      )}
    </>
  );
}

/**
 * Số ngày của đơn — đúng cách hệ thống trừ phép (leaveDaysBetween): ngày LỊCH,
 * gồm cả ngày đầu lẫn ngày cuối, KHÔNG trừ cuối tuần. Ghi rõ để người duyệt
 * không tưởng "5 ngày" là 5 ngày làm việc.
 */
function LeaveDays({ r }: { r: { startDate: Date; endDate: Date } }) {
  const n = leaveDaysBetween(r.startDate, r.endDate);
  return (
    <span title="Ngày lịch, tính cả ngày đầu, ngày cuối và cuối tuần — đúng cách trừ phép">
      {fmtNum(n)} ngày lịch
    </span>
  );
}

function LeaveRequestCard({
  r,
  actionable,
  conflicts,
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
  /** Việc chưa xong của người xin nghỉ có hạn trong những ngày nghỉ */
  conflicts: LeaveConflictTask[];
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
            {fmtDateTime(r.createdAt)}
          </div>
        </div>
      </div>
      <p className="mb-3 text-sm whitespace-pre-wrap text-ink-600">
        {r.reason}
      </p>
      <div className="mb-3 text-sm text-ink-600">
        Nghỉ từ <b className="text-ink-800">{fmtDate(r.startDate)}</b> đến{" "}
        <b className="text-ink-800">{fmtDate(r.endDate)}</b> ·{" "}
        <b className="text-ink-800">
          <LeaveDays r={r} />
        </b>
      </div>
      {conflicts.length > 0 && (
        <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <div className="flex items-center gap-1.5 font-medium">
            <CalendarClock size={16} aria-hidden />
            Trùng {fmtNum(conflicts.length)} việc có hạn trong thời gian nghỉ
          </div>
          <ul className="mt-1 space-y-0.5 text-xs">
            {conflicts.slice(0, CONFLICT_PREVIEW).map((t) => (
              <li key={t.id}>
                <Link href={`/tasks/${t.id}`} className="underline hover:no-underline">
                  {t.code} · {t.title}
                </Link>{" "}
                — hạn {fmtDate(t.dueDate)}
              </li>
            ))}
            {conflicts.length > CONFLICT_PREVIEW && (
              <li>và {fmtNum(conflicts.length - CONFLICT_PREVIEW)} việc khác</li>
            )}
          </ul>
        </div>
      )}
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
