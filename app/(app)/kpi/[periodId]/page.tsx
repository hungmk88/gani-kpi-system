import Link from "next/link";
import { notFound } from "next/navigation";
import { Target, Lock, Check } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can, kpiScopeWhere } from "@/lib/rbac";
import {
  isManagerReviewOpen,
  isSelfReviewOpen,
  isCountedKpiRow,
  gatekeeperRuleFor,
  kpiCapFor,
  summarizeResults,
} from "@/lib/kpi";
import { PageHeader, PeriodStatusBadge } from "@/components/ui";
import { fmtDeadline } from "@/lib/format";
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

  const [results, openRecon] = await Promise.all([
    prisma.kpiResult.findMany({
      where: { periodId, ...kpiScopeWhere(user) },
      include: {
        // Phòng của CHỈ TIÊU quyết định trần (Sales 120%) — xem kpiCapFor
        kpiDefinition: { include: { department: true } },
        employee: { include: { department: true } },
      },
      orderBy: [{ employee: { fullName: "asc" } }, { weightPercent: "desc" }],
    }),
    // Ô đối soát còn treo (MISMATCH chưa ai chốt) — đúng thứ máy chủ dùng để
    // chặn chốt KPI. Bảng làm việc phải theo cờ này, không theo hasMismatch.
    prisma.reconciliation.findMany({
      where: { periodId, status: "MISMATCH", ...kpiScopeWhere(user) },
      select: { employeeId: true, kpiDefinitionId: true },
    }),
  ]);
  const openReconKeys = new Set(
    openRecon.map((x) => `${x.employeeId}|${x.kpiDefinitionId}`)
  );

  // Gom theo nhân sự
  const groupsMap = new Map<
    string,
    {
      employeeId: string;
      employeeName: string;
      employeeEmail: string;
      employeeCode: string | null;
      employeeRole: string;
      jobTitle: string;
      departmentName: string;
      rows: KpiRow[];
    }
  >();

  for (const r of results) {
    // Chỉ tiêu đã ngưng dùng, trọng số 0: không tính điểm, không cần khai —
    // hiện ra chỉ làm nhiễu bảng và đội số "chưa khai" lên.
    if (!isCountedKpiRow(r)) continue;
    const key = r.employeeId;
    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        employeeId: r.employeeId,
        employeeName: r.employee.fullName,
        employeeEmail: r.employee.email,
        employeeCode: r.employee.employeeCode,
        employeeRole: r.employee.role,
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
      cap: kpiCapFor(r.kpiDefinition?.department?.code),
      gatekeeper: gatekeeperRuleFor(r.kpiDefinition?.code),
      hasMismatch: r.hasMismatch,
      reconMismatch: openReconKeys.has(`${r.employeeId}|${r.kpiDefinitionId}`),
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
  const rowCount = groups.reduce((n, g) => n + g.rows.length, 0);

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
        subtitle={`${rowCount} dòng chỉ tiêu · ${groups.length} nhân sự trong tầm quản lý của bạn`}
        actions={
          <div className="flex items-center gap-2">
            {can(user, "kpi.target.assign") && (
              <Link
                href={`/kpi/${period.id}/targets`}
                className="btn-ghost btn-sm"
              >
                <Target size={16} strokeWidth={2} />{" "}
                {/* Kỳ đã chốt thì mục tiêu chỉ còn để xem */}
                {period.status === "FINALIZED" ? "Xem mục tiêu" : "Đặt mục tiêu"}
              </Link>
            )}
            <PeriodStatusBadge status={period.status} />
          </div>
        }
      />

      {/* ---------- Đường thời gian 2-4-5 ---------- */}
      <div className="card mb-6 p-4">
        <div className="mb-3 text-sm font-semibold text-ink-800">
          Lịch chốt kỳ
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Phase
            step="1"
            title="Nhân viên tự khai"
            deadline={period.selfReviewDeadline}
            active={period.status === "OPEN"}
            done={period.status !== "OPEN"}
          />
          <Phase
            step="2"
            title="Trưởng phòng duyệt"
            deadline={period.managerReviewDeadline}
            active={period.status === "SELF_LOCKED"}
            done={["MANAGER_LOCKED", "FINALIZED"].includes(period.status)}
          />
          <Phase
            step="3"
            title="Ban Giám đốc chốt & khoá"
            deadline={period.ceoApprovalDeadline}
            active={period.status === "MANAGER_LOCKED"}
            done={period.status === "FINALIZED"}
          />
        </div>
        {period.status === "FINALIZED" && (
          <div className="mt-3 flex items-start gap-1.5 rounded-md bg-ink-50 px-3 py-2 text-sm text-ink-700">
            <Lock size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-ink-500" />
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
  deadline: Date;
  active: boolean;
  done: boolean;
}) {
  // Bước đang mở thì ghi thêm còn bao lâu ("còn 2 ngày", "trễ 1 ngày")
  const d = fmtDeadline(deadline, { done: !active });
  return (
    // Ô bên trong thẻ: nền ink-50, không viền (tránh thẻ lồng thẻ). Bước
    // đang mở chỉ được đánh dấu bằng vạch xanh thương hiệu bên trái.
    <div
      className={`rounded-md border-l-[3px] bg-ink-50 p-3 ${
        active ? "border-brand-600" : "border-transparent"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
            done
              ? "bg-leaf-600 text-white"
              : active
                ? "bg-brand-600 text-white"
                : "bg-ink-200 text-ink-600"
          }`}
        >
          {done ? <Check size={14} strokeWidth={3} /> : step}
        </span>
        <span className="text-sm font-medium text-ink-800">{title}</span>
      </div>
      <div className="mt-1.5 pl-8 text-xs text-ink-500">
        Hạn {d.date}
        {d.relative && (
          <span className={d.late ? "font-medium text-red-700" : "text-ink-700"}>
            {" "}· {d.relative}
          </span>
        )}
      </div>
    </div>
  );
}
