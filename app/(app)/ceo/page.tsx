import { vnDate, vnParts } from "@/lib/vn-time";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleCheck, ChevronRight } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  isCountedKpiRow,
  round2,
  scoreStateOf,
  type ScoreState,
} from "@/lib/kpi";
import { getDeadlinePeriod } from "@/lib/services/period-service";
import { BLOCKED_ALERT_HOURS } from "@/lib/constants";
import { lateBucketRanges, urgencyTone } from "@/lib/urgency";
import {
  fmtDate,
  fmtDateTime,
  fmtDeadline,
  fmtNum,
  fmtPct,
  fmtScore,
} from "@/lib/format";
import {
  Badge,
  DueDate,
  PageHeader,
  ProgressBar,
  RiskBadge,
  ScoreBadge,
  ShowingCount,
  StatCard,
} from "@/components/ui";
import RunScanButton from "./run-scan-button";

export const dynamic = "force-dynamic";

const OPEN = ["BACKLOG", "TO_DO", "IN_PROGRESS", "BLOCKED", "REVIEW"];
/** Mỗi nhóm ngoại lệ nêu tên tối đa chừng này dòng, còn lại báo tổng */
const EXCEPTION_LIMIT = 10;
/** Mỗi nhóm trễ (trên 1 tuần, 3–7 ngày…) nêu tên tối đa chừng này việc */
const OVERDUE_PER_BUCKET = 5;

export default async function CeoDashboard() {
  const user = (await requireSession())!;
  if (user.role !== "CEO") redirect("/dashboard");

  const now = new Date();
  const blockedCutoff = new Date(
    now.getTime() - BLOCKED_ALERT_HOURS * 3600_000
  );
  const vn = vnParts(now);
  const monthStart = vnDate(vn.year, vn.month, 1);

  // Kỳ ĐANG TỚI HẠN, không phải kỳ mới nhất: ngày 1–5 Ban Giám đốc đang chốt
  // kỳ tháng trước (xem period-service). Lấy kỳ mới nhất thì trang này và
  // trang chủ nói về hai kỳ khác nhau.
  const period =
    (await getDeadlinePeriod(now)) ??
    (await prisma.kpiPeriod.findFirst({
      orderBy: [{ year: "desc" }, { month: "desc" }],
    }));

  const openWhere = { status: { in: OPEN } };
  const overdueWhere = { ...openWhere, dueDate: { lt: now } };
  const criticalWhere = { ...openWhere, riskScore: { gte: 80 } };
  const blockedWhere = {
    status: "BLOCKED",
    blockedSince: { lt: blockedCutoff },
  };
  const mismatchWhere = period
    ? { periodId: period.id, hasMismatch: true }
    : null;
  const reconWhere = { status: "MISMATCH" };

  // Việc quá hạn chia nhóm theo độ trễ — mỗi nhóm đếm và lấy bằng truy vấn
  // riêng, để số trên tiêu đề nhóm là số thật chứ không phải số dòng còn sót
  // lại sau khi danh sách bị cắt.
  const buckets = lateBucketRanges(now);
  const bucketWhere = (b: (typeof buckets)[number]) => ({
    ...openWhere,
    dueDate: b.gte ? { gte: b.gte, lt: b.lt } : { lt: b.lt },
  });

  const [
    openTasks,
    overdueCount,
    exceptionTaskCount,
    criticalTasks,
    criticalCount,
    blockedLong,
    blockedCount,
    unassigned,
    mismatchRows,
    mismatchCount,
    pendingRecon,
    reconCount,
    pendingCeo,
    departments,
    deptOpen,
    deptLate,
    deptDone,
    periodRows,
    anomalyOpen,
    anomalyExplained,
    periodReconCount,
    bucketTasks,
    bucketCounts,
  ] = await Promise.all([
    prisma.task.count({ where: openWhere }),
    prisma.task.count({ where: overdueWhere }),
    // Việc vừa báo động đỏ vừa tắc lâu chỉ đếm một lần
    prisma.task.count({ where: { OR: [criticalWhere, blockedWhere] } }),
    prisma.task.findMany({
      where: criticalWhere,
      include: { assignee: true, department: true },
      orderBy: { riskScore: "desc" },
      take: EXCEPTION_LIMIT,
    }),
    prisma.task.count({ where: criticalWhere }),
    prisma.task.findMany({
      where: blockedWhere,
      include: { assignee: true, department: true },
      orderBy: { blockedSince: "asc" },
      take: EXCEPTION_LIMIT,
    }),
    prisma.task.count({ where: blockedWhere }),
    prisma.task.count({ where: { ...openWhere, assigneeId: null } }),
    mismatchWhere
      ? prisma.kpiResult.findMany({
          where: mismatchWhere,
          include: {
            employee: { include: { department: true } },
            kpiDefinition: true,
          },
          orderBy: { mismatchPercent: "desc" },
          take: EXCEPTION_LIMIT,
        })
      : Promise.resolve([]),
    mismatchWhere
      ? prisma.kpiResult.count({ where: mismatchWhere })
      : Promise.resolve(0),
    // Ô KPI đang treo vì các nguồn số liệu đá nhau — chưa có số nào để chấm điểm
    prisma.reconciliation.findMany({
      where: reconWhere,
      include: {
        employee: { include: { department: true } },
        kpiDefinition: true,
      },
      orderBy: { variancePercent: "desc" },
      take: EXCEPTION_LIMIT,
    }),
    prisma.reconciliation.count({ where: reconWhere }),
    period
      ? prisma.kpiResult.count({
          where: { periodId: period.id, status: "MANAGER_REVIEWED" },
        })
      : Promise.resolve(0),
    prisma.department.findMany({ orderBy: { name: "asc" } }),

    // Số việc từng phòng: ba lượt groupBy thay cho 3 truy vấn × số phòng ban
    prisma.task.groupBy({
      by: ["departmentId"],
      where: openWhere,
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ["departmentId"],
      where: overdueWhere,
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ["departmentId"],
      where: { status: "DONE", completedAt: { gte: monthStart } },
      _count: { _all: true },
    }),

    // Mọi dòng KPI của kỳ, một lượt — vừa nuôi bảng phòng ban, vừa đếm các
    // ngoại lệ chặn chốt kỳ (chưa tự khai, trưởng phòng chưa duyệt).
    period
      ? prisma.kpiResult.findMany({
          where: { periodId: period.id },
          select: {
            employeeId: true,
            weightedScore: true,
            weightPercent: true,
            status: true,
            kpiDefinition: { select: { isActive: true } },
            employee: { select: { departmentId: true } },
          },
        })
      : Promise.resolve([]),
    period
      ? prisma.kpiAnomaly.count({
          where: { periodId: period.id, status: "OPEN" },
        })
      : Promise.resolve(0),
    period
      ? prisma.kpiAnomaly.count({
          where: { periodId: period.id, status: "EXPLAINED" },
        })
      : Promise.resolve(0),
    period
      ? prisma.reconciliation.count({
          where: { periodId: period.id, status: "MISMATCH" },
        })
      : Promise.resolve(0),

    Promise.all(
      buckets.map((b) =>
        prisma.task.findMany({
          where: bucketWhere(b),
          include: {
            assignee: { select: { fullName: true } },
            department: { select: { name: true } },
          },
          orderBy: { dueDate: "asc" },
          take: OVERDUE_PER_BUCKET,
        })
      )
    ),
    Promise.all(
      buckets.map((b) => prisma.task.count({ where: bucketWhere(b) }))
    ),
  ]);

  /* ------------------------------------------------ hiệu suất phòng ban */

  const countMap = (rows: { departmentId: string; _count: { _all: number } }[]) =>
    new Map(rows.map((r) => [r.departmentId, r._count._all]));
  const openBy = countMap(deptOpen);
  const lateBy = countMap(deptLate);
  const doneBy = countMap(deptDone);

  // Bỏ chỉ tiêu đã ngưng dùng, trọng số 0 — đếm giống hệt trang KPI
  const counted = periodRows.filter(isCountedKpiRow);
  const rowsByDept = new Map<string, typeof counted>();
  for (const r of counted) {
    const k = r.employee.departmentId ?? "__none__";
    rowsByDept.set(k, [...(rowsByDept.get(k) ?? []), r]);
  }

  const deptStats = departments.map((d) => {
    const results = rowsByDept.get(d.id) ?? [];

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
      tasksOpen: openBy.get(d.id) ?? 0,
      tasksLate: lateBy.get(d.id) ?? 0,
      tasksDone: doneBy.get(d.id) ?? 0,
      headcount: perEmployee.size,
      avgScore,
      state,
      selfReviewed,
      totalRows: results.length,
    };
  });

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

  /* ------------------------------------------------ chặn chốt kỳ */

  const draftRows = counted.filter((r) => r.status === "DRAFT");
  const draftPeople = new Set(draftRows.map((r) => r.employeeId)).size;
  const waitingManager = counted.filter((r) => r.status === "SELF_REVIEWED");
  const waitingDepts = new Set(
    waitingManager.map((r) => r.employee.departmentId ?? "__none__")
  ).size;

  const closing =
    period && period.status !== "FINALIZED"
      ? ([
          {
            key: "self",
            label: "Nhân viên chưa tự khai",
            count: draftRows.length,
            detail: `${fmtNum(draftPeople)} người · ${fmtNum(draftRows.length)} chỉ tiêu`,
            deadline: period.selfReviewDeadline,
            afterDeadline: "đã khoá, chỉ tiêu chưa khai tính 0",
            href: `/kpi/${period.id}`,
            cta: "Mở bảng KPI",
          },
          {
            key: "manager",
            label: "Trưởng phòng chưa duyệt",
            count: waitingManager.length,
            detail: `${fmtNum(waitingManager.length)} chỉ tiêu · ${fmtNum(waitingDepts)} phòng`,
            deadline: period.managerReviewDeadline,
            afterDeadline: "đã khoá, đẩy lên bạn ở trạng thái chưa duyệt",
            href: `/kpi/${period.id}`,
            cta: "Mở bảng KPI",
          },
          {
            key: "anomaly",
            label: "Bất thường chưa giải trình",
            count: anomalyOpen,
            detail: `${fmtNum(anomalyOpen)} chỉ tiêu${
              anomalyExplained > 0
                ? ` · ${fmtNum(anomalyExplained)} đã giải trình, chờ bạn quyết`
                : ""
            }`,
            deadline: period.ceoApprovalDeadline,
            afterDeadline: "kỳ đang treo",
            href: "/analytics",
            cta: "Mở Phân tích",
          },
          {
            key: "recon",
            label: "Nguồn số liệu lệch chưa quyết",
            count: periodReconCount,
            detail: `${fmtNum(periodReconCount)} ô KPI chưa có số`,
            deadline: period.ceoApprovalDeadline,
            afterDeadline: "kỳ đang treo",
            href: "/reconciliation",
            cta: "Đối soát",
          },
        ] as const)
      : null;
  const closingOpen = closing?.filter((c) => c.count > 0).length ?? 0;

  const exceptionCount = exceptionTaskCount + mismatchCount + reconCount;
  const bucketGroups = buckets
    .map((b, i) => ({ ...b, tasks: bucketTasks[i], total: bucketCounts[i] }))
    .filter((g) => g.total > 0);

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
          value={fmtNum(exceptionCount)}
          tone={exceptionCount > 0 ? "red" : "slate"}
          surface={exceptionCount > 0 ? "red" : undefined}
          hint={exceptionCount > 0 ? "đang chờ can thiệp" : "không có ngoại lệ"}
        />
        <StatCard
          label="Việc trễ hạn"
          value={fmtNum(overdueCount)}
          tone={overdueCount > 0 ? "red" : "slate"}
          surface={overdueCount > 0 ? "red" : undefined}
          hint={`trên tổng ${fmtNum(openTasks)} việc đang mở`}
          href="/tasks?filter=overdue"
        />
        <StatCard
          label="Việc chưa có người nhận"
          value={fmtNum(unassigned)}
          tone={unassigned > 0 ? "amber" : "slate"}
          surface={unassigned > 0 ? "amber" : undefined}
          hint="cần phân công"
          href="/tasks"
        />
        <StatCard
          label="KPI chờ bạn chốt"
          value={fmtNum(pendingCeo)}
          tone="slate"
          hint={period?.name ?? "chưa mở kỳ"}
          href={period ? `/kpi/${period.id}` : "/kpi"}
        />
      </div>

      {/* --------------- Chặn chốt kỳ --------------- */}
      {period && (
        <section className="card mb-6 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 p-4">
            <div>
              <h2 className="text-sm font-semibold text-ink-900">
                Kỳ KPI {period.name}
                {closing &&
                  (closingOpen > 0
                    ? ` · ${closingOpen} việc đang chặn chốt kỳ`
                    : " · sẵn sàng chốt")}
                {!closing && " · đã chốt"}
              </h2>
              <div className="mt-0.5 text-xs text-ink-500">
                Nhân viên khai đến {fmtDate(period.selfReviewDeadline)} · Trưởng
                phòng đến {fmtDate(period.managerReviewDeadline)} · Bạn chốt{" "}
                {fmtDate(period.ceoApprovalDeadline)}
              </div>
            </div>
            <Link href={`/kpi/${period.id}`} className="btn-primary btn-sm">
              Mở bảng duyệt KPI <ChevronRight size={16} aria-hidden />
            </Link>
          </div>

          {closing && (
            <ul className="divide-y divide-ink-100">
              {closing.map((c) => {
                const dl = fmtDeadline(c.deadline, { now });
                const passed = dl.late;
                const tone =
                  c.count === 0
                    ? "done"
                    : passed
                      ? "red"
                      : urgencyTone(c.deadline, now);
                return (
                  <li key={c.key}>
                    <Link
                      href={c.href}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-ink-50"
                    >
                      <div className="flex min-w-0 items-start gap-2.5">
                        {c.count === 0 ? (
                          <CircleCheck
                            size={16}
                            strokeWidth={2}
                            className="mt-0.5 shrink-0 text-leaf-600"
                            aria-hidden
                          />
                        ) : (
                          <span
                            aria-hidden
                            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                              tone === "red"
                                ? "bg-red-500"
                                : tone === "amber"
                                  ? "bg-amber-500"
                                  : "bg-brand-500"
                            }`}
                          />
                        )}
                        <div className="min-w-0">
                          <div
                            className={`text-sm font-medium ${
                              c.count === 0 ? "text-ink-500" : "text-ink-900"
                            }`}
                          >
                            {c.label}
                            {c.count > 0 && (
                              <span
                                className={`ml-1.5 tabular-nums ${
                                  tone === "red"
                                    ? "text-red-700"
                                    : tone === "amber"
                                      ? "text-amber-800"
                                      : "text-ink-700"
                                }`}
                              >
                                {fmtNum(c.count)}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-xs text-ink-500">
                            {c.count === 0 ? (
                              "Không còn dòng nào"
                            ) : (
                              <>
                                {c.detail} · hạn {dl.date}{" "}
                                <span
                                  className={
                                    passed ? "font-medium text-red-700" : ""
                                  }
                                >
                                  ({passed ? c.afterDeadline : dl.relative})
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      {c.count > 0 && (
                        <span className="text-xs font-medium text-brand-600">
                          {c.cta} →
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* --------------- Việc quá hạn, nhóm theo độ trễ --------------- */}
      {overdueCount > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="section-title">
              Quá hạn ({fmtNum(overdueCount)})
            </h2>
            <Link
              href="/tasks?filter=overdue"
              className="text-xs font-medium text-brand-600 hover:underline"
            >
              Xem tất cả →
            </Link>
          </div>
          <div className="space-y-4">
            {bucketGroups.map((g) => (
              <ExceptionBlock
                key={g.key}
                title={`${g.label} (${fmtNum(g.total)})`}
                tone={g.key === "week" || g.key === "several" ? "red" : "amber"}
              >
                {g.tasks.map((t) => {
                  const dl = fmtDeadline(t.dueDate, { now });
                  return (
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
                          {t.code} · {t.department.name} ·{" "}
                          {t.assignee?.fullName ?? (
                            <span className="text-amber-800">chưa giao</span>
                          )}{" "}
                          · tiến độ {t.progress}%
                        </div>
                      </div>
                      <span className="text-right text-xs">
                        <span className="block font-semibold text-red-700">
                          {dl.relative}
                        </span>
                        <span className="text-ink-500">hạn {dl.date}</span>
                      </span>
                    </Link>
                  );
                })}
                {g.total > g.tasks.length && (
                  <div className="px-4 pb-3">
                    <ShowingCount
                      shown={g.tasks.length}
                      total={g.total}
                      hint="trễ lâu nhất trước"
                    />
                  </div>
                )}
              </ExceptionBlock>
            ))}
          </div>
        </section>
      )}

      {/* --------------- Bảng ngoại lệ --------------- */}
      <section className="mb-8">
        <h2 className="section-title mb-3">
          Ngoại lệ cần can thiệp ({fmtNum(exceptionCount)})
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
            {criticalCount > 0 && (
              <ExceptionBlock
                title={`Việc báo động đỏ (${fmtNum(criticalCount)})`}
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
                <BlockMore shown={criticalTasks.length} total={criticalCount} />
              </ExceptionBlock>
            )}

            {blockedCount > 0 && (
              <ExceptionBlock
                title={`Việc tắc quá ${BLOCKED_ALERT_HOURS} giờ (${fmtNum(blockedCount)})`}
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
                        · tắc từ {fmtDateTime(t.blockedSince)}
                      </div>
                    </div>
                    <Badge tone="amber">Bị chặn</Badge>
                  </Link>
                ))}
                <BlockMore shown={blockedLong.length} total={blockedCount} />
              </ExceptionBlock>
            )}

            {reconCount > 0 && (
              <ExceptionBlock
                title={`Các nguồn số liệu đá nhau, đang treo chờ bạn quyết (${fmtNum(reconCount)})`}
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
                            .map((s) => `${s.label}: ${fmtNum(s.value)}`)
                            .join(" · ")}
                        </div>
                      </div>
                      <Badge tone="red">Lệch {fmtPct(r.variancePercent)}</Badge>
                    </Link>
                  );
                })}
                <BlockMore shown={pendingRecon.length} total={reconCount} />
              </ExceptionBlock>
            )}

            {mismatchCount > 0 && (
              <ExceptionBlock
                title={`Nhân viên khai lệch số hệ thống trên 5% (${fmtNum(mismatchCount)})`}
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
                        {fmtNum(r.actualSystem)} · Nhân viên khai{" "}
                        {fmtNum(r.actualSelf)}
                      </div>
                    </div>
                    <Badge tone="red">
                      Lệch {fmtPct(r.mismatchPercent, { signed: true })}
                    </Badge>
                  </Link>
                ))}
                <BlockMore shown={mismatchRows.length} total={mismatchCount} />
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
                    <td data-label="Nhân sự có KPI" className="text-right text-ink-600">{fmtNum(d.headcount)}</td>
                    <td data-label="Việc đang mở" className="text-right text-ink-600">{fmtNum(d.tasksOpen)}</td>
                    <td data-label="Việc trễ" className="text-right">
                      <span
                        className={
                          d.tasksLate > 0
                            ? "font-semibold text-red-700"
                            : "text-ink-600"
                        }
                      >
                        {fmtNum(d.tasksLate)}
                      </span>
                    </td>
                    <td data-label="Xong trong tháng" className="text-right text-ink-600">{fmtNum(d.tasksDone)}</td>
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

/** "Đang hiển thị 10/37" cuối một khối ngoại lệ bị cắt */
function BlockMore({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null;
  return (
    <div className="px-4 pb-3">
      <ShowingCount shown={shown} total={total} hint="nặng nhất trước" />
    </div>
  );
}
