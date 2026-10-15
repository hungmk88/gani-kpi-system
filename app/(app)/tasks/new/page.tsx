import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import NewTaskForm from "./new-task-form";

export const dynamic = "force-dynamic";

export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  const user = (await requireSession())!;
  if (!can(user, "task.assign.department")) redirect("/tasks");

  const isCeo = user.role === "CEO";

  const [departments, users, projects] = await Promise.all([
    prisma.department.findMany({
      where: isCeo ? {} : { id: user.departmentId ?? "__none__" },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: {
        isActive: true,
        ...(isCeo ? {} : { departmentId: user.departmentId ?? "__none__" }),
        role: { not: "ADMIN" },
      },
      include: { department: true },
      orderBy: { fullName: "asc" },
    }),
    prisma.project.findMany({
      where: isCeo ? {} : { departmentId: user.departmentId ?? "__none__" },
      orderBy: { name: "asc" },
    }),
  ]);

  const allDepartments = await prisma.department.findMany({
    orderBy: { name: "asc" },
  });

  return (
    <>
      <div className="mb-4">
        <Link href="/tasks" className="text-sm text-ink-500 hover:text-brand-600">
          ← Công việc
        </Link>
      </div>

      <PageHeader
        title="Giao việc mới"
        subtitle={
          isCeo
            ? "Ban Giám đốc giao việc được cho toàn công ty."
            : `Bạn giao việc trong phòng ${user.departmentName ?? ""}. Muốn nhờ phòng khác thì dùng Yêu cầu liên phòng ban.`
        }
      />

      <NewTaskForm
        // ?mode=request (từ trang Yêu cầu liên phòng ban) → mở sẵn tab nhờ phòng khác
        initialMode={mode === "request" ? "request" : "task"}
        role={user.role}
        myDepartmentId={user.departmentId}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        allDepartments={allDepartments.map((d) => ({
          id: d.id,
          name: d.name,
        }))}
        users={users.map((u) => ({
          id: u.id,
          name: u.fullName,
          departmentId: u.departmentId,
          departmentName: u.department?.name ?? "",
          jobTitle: u.jobTitle ?? "",
        }))}
        projects={projects.map((p) => ({
          id: p.id,
          name: p.name,
          departmentId: p.departmentId,
        }))}
      />
    </>
  );
}
