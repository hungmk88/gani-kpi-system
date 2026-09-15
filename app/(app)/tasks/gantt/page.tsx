import Link from "next/link";
import { GanttChartSquare } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { taskScopeWhere } from "@/lib/rbac";
import { buildGantt } from "@/lib/gantt";
import { EmptyState, PageHeader } from "@/components/ui";
import GanttChart from "./gantt-chart";

export const dynamic = "force-dynamic";

export default async function GanttPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = (await requireSession())!;
  const sp = await searchParams;

  const where: Record<string, unknown> = {
    ...taskScopeWhere(user),
    status: { not: "CANCELLED" },
  };
  if (sp.project) where.projectId = sp.project;
  if (sp.dept && (user.role === "CEO" || user.role === "ADMIN")) {
    where.departmentId = sp.dept;
  }

  const [tasks, projects, departments] = await Promise.all([
    prisma.task.findMany({
      where,
      include: { assignee: true, department: true },
      orderBy: [{ startDate: "asc" }, { dueDate: "asc" }],
      take: 200,
    }),
    prisma.project.findMany({ orderBy: { name: "asc" } }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
  ]);

  const edges = await prisma.taskDependency.findMany({
    select: { taskId: true, dependsOnId: true },
  });

  const gantt = buildGantt(
    tasks.map((t) => ({
      id: t.id,
      code: t.code,
      title: t.title,
      status: t.status,
      priority: t.priority,
      progress: t.progress,
      riskScore: t.riskScore,
      startDate: t.startDate,
      dueDate: t.dueDate,
      createdAt: t.createdAt,
      assigneeName: t.assignee?.fullName ?? null,
      departmentName: t.department.name,
    })),
    edges
  );

  return (
    <>
      <PageHeader
        title="Biểu đồ Gantt"
        subtitle="Đường găng là chuỗi việc nối tiếp dài nhất — chậm một mắt trên đó là cả chuỗi chậm theo. Việc ngoài đường găng còn dư địa để trễ."
        actions={
          <div className="flex gap-2">
            <Link href="/tasks" className="btn-ghost btn-sm">
              Bảng Kanban
            </Link>
            <Link href="/tasks/calendar" className="btn-ghost btn-sm">
              Lịch
            </Link>
          </div>
        }
      />

      {tasks.length === 0 ? (
        <EmptyState
          icon={<GanttChartSquare size={32} strokeWidth={1.75} />}
          title="Không có công việc nào để vẽ"
          hint="Biểu đồ Gantt cần ít nhất một công việc trong tầm quản lý của bạn."
        />
      ) : (
        <GanttChart
          data={gantt}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          departments={departments.map((d) => ({ id: d.id, name: d.name }))}
          showDeptFilter={user.role === "CEO" || user.role === "ADMIN"}
          activeProject={sp.project ?? ""}
          activeDept={sp.dept ?? ""}
        />
      )}
    </>
  );
}
