import { formatVnDateTime, vnDate, vnParts } from "@/lib/vn-time";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleCheck, ChevronRight } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { round2, scoreStateOf, type ScoreState } from "@/lib/kpi";
import { getDeadlinePeriod } from "@/lib/services/period-service";
import { BLOCKED_ALERT_HOURS } from "@/lib/constants";
import {
  Badge,
  DueDate,
  PageHeader,
  ProgressBar,
  RiskBadge,
  ScoreBadge,
  StatCard,
  fmtScore,
  formatDate,
} from "@/components/ui";
import RunScanButton from "./run-scan-button";

export const dynamic = "force-dynamic";

const OPEN = ["BACKLOG", "TO_DO", "IN_PROGRESS", "BLOCKED", "REVIEW"];

export default async function CeoDashboard() {
  const user = (await requireSession())!;
  if (user.role !== "CEO") redirect("/dashboard");

  const now = new Date();
  const blockedCutoff = new Date(
    now.getTime() - BLOCKED_ALERT_HOURS * 3600_000
  );

  // Kỳ ĐANG TỚI HẠN, không phải kỳ mới nhất: ngày 1–5 Ban Giám đốc đang chốt
  // kỳ tháng trước (xem period-service). Lấy kỳ mới nhất thì trang này và
  // trang chủ nói về hai kỳ khác nhau.
  const period =
    (await getDeadlinePeriod(now)) ??
    (await prisma.kpiPeriod.findFirst({
      orderBy: [{ year: "desc" }, { month: "desc" }],
    }));

  const [
    openTasks,
    overdueTasks,
    criticalTasks,
    blockedLong,
    unassigned,
    doneThisMonth,
    mismatchRows,
    pendingCeo,
    departments,
  ] = await Promise.all([
    prisma.task.count({ where: { status: { in: OPEN } } }),
    prisma.task.count({
      where: { status: { in: OPEN }, dueDate: { lt: now } },
    }),
    prisma.task.findMany({
      where: { status: { in: OPEN }, riskScore: { gte: 80 } },
      include: { assignee: true, department: true },
      orderBy: { riskScore: "desc" },
      take: 10,
    }),
    prisma.task.findMany({
      where: { status: "BLOCKED", blockedSince: { lt: blockedCutoff } },
      include: { assignee: true, department: true },
      orderBy: { blockedSince: "asc" },
      take: 10,
    }),
    prisma.task.count({
      where: { status: { in: OPEN }, assigneeId: null },
    }),
    prisma.task.count({
      where: {
        status: "DONE",
        completedAt: { gte: vnDate(vnParts(now).year, vnParts(now).month, 1) },
      },
    }),
    period
      ? prisma.kpiResult.findMany({
          where: { periodId: period.id, hasMismatch: true },
          include: {
            employee: { include: { department: true } },
            kpiDefinition: true,
          },
          orderBy: { mismatchPercent: "desc" },
          take: 10,
        })
      : Promise.resolve([]),
    period
      ? prisma.kpiResult.count({
          where: { periodId: period.id, status: "MANAGER_REVIEWED" },
        })
      : Promise.resolve(0),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
  ]);

  // Ô KPI đang treo vì các nguồn số liệu đá nhau — chưa có số nào để chấm điểm
  const pendingRecon = await prisma.reconciliation.findMany({
    where: { status: "MISMATCH" },
    include: {
      employee: { include: { department: true } },
      kpiDefinition: true,
    },
    orderBy: { variancePercent: "desc" },
    take: 10,
  });

  // Hiệu suất từng phòng ban
  const deptStats = await Promise.all(
    departments.map(async (d) => {
      const [tasksOpen, tasksLate, tasksDone, results] = await Promise.all([
        prisma.task.count({
          where: { departmentId: d.id, status: { in: OPEN } },
        }),
        prisma.task.count({
          where: {
            departmentId: d.id,
            status: { in: OPEN },
            dueDate: { lt: now },
          },
        }),
        prisma.task.count({
          where: {
            departmentId: d.id,
            status: "DONE",
            completedAt: {
              gte: vnDate(vnParts(now).year, vnParts(now).month, 1),
            },
          },
        }),
        period
          ? prisma.kpiResult.findMany({
              where: {
                periodId: period.id,
                employee: { departmentId: d.id },
              },
              select: { weightedScore: true, employeeId: true, status: true },
            })
          : Promise.resolve([]),
      ]);

      // Điểm trung bình theo đầu người
      const perEmployee = new Map<string, number>();
      for (const r of results) {
        perEmployee.set(
          r.employeeId,
          (perEmployee.get(r.employeeId) ?? 0) + r.weightedScore
        );
      }
      const scores = [...perEmployee.values()];
      const avgScore = scores.length
        ? round2(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0;

      const state: ScoreState = scoreStateOf(period?.status, results);
      const selfReviewed = results.filter((r) => r.status !== "DRAFT").length;

      return {
        id: d.id,
        name: d.name,
        tasksOpen,
        tasksLate,
        tasksDone,
        headcount: perEmployee.size,
        avgScore,
        state,
        selfReviewed,
        totalRows: results.length,
      };
    })
  );

  // Kỳ đã chốt: phòng điểm thấp nhất lên đầu. Kỳ chưa chốt thì điểm chưa
  // có nghĩa — xếp theo việc trễ rồi tới phòng khai chậm nhất.
  const allFinal = deptStats.every((d) => d.headcount === 0 || d.state === "FINAL");
  const worstDepts = [...deptStats]
    .filter((d) => d.headcount > 0)
    .sort((a, b) =>
      allFinal
        ? a.avgScore - b.avgScore
        : b.tasksLate - a.tasksLate ||
          a.selfReviewed / Math.max(a.totalRows, 1) -
            b.selfReviewed / Math.max(b.totalRows, 1),
    );

  const exceptionCount =
    criticalTasks.length +
    blockedLong.length +
    mismatchRows.length +
    pendingRecon.length;

  return (
    <>
      <PageHeader
        title="Bảng điều hành Ban Giám đốc"
        subtitle="Chỉ hiển thị những mắt xích đang có vấn đề. Việc chạy đúng thì hệ thống im lặng."
        actions={<RunScanButton />}
      />

      {/* --------------- Chỉ số sinh tồn --------------- */}
      {/* Chỉ thẻ có ngoại lệ (> 0) mới mang vạch màu; bằng 0 là thẻ trắng. */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Cảnh báo cần xử lý"
          value={exceptionCount}
          tone={exceptionCount > 0 ? "red" : "slate"}
          surface={exceptionCount > 0 ? "red" : undefined}
          hint={exceptionCount > 0 ? "đang chờ can thiệp" : "không có ngoại lệ"}
        />
        <StatCard
          label="Việc trễ hạn"
          value={overdueTasks}
          tone={overdueTasks > 0 ? "red" : "slate"}
          surface={overdueTasks > 0 ? "red" : undefined}
          hint={`trên tổng ${openTasks} việc đang mở`}
          href="/tasks?filter=overdue"
        />
        <StatCard
          label="Việc chưa có người nhận"
          value={unassigned}
          tone={unassigned > 0 ? "amber" : "slate"}
          surface={unassigned > 0 ? "amber" : undefined}
          hint="cần phân công"
          href="/tasks"
        />
        <StatCard
          label="KPI chờ bạn chốt"
          value={pendingCeo}
          tone="slate"
          hint={period?.name ?? "chưa mở kỳ"}
          href={period ? `/kpi/${period.id}` : "/kpi"}
        />
      </div>

      {period && (
        <div className="card mb-6 flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <div className="text-sm font-semibold text-ink-900">
              Kỳ KPI {period.name}
            </div>
            <div className="mt-0.5 text-xs text-ink-500">
              Nhân viên khai đến {formatDate(period.selfReviewDeadline)} · Trưởng
              phòng đến {formatDate(period.managerReviewDeadline)} · Bạn chốt{" "}
              {formatDate(period.ceoApprovalDeadline)}
            </div>
          </div>
          <Link href={`/kpi/${period.id}`} className="btn-primary btn-sm">
            Mở bảng duyệt KPI <ChevronRight size={16} aria-hidden />
          </Link>
        </div>
      )}

      {/* --------------- Bảng ngoại lệ --------------- */}
      <section className="mb-8">
        <h2 className="section-title mb-3">
          Ngoại lệ cần can thiệp ({exceptionCount})
        </h2>

        {exceptionCount === 0 ? (
          <div className="card p-6 text-center">
            <div className="mb-1 flex justify-center text-leaf-600">
              <CircleCheck size={28} strokeWidth={1.75} aria-hidden />
            </div>
            <div className="font-medium text-ink-800">
              Không có mắt xích nào báo động
            </div>
            <div className="mt-1 text-sm text-ink-500">
              Không có việc báo động đỏ, không có việc tắc quá {BLOCKED_ALERT_HOURS}{" "}
              giờ, không có dòng KPI lệch số liệu.
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {criticalTasks.length > 0 && (
              <ExceptionBlock
                title={`Việc báo động đỏ (${criticalTasks.length})`}
                tone="red"
              >
                {criticalTasks.map((t) => (
                  <Link
                    key={t.id}
                    href={`/tasks/${t.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-3 last:border-0 hover:bg-red-50/40"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink-900">
                        {t.title}
                      </div>
                      <div className="mt-0.5 text-xs text-ink-500">
                        {t.department.name} ·{" "}
                        {t.assignee?.fullName ?? (
                          <span className="text-amber-800">chưa giao</span>
                        )}{" "}
                        ·{" "}
                        <DueDate date={t.dueDate} /> · {t.riskReason}
                      </div>
                    </div>
                    <RiskBadge score={t.riskScore} />
                  </Link>
                ))}
              </ExceptionBlock>
            )}

            {blockedLong.length > 0 && (
              <ExceptionBlock
                title={`Việc tắc quá ${BLOCKED_ALERT_HOURS} giờ (${blockedLong.length})`}
                tone="amber"
              >
                {blockedLong.map((t) => (
                  <Link
                    key={t.id}
                    href={`/tasks/${t.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-3 last:border-0 hover:bg-amber-50/40"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink-900">
                        {t.title}
                      </div>
                      <div className="mt-0.5 text-xs text-ink-500">
                        {t.department.name} ·{" "}
                        {t.assignee?.fullName ?? (
                          <span className="text-amber-800">chưa giao</span>
                        )}{" "}
                        · tắc từ{" "}
                        {t.blockedSince
                          ? formatVnDateTime(t.blockedSince)
                          : "—"}
                      </div>
                    </div>
                    <Badge tone="amber">Bị chặn</Badge>
                  </Link>
                ))}
              </ExceptionBlock>
            )}

            {pendingRecon.length > 0 && (
              <ExceptionBlock
                title={`Các nguồn số liệu đá nhau, đang treo chờ bạn quyết (${pendingRecon.length})`}
                tone="red"
              >
                <div className="border-b border-ink-100 bg-red-50/40 px-4 py-2 text-xs text-red-800">
                  Hệ thống <b>chưa ghi số nào</b> vào bảng điểm cho những ô này —
                  nó không tự chọn khi các nguồn không thống nhất.
                </div>
                {pendingRecon.map((r) => {
                  const sources: { label: string; value: number }[] = JSON.parse(
                    r.sourcesJson
                  );
                  return (
                    <Link
                      key={r.id}
                      href="/reconciliation"
                      className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-3 last:border-0 hover:bg-red-50/40"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-ink-900">
                          {r.employee.fullName} — {r.kpiDefinition.name}
                        </div>
                        <div className="mt-0.5 text-xs text-ink-500">
                          {r.employee.department?.name ?? "—"} ·{" "}
                          {sources
                            .map((s) => `${s.label}: ${fmt(s.value)}`)
                            .join(" · ")}
                        </div>
                      </div>
                      <Badge tone="red">Lệch {fmt(r.variancePercent)}%</Badge>
                    </Link>
                  );
                })}
              </ExceptionBlock>
            )}

            {mismatchRows.length > 0 && (
              <ExceptionBlock
                title={`Nhân viên khai lệch số hệ thống trên 5% (${mismatchRows.length})`}
                tone="red"
              >
                {mismatchRows.map((r) => (
                  <Link
                    key={r.id}
                    href={`/kpi/${r.periodId}`}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-3 last:border-0 hover:bg-red-50/40"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink-900">
                        {r.employee.fullName} — {r.kpiDefinition?.name ?? "—"}
                      </div>
                      <div className="mt-0.5 text-xs text-ink-500">
                        {r.employee.department?.name} · Số hệ thống{" "}
                        {fmt(r.actualSystem)} · Nhân viên khai{" "}
                        {fmt(r.actualSelf)}
                      </div>
                    </div>
                    <Badge tone="red">Lệch {fmt(r.mismatchPercent)}%</Badge>
                  </Link>
                ))}
              </ExceptionBlock>
            )}
          </div>
        )}
      </section>

      {/* --------------- Hiệu suất phòng ban --------------- */}
      <section>
        <h2 className="section-title mb-3">Hiệu suất theo phòng ban</h2>
        <div className="table-wrap">
          <table className="tbl tbl-stack">
            <thead>
              <tr>
                <th>Phòng ban</th>
                <th className="text-right">Nhân sự có KPI</th>
                <th className="text-right">Việc đang mở</th>
                <th className="text-right">Việc trễ</th>
                <th className="text-right">Xong trong tháng</th>
                <th className="w-48">
                  {allFinal ? "Điểm KPI trung bình" : "Tiến độ tự khai KPI"}
                </th>
                <th>Xếp loại</th>
              </tr>
            </thead>
            <tbody>
              {worstDepts.map((d) => {
                return (
                  <tr key={d.id}>
                    <td className="font-medium text-ink-800">{d.name}</td>
                    <td data-label="Nhân sự có KPI" className="text-right text-ink-600">{d.headcount}</td>
                    <td data-label="Việc đang mở" className="text-right text-ink-600">{d.tasksOpen}</td>
                    <td data-label="Việc trễ" className="text-right">
                      <span
                        className={
                          d.tasksLate > 0
                            ? "font-semibold text-red-700"
                            : "text-ink-600"
                        }
                      >
                        {d.tasksLate}
                      </span>
                    </td>
                    <td data-label="Xong trong tháng" className="text-right text-ink-600">{d.tasksDone}</td>
                    <td data-label={allFinal ? "Điểm TB" : "Tự khai"}>
                      {d.state === "FINAL" ? (
                        <>
                          <div className="mb-1 text-xs text-ink-600">
                            {fmtScore(d.avgScore)} / 100
                          </div>
                          <ProgressBar
                            value={(d.avgScore / 150) * 100}
                            tone={
                              d.avgScore >= 100
                                ? "green"
                                : d.avgScore >= 80
                                  ? "amber"
                                  : "red"
                            }
                          />
                        </>
                      ) : (
                        <>
                          <div className="mb-1 text-xs text-ink-600">
                            Đã tự khai {d.selfReviewed}/{d.totalRows} chỉ tiêu
                          </div>
                          <ProgressBar
                            value={(d.selfReviewed / Math.max(d.totalRows, 1)) * 100}
                            tone="brand"
                          />
                        </>
                      )}
                    </td>
                    <td data-label="Xếp loại">
                      <ScoreBadge score={d.avgScore} state={d.state} />
                    </td>
                  </tr>
                );
              })}
              {worstDepts.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-ink-400">
                    Chưa có dữ liệu KPI để so sánh giữa các phòng ban.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-500">
          {allFinal
            ? "Bảng xếp theo điểm KPI trung bình từ thấp lên cao — phòng ban đang yếu nhất nằm trên cùng."
            : "Kỳ chưa chốt nên chưa xếp loại — bảng xếp theo việc trễ, rồi tới phòng tự khai chậm nhất."}
        </p>
      </section>
    </>
  );
}

function ExceptionBlock({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "red" | "amber";
  children: React.ReactNode;
}) {
  return (
    <div className="card overflow-hidden">
      <div
        className={`border-b px-4 py-2.5 text-sm font-semibold ${
          tone === "red"
            ? "border-red-200 bg-red-50 text-red-800"
            : "border-amber-200 bg-amber-50 text-amber-800"
        }`}
      >
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n);
}
