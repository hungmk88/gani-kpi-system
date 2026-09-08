import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  Badge,
  PageHeader,
  PriorityBadge,
  ProgressBar,
  RiskBadge,
  TaskStatusBadge,
  formatDateTime,
} from "@/components/ui";
import TaskActions from "./task-actions";
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
        <div className="mb-2 text-3xl">🔒</div>
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

  const nowMs = Date.now();
  const openStatuses = ["BACKLOG", "TO_DO", "IN_PROGRESS", "BLOCKED", "REVIEW"];

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
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <TaskStatusBadge status={task.status} />
              <PriorityBadge priority={task.priority} />
              <RiskBadge score={task.riskScore} />
            </div>

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
                    : new Date(task.dueDate) < new Date()
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
                      {formatDateTime(c.createdAt)}
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
                      className="mt-1.5 inline-block text-xs text-brand-600 hover:underline"
                    >
                      📎 Xem tệp đính kèm
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
          <TaskActions
            task={{
              id: task.id,
              status: task.status,
              priority: task.priority,
              progress: task.progress,
              assigneeId: task.assigneeId,
              dueDate: task.dueDate.toISOString(),
            }}
            role={user.role}
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
            }))}
            candidates={dependencyCandidates}
          />

          <div className="card p-5">
            <h3 className="section-title mb-3">Thông tin</h3>
            <dl className="space-y-2.5 text-sm">
              <Row label="Người phụ trách">
                {task.assignee?.fullName ?? (
                  <span className="text-amber-600">Chưa giao</span>
                )}
              </Row>
              <Row label="Người giao việc">{task.creator.fullName}</Row>
              <Row label="Bắt đầu">{formatDateTime(task.startDate)}</Row>
              <Row label="Hạn chót">
                <span
                  className={
                    new Date(task.dueDate) < new Date() &&
                    task.status !== "DONE"
                      ? "font-medium text-red-600"
                      : ""
                  }
                >
                  {formatDateTime(task.dueDate)}
                </span>
              </Row>
              <Row label="Hoàn thành lúc">
                {formatDateTime(task.completedAt)}
              </Row>
              <Row label="Chỉ tiêu KPI gắn kèm">
                {task.kpiDefinition?.name ?? "—"}
              </Row>
              <Row label="Tạo lúc">{formatDateTime(task.createdAt)}</Row>
            </dl>
          </div>
        </div>
      </div>
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
