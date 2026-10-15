import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import TargetEditor, { type TargetGroup } from "./target-editor";

export const dynamic = "force-dynamic";

/**
 * Đặt mục tiêu (targetValue) hàng loạt cho từng nhân sự trong một phòng ban.
 * Sản Xuất đặt chỉ tiêu theo từng mã sản phẩm (Quản lý SKU) và chấm theo ca;
 * các phòng còn lại (vd Sales) mỗi người một mục tiêu riêng, nên sửa thẳng
 * trên từng dòng KpiResult.
 */
export default async function KpiTargetsPage({
  params,
  searchParams,
}: {
  params: Promise<{ periodId: string }>;
  searchParams: Promise<{ dept?: string }>;
}) {
  const { periodId } = await params;
  const { dept: deptCodeParam } = await searchParams;
  const user = (await requireSession())!;

  if (!can(user, "kpi.target.assign")) redirect(`/kpi/${periodId}`);

  const period = await prisma.kpiPeriod.findUnique({ where: { id: periodId } });
  if (!period) notFound();

  const departments = await prisma.department.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

  const dept =
    user.role === "MANAGER"
      ? departments.find((d) => d.id === user.departmentId)
      : deptCodeParam
        ? departments.find((d) => d.code === deptCodeParam)
        : departments[0];

  if (!dept) notFound();

  const employees = await prisma.user.findMany({
    where: { isActive: true, departmentId: dept.id, role: { not: "ADMIN" } },
    orderBy: { fullName: "asc" },
  });

  const results = await prisma.kpiResult.findMany({
    where: {
      periodId,
      employeeId: { in: employees.map((e) => e.id) },
      kpiDefinition: { departmentId: dept.id },
    },
    include: { kpiDefinition: true },
    orderBy: [{ weightPercent: "desc" }],
  });

  const groupsMap = new Map<string, TargetGroup>();
  for (const e of employees) {
    groupsMap.set(e.id, {
      employeeId: e.id,
      employeeName: e.fullName,
      role: e.role,
      rows: [],
    });
  }
  for (const r of results) {
    const g = groupsMap.get(r.employeeId);
    if (!g) continue;
    g.rows.push({
      resultId: r.id,
      kpiName: r.kpiDefinition?.name ?? "—",
      unit: r.kpiDefinition?.unit ?? "—",
      weightPercent: r.weightPercent ?? 0,
      targetValue: r.targetValue ?? 0,
    });
  }
  // Nhân sự không có dòng KPI nào trong kỳ này (chưa được gán) thì ẩn khỏi màn hình.
  const groups = [...groupsMap.values()].filter((g) => g.rows.length > 0);

  return (
    <>
      <div className="mb-4">
        <Link
          href={`/kpi/${periodId}`}
          className="text-sm text-ink-500 hover:text-brand-600"
        >
          ← Bảng KPI {period.name}
        </Link>
      </div>

      <PageHeader
        title={`Đặt mục tiêu · ${dept.name}`}
        subtitle={`${period.name} · mỗi nhân sự một mục tiêu riêng cho từng chỉ tiêu`}
      />

      {user.role !== "MANAGER" && (
        <div className="card mb-6 flex flex-wrap items-center gap-2 p-4">
          <span className="text-sm font-medium text-ink-600">Phòng ban:</span>
          {departments.map((d) => (
            <Link
              key={d.id}
              href={`/kpi/${periodId}/targets?dept=${d.code}`}
              className={`rounded-full px-3 py-1 text-sm ${
                d.id === dept.id
                  ? "bg-brand-600 text-white"
                  : "bg-ink-100 text-ink-600 hover:bg-ink-200"
              }`}
            >
              {d.name}
            </Link>
          ))}
        </div>
      )}

      <TargetEditor
        periodId={periodId}
        canEdit={period.status !== "FINALIZED"}
        groups={groups}
      />
    </>
  );
}
