import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, Lock, Paperclip, TriangleAlert } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  Badge,
  PageHeader,
  PriorityBadge,
  ProgressBar,
  RiskBadge,
  TaskStatusBadge,
} from "@/components/ui";
import { fmtDate, fmtDateTime, fmtDeadline } from "@/lib/format";
import { predecessorsDueAfter } from "@/lib/gantt";
import TaskActions from "./task-actions";
import StatusActions from "./status-actions";
import DependenciesPanel from "./dependencies-panel";

export const dynamic = "force-dynamic";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = (await requireSession())!;

  const task = await prisma.task.findUnique({
    where: { id },
    include: {
      assignee: true,
      creator: true,
      department: true,
      project: true,
      kpiDefinition: true,
      comments: { include: { user: true }, orderBy: { createdAt: "asc" } },
      dependencies: { include: { dependsOn: true } },
      dependents: { include: { task: true } },
    },
  });
  if (!task) notFound();

  const isOwner = task.assigneeId === user.id || task.creatorId === user.id;
  const sameDept = task.departmentId === user.departmentId;
  const allowed =
    user.role === "CEO" ||
    user.role === "ADMIN" ||
    (user.role === "MANAGER" && (sameDept || isOwner)) ||
    (user.role === "EMPLOYEE" && isOwner);

  if (!allowed) {
    return (
      <div className="card p-8 text-center">
        <div className="mb-2 flex justify-center text-ink-400">
          <Lock size={30} strokeWidth={1.75} />
        </div>
        <div className="font-medium text-ink-800">
          Bạn không có quyền xem công việc này
        </div>
        <div className="mt-1 text-sm text-ink-500">
          Công việc thuộc phòng ban khác. Nếu cần theo dõi, hãy đề nghị trưởng
          phòng của bạn gửi Yêu cầu liên phòng ban.
        </div>
        <Link href="/tasks" className="btn-ghost mt-4">
          ← Về danh sách công việc
        </Link>
      </div>
    );
  }

  // Người "quản" việc — đúng luật của PATCH /api/tasks/[id]: BGĐ, người giao
  // việc, hoặc trưởng phòng của chính phòng sở hữu việc.
  const canManage =
    user.role === "CEO" ||
    task.creatorId === user.id ||
    (user.role === "MANAGER" && task.departmentId === user.departmentId);

  const canEditDeps =
    user.role === "CEO" ||
    (user.role === "MANAGER" && task.departmentId === user.departmentId);

  // Việc có thể nối làm điều kiện: cùng phòng ban, chưa nối, và không phải chính nó
  const alreadyLinked = new Set([
    task.id,
    ...task.dependencies.map((d) => d.dependsOnId),
  ]);
  const dependencyCandidates = canEditDeps
    ? (
        await prisma.task.findMany({
          where: {
            status: { not: "CANCELLED" },
            ...(user.role === "MANAGER"
              ? { departmentId: user.departmentId ?? "__none__" }
              : {}),
          },
          orderBy: { dueDate: "asc" },
          take: 100,
          select: { id: true, code: true, title: true },
        })
      ).filter((c) => !alreadyLinked.has(c.id))
    : [];

  const now = new Date();
  const nowMs = now.getTime();
  const openStatuses = ["BACKLOG", "TO_DO", "IN_PROGRESS", "BLOCKED", "REVIEW"];

  // Hạn chót đặt ngay cạnh trạng thái — chỉ tô đỏ khi đã trễ thật
  const isClosed = task.status === "DONE" || task.status === "CANCELLED";
  const deadline = fmtDeadline(task.dueDate, { now, done: isClosed });

  // Việc phải chờ mà hạn còn muộn hơn hạn của việc này: kế hoạch tự mâu thuẫn
  const predsDueAfter = isClosed
    ? []
    : predecessorsDueAfter(
        task.dueDate,
        task.dependencies.map((d) => d.dependsOn)
      );
  const dueAfterIds = new Set(predsDueAfter.map((p) => p.id));

  // Nhân sự có thể chuyển giao (chỉ trong phòng ban, đúng luật cấm vượt cấp)
  const assignableUsers =
    user.role === "EMPLOYEE"
      ? []
      : await prisma.user.findMany({
          where: {
            isActive: true,
            ...(user.role === "MANAGER"
              ? { departmentId: user.departmentId ?? "__none__" }
              : {}),
          },
          orderBy: { fullName: "asc" },
          include: { department: true },
        });

  return (
    <>
      <div className="mb-4">
        <Link
          href="/tasks"
          className="text-sm text-ink-500 hover:text-brand-600"
        >
          ← Công việc
        </Link>
      </div>

      <PageHeader
        title={task.title}
        subtitle={`${task.code} · Phòng ${task.department.name}${
          task.project ? ` · Dự án ${task.project.name}` : ""
        }`}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ------------- Cột chính ------------- */}
        <div className="space-y-6 lg:col-span-2">
          <div className="card p-5">
            <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
              <TaskStatusBadge status={task.status} />
              <span
                className={`inline-flex items-center gap-1.5 text-sm ${
                  deadline.late ? "font-semibold text-red-700" : "text-ink-700"
                }`}
              >
                <CalendarClock size={16} strokeWidth={2} aria-hidden />
                <span>
                  Hạn {deadline.date}
                  {deadline.relative && (
                    <span className={deadline.late ? "" : "text-ink-500"}>
                      {" "}
                      · {deadline.relative}
                    </span>
                  )}
                </span>
              </span>
              <span className="flex flex-wrap gap-2">
                <PriorityBadge priority={task.priority} />
                <RiskBadge score={task.riskScore} />
              </span>
            </div>

            {/* Nút đổi trạng thái ngay dưới trạng thái + hạn chót: máy tính là
                một hàng trong thẻ, điện thoại dính đáy màn hình. Khoảng đệm
                của StickyActions (phần tử aria-hidden) bị ẩn ở đây vì nó sẽ
                nằm giữa trang — đệm thật đặt ở cuối trang bên dưới. */}
            <div className="sm:-mt-4 sm:mb-4 [&>div[aria-hidden]]:hidden">
              <StatusActions
                taskId={task.id}
                status={task.status}
                canManage={canManage}
              />
            </div>

            {predsDueAfter.length > 0 && (
              <div className="mb-4 flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <TriangleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
                <div>
                  {predsDueAfter.map((p) => (
                    <div key={p.id}>
                      Việc phụ thuộc{" "}
                      <Link href={`/tasks/${p.id}`} className="font-medium underline">
                        {p.code}
                      </Link>{" "}
                      hạn {fmtDate(p.dueDate)}, trễ hơn hạn của việc này (
                      {fmtDate(task.dueDate)}).
                    </div>
                  ))}
                  <div className="mt-0.5 text-xs">
                    Dời hạn việc này hoặc thúc việc kia xong sớm hơn — nếu không
                    việc này chắc chắn trễ.
                  </div>
                </div>
              </div>
            )}

            {task.riskReason && task.riskScore >= 30 && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <b>Hệ thống đánh giá rủi ro:</b> {task.riskReason}
              </div>
            )}

            <div className="mb-4">
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="text-ink-500">Tiến độ</span>
                <span className="font-medium text-ink-800">
                  {task.progress}%
                </span>
              </div>
              <ProgressBar
                value={task.progress}
                tone={
                  task.status === "DONE"
                    ? "green"
                    : deadline.late
                      ? "red"
                      : "brand"
                }
              />
            </div>

            <div className="prose-sm text-sm whitespace-pre-wrap text-ink-700">
              {task.description || (
                <span className="text-ink-400">Không có mô tả chi tiết.</span>
              )}
            </div>
          </div>

          {/* Trao đổi */}
          <div>
            <h2 className="section-title mb-3">
              Trao đổi &amp; bằng chứng ({task.comments.length})
            </h2>
            <div className="space-y-2">
              {task.comments.map((c) => (
                <div
                  key={c.id}
                  className={`card p-3.5 ${
                    c.kind === "STATUS_CHANGE" ? "bg-ink-50/70" : ""
                  }`}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium text-ink-800">
                      {c.user.fullName}
                    </span>
                    <span className="text-ink-400">
                      {fmtDateTime(c.createdAt)}
                    </span>
                    {c.kind === "EVIDENCE" && (
                      <Badge tone="violet">Bằng chứng</Badge>
                    )}
                    {c.kind === "STATUS_CHANGE" && (
                      <Badge tone="slate">Đổi trạng thái</Badge>
                    )}
                  </div>
                  <div className="text-sm whitespace-pre-wrap text-ink-700">
                    {c.body}
                  </div>
                  {c.fileUrl && (
                    <a
                      href={c.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1.5 inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
                    >
                      <Paperclip size={12} strokeWidth={2} /> Xem tệp đính kèm
                    </a>
                  )}
                </div>
              ))}
              {task.comments.length === 0 && (
                <div className="card p-4 text-sm text-ink-400">
                  Chưa có trao đổi nào.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ------------- Cột thao tác ------------- */}
        <div className="space-y-6">
          {/* key theo trạng thái + tiến độ: đổi sang Hoàn thành thì máy chủ đặt
              tiến độ 100% — dựng lại ô tiến độ, không giữ số cũ trong state */}
          <TaskActions
            key={`${task.status}-${task.progress}`}
            task={{
              id: task.id,
              status: task.status,
              priority: task.priority,
              progress: task.progress,
              assigneeId: task.assigneeId,
            }}
            canManage={canManage}
            isManagerRole={user.role === "MANAGER"}
            assignableUsers={assignableUsers.map((u) => ({
              id: u.id,
              name: `${u.fullName} — ${u.department?.name ?? "Không phòng ban"}`,
            }))}
          />

          <DependenciesPanel
            taskId={task.id}
            canEdit={canEditDeps}
            blockedBy={task.dependencies.map((d) => ({
              id: d.dependsOn.id,
              code: d.dependsOn.code,
              title: d.dependsOn.title,
              status: d.dependsOn.status,
              dueDate: d.dependsOn.dueDate.toISOString(),
              isLate:
                openStatuses.includes(d.dependsOn.status) &&
                d.dependsOn.dueDate.getTime() < nowMs,
              dueAfterTask: dueAfterIds.has(d.dependsOn.id),
            }))}
            blocking={task.dependents.map((d) => ({
              id: d.task.id,
              code: d.task.code,
              title: d.task.title,
              status: d.task.status,
              dueDate: d.task.dueDate.toISOString(),
              isLate:
                openStatuses.includes(d.task.status) &&
                d.task.dueDate.getTime() < nowMs,
              dueAfterTask: false,
            }))}
            candidates={dependencyCandidates}
          />

          <div className="card p-5">
            <h3 className="section-title mb-3">Thông tin</h3>
            <dl className="space-y-2.5 text-sm">
              <Row label="Người phụ trách">
                {task.assignee?.fullName ?? (
                  <span className="text-amber-800">Chưa giao</span>
                )}
              </Row>
              <Row label="Người giao việc">{task.creator.fullName}</Row>
              <Row label="Bắt đầu">{fmtDateTime(task.startDate)}</Row>
              <Row label="Hạn chót">
                <span className={deadline.late ? "font-medium text-red-700" : ""}>
                  {fmtDateTime(task.dueDate)}
                </span>
              </Row>
              <Row label="Hoàn thành lúc">
                {fmtDateTime(task.completedAt)}
              </Row>
              <Row label="Chỉ tiêu KPI gắn kèm">
                {task.kpiDefinition?.name ?? "—"}
              </Row>
              <Row label="Tạo lúc">{fmtDateTime(task.createdAt)}</Row>
            </dl>
          </div>
        </div>
      </div>

      {/* Đệm cuối trang cho thanh nút dính đáy trên điện thoại */}
      <div className="h-16 sm:hidden" aria-hidden />
    </>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-ink-500">{label}</dt>
      <dd className="text-right font-medium text-ink-800">{children}</dd>
    </div>
  );
}
