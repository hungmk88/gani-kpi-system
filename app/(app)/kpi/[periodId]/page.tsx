import Link from "next/link";
import { notFound } from "next/navigation";
import { Target, Lock, Check } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can, kpiScopeWhere } from "@/lib/rbac";
import {
  isManagerReviewOpen,
  isSelfReviewOpen,
  summarizeResults,
} from "@/lib/kpi";
import { PageHeader, PeriodStatusBadge, formatDate } from "@/components/ui";
import KpiWorkTable, { type KpiRow } from "./kpi-work-table";

export const dynamic = "force-dynamic";

export default async function KpiPeriodPage({
  params,
}: {
  params: Promise<{ periodId: string }>;
}) {
  const { periodId } = await params;
  const user = (await requireSession())!;

  const period = await prisma.kpiPeriod.findUnique({ where: { id: periodId } });
  if (!period) notFound();

  const results = await prisma.kpiResult.findMany({
    where: { periodId, ...kpiScopeWhere(user) },
    include: {
      kpiDefinition: true,
      employee: { include: { department: true } },
    },
    orderBy: [{ employee: { fullName: "asc" } }, { weightPercent: "desc" }],
  });

  // Gom theo nhân sự
  const groupsMap = new Map<
    string,
    {
      employeeId: string;
      employeeName: string;
      jobTitle: string;
      departmentName: string;
      rows: KpiRow[];
    }
  >();

  for (const r of results) {
    const key = r.employeeId;
    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        employeeId: r.employeeId,
        employeeName: r.employee.fullName,
        jobTitle: r.employee.jobTitle ?? "",
        departmentName: r.employee.department?.name ?? "—",
        rows: [],
      });
    }
    groupsMap.get(key)!.rows.push({
      id: r.id,
      kpiName: r.kpiDefinition?.name ?? "—",
      unit: r.kpiDefinition?.unit ?? "—",
      isHigherBetter: r.kpiDefinition?.isHigherBetter ?? true,
      dataSource: r.kpiDefinition?.dataSource ?? "MANUAL",
      weightPercent: r.weightPercent ?? 0,
      targetValue: r.targetValue ?? 0,
      actualSystem: r.actualSystem,
      actualSelf: r.actualSelf,
      actualFinal: r.actualFinal,
      achievementPercent: r.achievementPercent,
      weightedScore: r.weightedScore,
      isCapped: r.isCapped,
      hasMismatch: r.hasMismatch,
      mismatchPercent: r.mismatchPercent,
      status: r.status,
      selfNote: r.selfNote,
      managerNote: r.managerNote,
      evidenceUrl: r.evidenceUrl,
    });
  }

  const groups = [...groupsMap.values()].map((g) => ({
    ...g,
    summary: summarizeResults(g.rows),
  }));

  const selfOpen = isSelfReviewOpen(period);
  const managerOpen = isManagerReviewOpen(period);

  return (
    <>
      <div className="mb-4">
        <Link href="/kpi" className="text-sm text-ink-500 hover:text-brand-600">
          ← KPI
        </Link>
      </div>

      <PageHeader
        title={`Bảng KPI ${period.name}`}
        subtitle={`${results.length} dòng chỉ tiêu · ${groups.length} nhân sự trong tầm quản lý của bạn`}
        actions={
          <div className="flex items-center gap-2">
            {can(user, "kpi.target.assign") && (
              <Link
                href={`/kpi/${period.id}/targets`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand-300 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100"
              >
                <Target size={15} strokeWidth={2} /> Đặt mục tiêu
              </Link>
            )}
            <PeriodStatusBadge status={period.status} />
          </div>
        }
      />

      {/* ---------- Đường thời gian 2-4-5 ---------- */}
      <div className="card mb-6 p-4">
        <div className="mb-3 text-xs font-semibold tracking-wide text-ink-500 uppercase">
          Lịch chốt kỳ
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Phase
            step="1"
            title="Nhân viên tự khai"
            deadline={formatDate(period.selfReviewDeadline)}
            active={period.status === "OPEN"}
            done={period.status !== "OPEN"}
          />
          <Phase
            step="2"
            title="Trưởng phòng duyệt"
            deadline={formatDate(period.managerReviewDeadline)}
            active={period.status === "SELF_LOCKED"}
            done={["MANAGER_LOCKED", "FINALIZED"].includes(period.status)}
          />
          <Phase
            step="3"
            title="Ban Giám đốc chốt & khoá"
            deadline={formatDate(period.ceoApprovalDeadline)}
            active={period.status === "MANAGER_LOCKED"}
            done={period.status === "FINALIZED"}
          />
        </div>
        {period.status === "FINALIZED" && (
          <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <Lock size={15} strokeWidth={2} className="mt-0.5 shrink-0" />
            Kỳ này đã chốt và khoá vĩnh viễn. Chỉ Ban Giám đốc mới sửa được,
            và mỗi lần sửa đều để lại dấu vết không xoá được trong nhật ký hệ
            thống.
          </div>
        )}
      </div>

      <KpiWorkTable
        periodId={period.id}
        periodStatus={period.status}
        role={user.role}
        currentUserId={user.id}
        selfOpen={selfOpen}
        managerOpen={managerOpen}
        groups={groups}
      />
    </>
  );
}

function Phase({
  step,
  title,
  deadline,
  active,
  done,
}: {
  step: string;
  title: string;
  deadline: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        active
          ? "border-brand-300 bg-brand-50"
          : done
            ? "border-emerald-200 bg-emerald-50/50"
            : "border-ink-200 bg-white"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
            done
              ? "bg-emerald-500 text-white"
              : active
                ? "bg-brand-600 text-white"
                : "bg-ink-200 text-ink-600"
          }`}
        >
          {done ? <Check size={14} strokeWidth={3} /> : step}
        </span>
        <span className="text-sm font-medium text-ink-800">{title}</span>
      </div>
      <div className="mt-1.5 pl-8 text-xs text-ink-500">Hạn {deadline}</div>
    </div>
  );
}
