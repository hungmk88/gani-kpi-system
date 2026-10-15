import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { GanttChartSquare } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { taskScopeWhere } from "@/lib/rbac";
import { buildGantt } from "@/lib/gantt";
import { EmptyState, PageHeader, ShowingCount } from "@/components/ui";
import GanttChart from "./gantt-chart";

export const dynamic = "force-dynamic";

// Trần số việc vẽ một lần — quá nhiều thanh thì trình duyệt ì và không ai đọc nổi
const GANTT_LIMIT = 200;
const DONE_VISIBLE_DAYS = 14;

export default async function GanttPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = (await requireSession())!;
  const sp = await searchParams;

  // Phạm vi chung: đúng quyền xem, bỏ việc đã huỷ, áp bộ lọc dự án / phòng ban.
  // Dùng AND để không đè lên OR của taskScopeWhere (nhân viên).
  const base: Prisma.TaskWhereInput[] = [
    taskScopeWhere(user),
    { status: { not: "CANCELLED" } },
  ];
  if (sp.project) base.push({ projectId: sp.project });
  if (sp.dept && (user.role === "CEO" || user.role === "ADMIN")) {
    base.push({ departmentId: sp.dept });
  }

  // Việc đang mở là trọng tâm; việc xong chỉ giữ 14 ngày gần nhất để còn thấy
  // mắt xích trước của đường găng, không để việc cũ chiếm hết hạn mức.
  const doneSince = new Date(Date.now() - DONE_VISIBLE_DAYS * 86_400_000);
  const openWhere: Prisma.TaskWhereInput = {
    AND: [...base, { status: { not: "DONE" } }],
  };
  const doneWhere: Prisma.TaskWhereInput = {
    AND: [
      ...base,
      { status: "DONE" },
      {
        OR: [
          { completedAt: { gte: doneSince } },
          { completedAt: null, updatedAt: { gte: doneSince } },
        ],
      },
    ],
  };

  // Dự án trong ô lọc: CEO/ADMIN thấy hết; còn lại chỉ dự án có việc trong
  // tầm của mình (trưởng phòng: dự án có việc của phòng mình).
  const isCompanyWide = user.role === "CEO" || user.role === "ADMIN";

  const [openTasks, openCount, doneCount, projects, departments] =
    await Promise.all([
      // Hạn sớm nhất trước → việc trễ và việc sắp đến hạn luôn được giữ khi chạm trần
      prisma.task.findMany({
        where: openWhere,
        include: { assignee: true, department: true },
        orderBy: [{ dueDate: "asc" }, { startDate: "asc" }],
        take: GANTT_LIMIT,
      }),
      prisma.task.count({ where: openWhere }),
      prisma.task.count({ where: doneWhere }),
      prisma.project.findMany({
        where: isCompanyWide
          ? undefined
          : { tasks: { some: taskScopeWhere(user) } },
        orderBy: { name: "asc" },
      }),
      prisma.department.findMany({ orderBy: { name: "asc" } }),
    ]);

  // Việc xong chỉ lấp phần hạn mức còn trống, mới xong trước
  const doneRoom = GANTT_LIMIT - openTasks.length;
  const doneTasks =
    doneRoom > 0
      ? await prisma.task.findMany({
          where: doneWhere,
          include: { assignee: true, department: true },
          orderBy: [{ completedAt: "desc" }, { updatedAt: "desc" }],
          take: doneRoom,
        })
      : [];

  const tasks = [...openTasks, ...doneTasks];
  const totalCount = openCount + doneCount;

  // Chỉ nạp quan hệ chạm tới việc đang xem, không kéo cả công ty về
  const visibleIds = tasks.map((t) => t.id);
  const edges = visibleIds.length
    ? await prisma.taskDependency.findMany({
        where: {
          OR: [
            { taskId: { in: visibleIds } },
            { dependsOnId: { in: visibleIds } },
          ],
        },
        select: { taskId: true, dependsOnId: true },
      })
    : [];

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
        <>
          {/* Chạm trần 200 việc: nói rõ đang thiếu bao nhiêu và đã ưu tiên gì */}
          {totalCount > tasks.length && (
            <div className="-mt-2 mb-4">
              <ShowingCount
                shown={tasks.length}
                total={totalCount}
                hint="ưu tiên việc trễ hạn và sắp đến hạn, việc đã xong lấy sau cùng — lọc theo dự án hoặc phòng ban để xem đủ"
              />
            </div>
          )}
          <GanttChart
            data={gantt}
            projects={projects.map((p) => ({ id: p.id, name: p.name }))}
            departments={departments.map((d) => ({ id: d.id, name: d.name }))}
            showDeptFilter={isCompanyWide}
            activeProject={sp.project ?? ""}
            activeDept={sp.dept ?? ""}
          />
        </>
      )}
    </>
  );
}
