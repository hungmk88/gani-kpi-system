import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import { gatekeeperRuleFor, isCountedKpiRow } from "@/lib/kpi";
import { gatekeeperRuleText } from "../../achievement";
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
    // Chỉ tiêu đã ngưng dùng, trọng số 0: không tính điểm — không cần mục tiêu
    if (!isCountedKpiRow(r)) continue;
    const gate = gatekeeperRuleFor(r.kpiDefinition?.code);
    g.rows.push({
      resultId: r.id,
      kpiName: r.kpiDefinition?.name ?? "—",
      unit: r.kpiDefinition?.unit ?? "—",
      weightPercent: r.weightPercent ?? 0,
      // Giữ nguyên null (chưa đặt) — không tự biến thành 0
      targetValue: r.targetValue,
      // Dòng đã chốt thì API từ chối sửa → khoá luôn trên giao diện
      locked: r.status === "FINALIZED",
      // Gatekeeper chấm theo ngưỡng cố định, mục tiêu không tham gia tính điểm
      gatekeeperText: gate ? gatekeeperRuleText(gate) : null,
    });
  }
  // Nhân sự không có dòng KPI nào trong kỳ này (chưa được gán) thì ẩn khỏi màn hình.
  const groups = [...groupsMap.values()].filter((g) => g.rows.length > 0);

  // Khoá cả trang theo đúng luật của API /api/kpi/results/targets:
  // kỳ đã chốt thì không ai sửa; qua mốc khoá thì trưởng phòng không sửa nữa.
  const readOnlyReason =
    period.status === "FINALIZED"
      ? "Kỳ này đã chốt vĩnh viễn, chỉ xem — không sửa được nữa."
      : user.role === "MANAGER" && period.status !== "OPEN"
        ? "Kỳ đã qua mốc khoá — trưởng phòng không sửa mục tiêu được nữa. Liên hệ Ban Giám đốc."
        : null;

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
        title={`${period.status === "FINALIZED" ? "Mục tiêu" : "Đặt mục tiêu"} · ${dept.name}`}
        subtitle={`${period.name} · mỗi nhân sự một mục tiêu riêng cho từng chỉ tiêu`}
      />

      {user.role !== "MANAGER" && (
        // Chọn phòng ban: dạng thẻ gạch chân (tab) của hệ thiết kế
        <div
          role="tablist"
          aria-label="Phòng ban"
          className="mb-6 flex gap-5 overflow-x-auto border-b border-ink-200"
        >
          {departments.map((d) => (
            <Link
              key={d.id}
              href={`/kpi/${periodId}/targets?dept=${d.code}`}
              role="tab"
              aria-selected={d.id === dept.id}
              className={`-mb-px border-b-2 px-1 py-2.5 text-sm font-medium whitespace-nowrap ${
                d.id === dept.id
                  ? "border-brand-600 text-brand-700"
                  : "border-transparent text-ink-500 hover:text-ink-800"
              }`}
            >
              {d.name}
            </Link>
          ))}
        </div>
      )}

      {/* key theo phòng ban: đổi tab chỉ đổi ?dept= trên CÙNG route, Next giữ
          nguyên state của client component — thiếu key là bảng vẫn mang giá
          trị của phòng trước (ô trống, lưu là ghi đè chỉ tiêu đã có). */}
      <TargetEditor
        key={dept.id}
        periodId={periodId}
        readOnlyReason={readOnlyReason}
        currentUserId={user.id}
        currentUserRole={user.role}
        groups={groups}
      />
    </>
  );
}
