import Link from "next/link";
import { Plus } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can, taskScopeWhere } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import TaskBoard from "./task-board";
import AiQuickTask from "./ai-quick-task";

export const dynamic = "force-dynamic";

const TASK_LIMIT = 300;
const DONE_VISIBLE_DAYS = 14;

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = (await requireSession())!;
  const sp = await searchParams;

  // Việc đã huỷ không thuộc bảng làm việc; việc xong chỉ giữ 14 ngày gần
  // nhất — nếu không cột "Hoàn thành" phình vô hạn và chiếm hết hạn mức 300.
  const doneSince = new Date(Date.now() - DONE_VISIBLE_DAYS * 86_400_000);
  const where: Record<string, unknown> = {
    ...taskScopeWhere(user),
    AND: [
      { status: { not: "CANCELLED" } },
      {
        OR: [
          { status: { not: "DONE" } },
          { completedAt: { gte: doneSince } },
          { completedAt: null, updatedAt: { gte: doneSince } },
        ],
      },
    ],
  };
  if (sp.filter === "overdue") {
    where.dueDate = { lt: new Date() };
    where.status = { notIn: ["DONE", "CANCELLED"] };
  }
  if (sp.filter === "mine") where.assigneeId = user.id;
  if (sp.dept && (user.role === "CEO" || user.role === "ADMIN"))
    where.departmentId = sp.dept;

  const canCreate = can(user, "task.assign.department");
  const isCeo = user.role === "CEO";

  const [tasks, totalCount, departments, assignable] = await Promise.all([
    prisma.task.findMany({
      where,
      include: { assignee: true, department: true },
      orderBy: [{ riskScore: "desc" }, { dueDate: "asc" }],
      take: TASK_LIMIT,
    }),
    prisma.task.count({ where }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    canCreate
      ? prisma.user.findMany({
          where: {
            isActive: true,
            role: { not: "ADMIN" },
            ...(isCeo ? {} : { departmentId: user.departmentId ?? "__none__" }),
          },
          orderBy: { fullName: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        title="Công việc"
        subtitle={
          user.role === "EMPLOYEE"
            ? "Việc bạn được giao và việc bạn tạo ra."
            : user.role === "MANAGER"
              ? `Toàn bộ việc của phòng ${user.departmentName ?? ""}.`
              : "Toàn bộ việc của công ty."
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/tasks/gantt" className="btn-ghost">
              Gantt
            </Link>
            <Link href="/tasks/calendar" className="btn-ghost">
              Lịch
            </Link>
            {canCreate && (
              <Link href="/tasks/new" className="btn-primary">
                <Plus size={16} aria-hidden /> Giao việc mới
              </Link>
            )}
          </div>
        }
      />

      {canCreate && (
        <AiQuickTask
          role={user.role}
          myDepartmentId={user.departmentId}
          departments={
            isCeo
              ? departments.map((d) => ({ id: d.id, name: d.name }))
              : departments
                  .filter((d) => d.id === user.departmentId)
                  .map((d) => ({ id: d.id, name: d.name }))
          }
          users={assignable.map((u) => ({
            id: u.id,
            name: u.fullName,
            departmentId: u.departmentId,
            jobTitle: u.jobTitle ?? "",
          }))}
        />
      )}

      <TaskBoard
        tasks={tasks.map((t) => ({
          id: t.id,
          code: t.code,
          title: t.title,
          status: t.status,
          priority: t.priority,
          progress: t.progress,
          riskScore: t.riskScore,
          riskReason: t.riskReason,
          dueDate: t.dueDate.toISOString(),
          assigneeName: t.assignee?.fullName ?? null,
          departmentName: t.department.name,
          isAiGenerated: t.isAiGenerated,
        }))}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        role={user.role}
        showDeptFilter={user.role === "CEO" || user.role === "ADMIN"}
        totalCount={totalCount}
        doneVisibleDays={DONE_VISIBLE_DAYS}
      />
    </>
  );
}
