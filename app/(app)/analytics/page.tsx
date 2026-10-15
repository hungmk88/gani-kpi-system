import { redirect } from "next/navigation";
import Link from "next/link";
import { TriangleAlert, CircleCheck } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  buildHealthSnapshot,
  getCapacityReports,
  getPredictionAccuracy,
  runPredictiveScan,
} from "@/lib/services/analytics-service";
import {
  ANOMALY_SEVERITY_LABEL,
  ANOMALY_STATUS_LABEL,
  CONFIDENCE_LABEL,
  RISK_CATEGORY_LABEL,
  WORKLOAD_LABEL,
} from "@/lib/analytics/constants";
import {
  Badge,
  PageHeader,
  ProgressBar,
  ShowingCount,
  StatCard,
} from "@/components/ui";
import { fmtDate, fmtDateTime, fmtDeadline, fmtNum, fmtPct } from "@/lib/format";
import BriefingPanel from "./briefing-panel";
import AnomalyActions from "@/components/anomaly-actions";
import { plainAnomalyReason } from "@/components/dashboard";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = (await requireSession())!;
  if (user.role !== "CEO" && user.role !== "MANAGER") redirect("/dashboard");
  // Bảng tải nhân sự: mặc định chỉ người quá tải (?tai=all để xem cả bảng)
  const showAllWorkload = (await searchParams).tai === "all";

  const isCeo = user.role === "CEO";
  const departmentId = isCeo ? null : (user.departmentId ?? "__none__");

  const now = new Date();
  const overdueWhere = {
    status: { in: ["TO_DO", "IN_PROGRESS", "BLOCKED", "REVIEW", "BACKLOG"] },
    dueDate: { lt: now },
    ...(departmentId ? { departmentId } : {}),
  };
  const anomalyWhere = {
    status: { in: ["OPEN", "EXPLAINED"] },
    ...(isCeo
      ? {}
      : { employee: { departmentId: user.departmentId ?? "__none__" } }),
  };
  const [
    scan,
    capacity,
    accuracy,
    snapshot,
    anomalies,
    anomalyCount,
    overdue,
    overdueCount,
  ] = await Promise.all([
    runPredictiveScan({ departmentId, persist: false }),
    getCapacityReports(departmentId),
    getPredictionAccuracy(),
    isCeo ? buildHealthSnapshot() : Promise.resolve(null),
    prisma.kpiAnomaly.findMany({
      where: anomalyWhere,
      include: {
        employee: { include: { department: true } },
        kpiDefinition: true,
        period: true,
        explainedBy: true,
      },
      orderBy: [{ severity: "desc" }, { robustScore: "desc" }],
      take: 20,
    }),
    prisma.kpiAnomaly.count({ where: anomalyWhere }),
    // Việc ĐÃ trễ không còn là chuyện dự báo — tách nhóm riêng, cũ nhất trước
    prisma.task.findMany({
      where: overdueWhere,
      include: { assignee: { select: { fullName: true } } },
      orderBy: { dueDate: "asc" },
      take: 10,
    }),
    prisma.task.count({ where: overdueWhere }),
  ]);

  const atRisk = scan.predictions.filter((p) => p.riskCategory !== "ON_TRACK").length;
  const overloaded = capacity.reports.filter((r) => r.workloadStatus === "OVERLOADED");
  const workloadRows = showAllWorkload ? capacity.reports : overloaded;

  return (
    <>
      <PageHeader
        title="Phân tích &amp; dự báo"
        subtitle={
          isCeo
            ? "Toàn công ty. Mọi con số ở đây đều kèm nền dữ liệu của nó — thiếu nền thì hệ thống nói thẳng là chưa đủ căn cứ."
            : `Phòng ${user.departmentName ?? ""}. Mọi con số đều kèm nền dữ liệu của nó.`
        }
      />

      {/* ============ CẢNH BÁO NỀN DỮ LIỆU ============ */}
      {accuracy.total === 0 && (
        <div className="card mb-6 border-amber-300 bg-amber-50/60 p-4">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-amber-900">
            <TriangleAlert size={16} strokeWidth={2} /> Bộ dự báo chưa được đo lần nào
          </div>
          <p className="text-sm text-amber-900">
            Chưa có việc nào đóng lại sau khi được dự báo, nên chưa biết hệ thống
            đoán đúng bao nhiêu phần. Hãy đọc phần dự báo bên dưới như một{" "}
            <b>cảnh báo sớm</b>, chưa phải một con số đã kiểm chứng. Sau vài tuần
            chạy thật, hệ thống sẽ tự báo tỷ lệ đúng của chính nó ngay tại đây.
          </p>
        </div>
      )}

      {isCeo && snapshot && (
        <BriefingPanel
          health={snapshot.health}
          accuracy={accuracy}
        />
      )}

      {/* ============ 1. DỰ BÁO ============ */}
      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title">
            1. Dự báo nguy cơ vỡ kế hoạch
          </h2>
          <span className="text-xs text-ink-500">
            {accuracy.accuracyPercent === null
              ? "chưa đo được độ chính xác"
              : `độ chính xác ${fmtPct(accuracy.accuracyPercent)} trên ${fmtNum(accuracy.total)} việc đã đóng`}
          </span>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Nhiều khả năng vỡ"
            value={scan.highRisk}
            tone={scan.highRisk > 0 ? "red" : "slate"}
            hint="dưới 40% khả năng kịp"
          />
          <StatCard
            label="Có nguy cơ"
            value={scan.moderateRisk}
            tone={scan.moderateRisk > 0 ? "amber" : "slate"}
            hint="40–70% khả năng kịp"
          />
          <StatCard
            label="Đang theo dõi"
            value={scan.scanned}
            hint="việc tới hạn trong 30 ngày"
          />
          <StatCard
            label="Dự báo nền mỏng"
            value={scan.weakBasis}
            tone={scan.weakBasis > 0 ? "amber" : "slate"}
            hint="chưa đủ lịch sử người phụ trách"
          />
        </div>

        {overdueCount > 0 && (
          <div className="card mb-4 border-red-200 p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="font-semibold text-red-700">
                Đã trễ hạn ({fmtNum(overdueCount)}) — không còn là dự báo
              </div>
              <Link
                href="/tasks?filter=overdue"
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                Xem tất cả →
              </Link>
            </div>
            <ul className="divide-y divide-ink-100">
              {overdue.map((t) => {
                const due = fmtDeadline(t.dueDate, { now });
                return (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                    <Link
                      href={`/tasks/${t.id}`}
                      className="min-w-0 text-sm text-ink-800 hover:text-brand-700"
                    >
                      <span className="block truncate font-medium">{t.title}</span>
                      <span className="text-xs text-ink-500">
                        {t.code} · {t.assignee?.fullName ?? "chưa giao"} · tiến độ{" "}
                        {t.progress}%
                      </span>
                    </Link>
                    <span
                      className="shrink-0 text-right text-xs font-semibold text-red-700"
                      title={`Hạn ${due.date}`}
                    >
                      {due.relative}
                    </span>
                  </li>
                );
              })}
            </ul>
            <ShowingCount
              shown={overdue.length}
              total={overdueCount}
              hint="cũ nhất trước"
            />
          </div>
        )}

        {scan.predictions.length === 0 ? (
          <div className="card p-6 text-center text-ink-500">
            Không có việc nào tới hạn trong 30 ngày tới.
          </div>
        ) : (
          <div className="space-y-2">
            {scan.predictions
              .filter((p) => p.riskCategory !== "ON_TRACK")
              .slice(0, 12)
              .map((p) => (
                <div
                  key={p.taskId}
                  className={`card p-4 ${
                    p.riskCategory === "HIGH_FAILURE_RISK"
                      ? "border-red-200"
                      : "border-amber-200"
                  }`}
                >
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/tasks/${p.taskId}`}
                        className="font-medium text-ink-900 hover:text-brand-700"
                      >
                        {p.taskTitle}
                      </Link>
                      <div className="mt-0.5 text-xs text-ink-500">
                        {p.departmentName} · {p.assigneeName ?? "chưa giao"} ·
                        hạn {fmtDate(p.dueDate)}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        tone={
                          p.riskCategory === "HIGH_FAILURE_RISK"
                            ? "red"
                            : "amber"
                        }
                      >
                        {RISK_CATEGORY_LABEL[p.riskCategory]}
                      </Badge>
                      <Badge tone="slate">
                        {fmtPct(p.completionProbabilityPercent)} kịp
                      </Badge>
                      {p.projectedDelayDays > 0 && (
                        <Badge tone="red">
                          dự kiến trễ {p.projectedDelayDays} ngày
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="mb-2 grid gap-2 sm:grid-cols-2">
                    <div>
                      <div className="mb-1 flex justify-between text-xs text-ink-500">
                        <span>Đáng lẽ phải xong</span>
                        <span className="tabular-nums">{fmtPct(p.expectedProgressPercent)}</span>
                      </div>
                      <ProgressBar value={p.expectedProgressPercent} tone="brand" />
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between text-xs text-ink-500">
                        <span>Thực tế</span>
                        <span className="tabular-nums">{fmtPct(p.actualProgressPercent)}</span>
                      </div>
                      <ProgressBar
                        value={p.actualProgressPercent}
                        tone={
                          p.actualProgressPercent >= p.expectedProgressPercent
                            ? "green"
                            : "red"
                        }
                      />
                    </div>
                  </div>

                  <ul className="list-inside list-disc space-y-0.5 text-xs text-ink-600">
                    {p.predictiveFactors.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>

                  <div className="mt-2 text-xs text-ink-500">
                    Nền dữ liệu: {CONFIDENCE_LABEL[p.confidence]} ·{" "}
                    {p.sampleSize} việc đã đóng của người phụ trách
                  </div>
                </div>
              ))}
            {scan.predictions.filter((p) => p.riskCategory !== "ON_TRACK")
              .length === 0 && (
              <div className="card p-6 text-center">
                <div className="mb-1 flex justify-center text-leaf-600">
                  <CircleCheck size={28} strokeWidth={1.75} aria-hidden />
                </div>
                <div className="font-medium text-ink-800">
                  Không có việc nào đang bị dự báo trễ
                </div>
                <div className="mt-1 text-sm text-ink-500">
                  Cả {fmtNum(scan.scanned)} việc tới hạn trong 30 ngày đều đang bám kế hoạch.
                </div>
              </div>
            )}
            <ShowingCount
              shown={Math.min(12, atRisk)}
              total={atRisk}
              hint="việc nguy cơ cao nhất trước"
            />
          </div>
        )}

        {accuracy.total > 0 && (
          <div className="card mt-3 p-4">
            <div className="mb-2 text-sm font-semibold text-ink-800">
              Bộ dự báo tự chấm mình
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Mini label="Báo trễ, trễ thật" value={accuracy.truePositive} tone="green" />
              <Mini label="Báo ổn, đúng là ổn" value={accuracy.trueNegative} tone="green" />
              <Mini label="Báo trễ nhưng vẫn kịp" value={accuracy.falsePositive} tone="amber" />
              <Mini
                label="Báo ổn nhưng lại trễ"
                value={accuracy.falseNegative}
                tone="red"
              />
            </div>
            <p className="mt-2 text-xs text-ink-500">{accuracy.note}</p>
          </div>
        )}
      </section>

      {/* ============ 2. CÂN BẰNG TẢI ============ */}
      <section id="can-bang-tai" className="mt-8 scroll-mt-4">
        <h2 className="section-title mb-3">2. Cân bằng tải nhân sự</h2>

        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Đang quá tải"
            value={capacity.overloaded}
            tone={capacity.overloaded > 0 ? "red" : "slate"}
            hint="trên 115% giờ công chuẩn"
          />
          <StatCard
            label="Còn dư sức"
            value={capacity.underutilized}
            tone="slate"
            hint="dưới 60%"
          />
          <StatCard
            label="Cặp nên san việc"
            value={capacity.suggestions.length}
            tone={capacity.suggestions.length > 0 ? "amber" : "slate"}
            hint="trong cùng phòng ban"
          />
          <StatCard
            label="Nhân sự theo dõi"
            value={capacity.reports.length}
            hint="chuẩn 160 giờ/tháng"
          />
        </div>

        {capacity.suggestions.length > 0 && (
          <div className="card mb-3 border-amber-200 bg-amber-50/40 p-4">
            <div className="mb-2 font-medium text-amber-900">
              Gợi ý san việc
            </div>
            <ul className="space-y-1.5 text-sm text-ink-700">
              {capacity.suggestions.map((s, i) => (
                <li key={i}>
                  Phòng <b>{s.departmentName}</b>: chuyển khoảng{" "}
                  <b>{fmtNum(s.suggestedHours, 1)} giờ</b> từ {s.from.fullName} (
                  {fmtPct(s.from.utilizationPercent)}) sang {s.to.fullName} (
                  {fmtPct(s.to.utilizationPercent)}) — chênh {fmtNum(s.gapPercent, 1)} điểm
                  phần trăm.
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-500">
              Chỉ gợi ý trong cùng phòng ban — luật cấm giao việc vượt cấp vẫn có
              hiệu lực, hệ thống không đề xuất chuyển sang phòng khác.
            </p>
          </div>
        )}

        {/* Mặc định chỉ người QUÁ TẢI — cả trăm dòng "vừa sức" làm chìm vài
            người đang gánh quá sức. Bảng đầy đủ là một cú bấm. */}
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-ink-600">
            {showAllWorkload
              ? `Tất cả ${fmtNum(capacity.reports.length)} người`
              : overloaded.length > 0
                ? `${fmtNum(overloaded.length)} người đang quá tải`
                : "Không ai đang quá tải"}
          </span>
          {capacity.reports.length > overloaded.length && (
            <Link
              href={showAllWorkload ? "/analytics#can-bang-tai" : "/analytics?tai=all#can-bang-tai"}
              scroll={false}
              className="font-medium text-brand-700 hover:underline"
            >
              {showAllWorkload
                ? "Chỉ xem người quá tải"
                : `Xem tất cả ${fmtNum(capacity.reports.length)} người`}
            </Link>
          )}
        </div>

        {workloadRows.length > 0 && (
        <div className="table-wrap">
          <table className="tbl tbl-stack">
            <thead>
              <tr>
                <th>Nhân sự</th>
                <th>Phòng ban</th>
                <th className="text-right">Việc đang mở</th>
                <th className="text-right">Giờ ước tính</th>
                <th className="w-40">Mức tải</th>
                <th>Tình trạng</th>
                <th>Nền số liệu</th>
              </tr>
            </thead>
            <tbody>
              {workloadRows.map((r) => (
                <tr key={r.userId}>
                  <td className="font-medium text-ink-800">{r.fullName}</td>
                  <td data-label="Phòng ban" className="text-ink-600">{r.departmentName ?? "—"}</td>
                  <td data-label="Việc đang mở" className="text-right text-ink-600">
                    {fmtNum(r.assignedTasksCount)}
                  </td>
                  <td data-label="Giờ ước tính" className="text-right text-ink-700">
                    {fmtNum(r.totalEstimatedHours, 1)}
                    {r.overdueHours > 0 && (
                      <div className="text-xs text-red-700">
                        {fmtNum(r.overdueHours, 1)} giờ đã quá hạn
                      </div>
                    )}
                  </td>
                  <td data-label="Mức tải">
                    <div className="mb-1 text-xs text-ink-600 tabular-nums">
                      {fmtPct(r.utilizationPercent)}
                    </div>
                    <LoadBar
                      value={r.utilizationPercent}
                      status={r.workloadStatus}
                    />
                  </td>
                  <td data-label="Tình trạng">
                    {/* Chỉ "Quá tải" là ngoại lệ (huy hiệu đỏ). Vừa sức: chữ
                        màu lá. Còn dư sức: chữ trung tính — không phải báo động. */}
                    {r.workloadStatus === "OVERLOADED" ? (
                      <Badge tone="red">{WORKLOAD_LABEL[r.workloadStatus]}</Badge>
                    ) : r.workloadStatus === "UNDERUTILIZED" ? (
                      <span className="text-xs text-ink-600">
                        {WORKLOAD_LABEL[r.workloadStatus]}
                      </span>
                    ) : (
                      <Badge tone="green">{WORKLOAD_LABEL[r.workloadStatus]}</Badge>
                    )}
                  </td>
                  <td data-label="" className="max-w-xs text-xs text-ink-500">
                    {r.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </section>

      {/* ============ 3. BẤT THƯỜNG KPI ============ */}
      <section className="mt-8">
        <h2 className="section-title mb-3">
          3. Khai báo KPI bất thường ({fmtNum(anomalyCount)})
        </h2>

        <p className="mb-3 max-w-3xl text-sm text-ink-500">
          Hệ thống so số kỳ này với lịch sử của <em>chính người đó</em>, không so
          người này với người kia. Lệch hẳn khỏi nếp cũ thì nêu ra để hỏi — có thể
          vì khai khống, mà cũng có thể vì tháng đó có đơn hàng lớn thật. Cần ít
          nhất 4 kỳ lịch sử mới dám kết luận.
        </p>

        {anomalies.length === 0 ? (
          <div className="card p-6 text-center">
            <div className="mb-1 flex justify-center text-leaf-600">
              <CircleCheck size={28} strokeWidth={1.75} aria-hidden />
            </div>
            <div className="font-medium text-ink-800">
              Không có khai báo nào lệch khỏi nếp
            </div>
            <div className="mt-1 text-sm text-ink-500">
              Những dòng chưa đủ 4 kỳ lịch sử thì hệ thống chưa đánh giá, không
              tính vào đây.
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {anomalies.map((a) => (
              <div
                key={a.id}
                className={`card overflow-hidden ${
                  a.severity === "CRITICAL"
                    ? "border-red-200"
                    : a.severity === "WARNING"
                      ? "border-amber-200"
                      : "border-ink-200"
                }`}
              >
                <div
                  className={`flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3 ${
                    a.severity === "CRITICAL"
                      ? "border-red-200 bg-red-50/60"
                      : a.severity === "WARNING"
                        ? "border-amber-200 bg-amber-50/60"
                        : "border-ink-200 bg-ink-50/60"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-medium text-ink-900">
                      {a.employee.fullName} — {a.kpiDefinition.name}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-500">
                      {a.employee.department?.name ?? "—"} · Kỳ {a.period.name} ·
                      Phát hiện {fmtDateTime(a.createdAt)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      tone={
                        a.severity === "CRITICAL"
                          ? "red"
                          : a.severity === "WARNING"
                            ? "amber"
                            : "slate"
                      }
                    >
                      {ANOMALY_SEVERITY_LABEL[a.severity]}
                    </Badge>
                    <Badge tone="slate">
                      {ANOMALY_STATUS_LABEL[a.status]}
                    </Badge>
                  </div>
                </div>

                <div className="space-y-3 p-4">
                  <p className="text-sm text-ink-700">{plainAnomalyReason(a.reason)}</p>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Mini label="Khai kỳ này" value={fmtNum(a.reportedValue)} tone="amber" />
                    <Mini label="Trung vị lịch sử" value={fmtNum(a.historicalMedian)} />
                    <Mini
                      label="Mức lệch so với nếp cũ"
                      value={`gấp ${fmtNum(a.robustScore, 1)} lần`}
                      tone="red"
                    />
                    <Mini
                      label="Nền dữ liệu"
                      value={`${a.sampleSize} kỳ`}
                      tone={a.sampleSize >= 6 ? "green" : "amber"}
                    />
                  </div>

                  {a.explanationText && (
                    <div className="rounded-md bg-ink-50 px-3 py-2">
                      <div className="text-xs font-medium text-ink-500">
                        Giải trình — {a.explainedBy?.fullName} ·{" "}
                        {fmtDateTime(a.explainedAt)}
                      </div>
                      <div className="mt-1 text-sm text-ink-700">
                        {a.explanationText}
                      </div>
                    </div>
                  )}

                  <AnomalyActions
                    anomalyId={a.id}
                    status={a.status}
                    isOwner={a.employeeId === user.id}
                    canReview={isCeo || user.role === "MANAGER"}
                  />
                </div>
              </div>
            ))}
            <ShowingCount
              shown={anomalies.length}
              total={anomalyCount}
              hint="nặng nhất trước"
            />
          </div>
        )}
      </section>
    </>
  );
}

function Mini({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "green" | "red" | "amber";
}) {
  const color =
    tone === "green"
      ? "text-leaf-700"
      : tone === "red"
        ? "text-red-700"
        : tone === "amber"
          ? "text-amber-800"
          : "text-ink-900";
  // Ô số nằm trong thẻ: nền ink-50, không viền — tránh thẻ lồng thẻ
  return (
    <div className="rounded-md bg-ink-50 px-3 py-2">
      <div className="text-xs text-ink-500">{label}</div>
      <div className={`mt-0.5 font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

/**
 * Thanh mức tải — cùng màu với cột Tình trạng: quá tải đỏ, vừa sức xanh lá,
 * còn dư sức trung tính (ProgressBar chung không có tông trung tính).
 */
function LoadBar({ value, status }: { value: number; status: string }) {
  const color =
    status === "OVERLOADED"
      ? "bg-red-500"
      : status === "UNDERUTILIZED"
        ? "bg-ink-400"
        : "bg-leaf-500";
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100"
    >
      <div
        className={`h-full rounded-full ${color}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}
