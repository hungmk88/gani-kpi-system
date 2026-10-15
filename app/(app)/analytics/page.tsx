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
  StatCard,
  formatDate,
  formatDateTime,
} from "@/components/ui";
import BriefingPanel from "./briefing-panel";
import AnomalyActions from "@/components/anomaly-actions";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const user = (await requireSession())!;
  if (user.role !== "CEO" && user.role !== "MANAGER") redirect("/dashboard");

  const isCeo = user.role === "CEO";
  const departmentId = isCeo ? null : (user.departmentId ?? "__none__");

  const now = new Date();
  const overdueWhere = {
    status: { in: ["TO_DO", "IN_PROGRESS", "BLOCKED", "REVIEW", "BACKLOG"] },
    dueDate: { lt: now },
    ...(departmentId ? { departmentId } : {}),
  };
  const [scan, capacity, accuracy, snapshot, anomalies, overdue, overdueCount] =
    await Promise.all([
    runPredictiveScan({ departmentId, persist: false }),
    getCapacityReports(departmentId),
    getPredictionAccuracy(),
    isCeo ? buildHealthSnapshot() : Promise.resolve(null),
    prisma.kpiAnomaly.findMany({
      where: {
        status: { in: ["OPEN", "EXPLAINED"] },
        ...(isCeo
          ? {}
          : { employee: { departmentId: user.departmentId ?? "__none__" } }),
      },
      include: {
        employee: { include: { department: true } },
        kpiDefinition: true,
        period: true,
        explainedBy: true,
      },
      orderBy: [{ severity: "desc" }, { robustScore: "desc" }],
      take: 20,
    }),
    // Việc ĐÃ trễ không còn là chuyện dự báo — tách nhóm riêng, cũ nhất trước
    prisma.task.findMany({
      where: overdueWhere,
      include: { assignee: { select: { fullName: true } } },
      orderBy: { dueDate: "asc" },
      take: 10,
    }),
    prisma.task.count({ where: overdueWhere }),
  ]);

  return (
    <>
      <PageHeader
        title="Phân tích &amp; Dự báo"
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
              : `độ chính xác ${accuracy.accuracyPercent}% trên ${accuracy.total} việc đã đóng`}
          </span>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Nhiều khả năng vỡ"
            value={scan.highRisk}
            tone={scan.highRisk > 0 ? "red" : "green"}
            hint="dưới 40% khả năng kịp"
          />
          <StatCard
            label="Có nguy cơ"
            value={scan.moderateRisk}
            tone={scan.moderateRisk > 0 ? "amber" : "green"}
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
            tone={scan.weakBasis > 0 ? "amber" : "green"}
            hint="chưa đủ lịch sử người phụ trách"
          />
        </div>

        {overdueCount > 0 && (
          <div className="card mb-4 border-red-200 p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="font-semibold text-red-700">
                Đã trễ hạn ({overdueCount}) — không còn là dự báo
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
                const days = Math.max(
                  1,
                  Math.floor((now.getTime() - new Date(t.dueDate).getTime()) / 86_400_000)
                );
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
                    <span className="shrink-0 text-xs font-semibold text-red-700">
                      trễ {days} ngày
                    </span>
                  </li>
                );
              })}
            </ul>
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
                        hạn {formatDate(p.dueDate)}
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
                        {p.completionProbabilityPercent}% kịp
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
                      <div className="mb-1 flex justify-between text-[11px] text-ink-500">
                        <span>Đáng lẽ phải xong</span>
                        <span>{p.expectedProgressPercent}%</span>
                      </div>
                      <ProgressBar value={p.expectedProgressPercent} tone="brand" />
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between text-[11px] text-ink-500">
                        <span>Thực tế</span>
                        <span>{p.actualProgressPercent}%</span>
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

                  <div className="mt-2 text-[11px] text-ink-400">
                    Nền dữ liệu: {CONFIDENCE_LABEL[p.confidence]} ·{" "}
                    {p.sampleSize} việc đã đóng của người phụ trách
                  </div>
                </div>
              ))}
            {scan.predictions.filter((p) => p.riskCategory !== "ON_TRACK")
              .length === 0 && (
              <div className="card border-emerald-200 bg-emerald-50/50 p-6 text-center">
                <div className="mb-1 flex justify-center text-emerald-600">
                  <CircleCheck size={28} strokeWidth={1.75} />
                </div>
                <div className="font-medium text-emerald-800">
                  Không có việc nào đang bị dự báo trễ
                </div>
                <div className="mt-1 text-sm text-emerald-700">
                  Cả {scan.scanned} việc tới hạn trong 30 ngày đều đang bám kế hoạch.
                </div>
              </div>
            )}
          </div>
        )}

        {accuracy.total > 0 && (
          <div className="card mt-3 p-4">
            <div className="mb-2 text-xs font-semibold tracking-wide text-ink-500 uppercase">
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
      <section className="mt-8">
        <h2 className="section-title mb-3">2. Cân bằng tải nhân sự</h2>

        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Đang quá tải"
            value={capacity.overloaded}
            tone={capacity.overloaded > 0 ? "red" : "green"}
            hint="trên 115% giờ công chuẩn"
          />
          <StatCard
            label="Còn dư sức"
            value={capacity.underutilized}
            tone={capacity.underutilized > 0 ? "sky" : "green"}
            hint="dưới 60%"
          />
          <StatCard
            label="Cặp nên san việc"
            value={capacity.suggestions.length}
            tone={capacity.suggestions.length > 0 ? "amber" : "green"}
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
                  <b>{s.suggestedHours} giờ</b> từ {s.from.fullName} (
                  {s.from.utilizationPercent}%) sang {s.to.fullName} (
                  {s.to.utilizationPercent}%) — chênh {s.gapPercent} điểm phần trăm.
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-500">
              Chỉ gợi ý trong cùng phòng ban — luật cấm giao việc vượt cấp vẫn có
              hiệu lực, hệ thống không đề xuất chuyển sang phòng khác.
            </p>
          </div>
        )}

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
              {capacity.reports.map((r) => (
                <tr key={r.userId}>
                  <td className="font-medium text-ink-800">{r.fullName}</td>
                  <td data-label="Phòng ban" className="text-ink-600">{r.departmentName ?? "—"}</td>
                  <td data-label="Việc đang mở" className="text-right text-ink-600">
                    {r.assignedTasksCount}
                  </td>
                  <td data-label="Giờ ước tính" className="text-right text-ink-700">
                    {r.totalEstimatedHours}
                    {r.overdueHours > 0 && (
                      <div className="text-[11px] text-red-600">
                        {r.overdueHours} giờ đã quá hạn
                      </div>
                    )}
                  </td>
                  <td data-label="Mức tải">
                    <div className="mb-1 text-xs text-ink-600">
                      {r.utilizationPercent}%
                    </div>
                    <ProgressBar
                      value={Math.min(100, r.utilizationPercent)}
                      tone={
                        r.workloadStatus === "OVERLOADED"
                          ? "red"
                          : r.workloadStatus === "UNDERUTILIZED"
                            ? "amber"
                            : "green"
                      }
                    />
                  </td>
                  <td data-label="Tình trạng">
                    <Badge
                      tone={
                        r.workloadStatus === "OVERLOADED"
                          ? "red"
                          : r.workloadStatus === "UNDERUTILIZED"
                            ? "sky"
                            : "green"
                      }
                    >
                      {WORKLOAD_LABEL[r.workloadStatus]}
                    </Badge>
                  </td>
                  <td data-label="" className="max-w-xs text-xs text-ink-500">
                    {r.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ============ 3. BẤT THƯỜNG KPI ============ */}
      <section className="mt-8">
        <h2 className="section-title mb-3">
          3. Khai báo KPI bất thường ({anomalies.length})
        </h2>

        <p className="mb-3 max-w-3xl text-sm text-ink-500">
          Hệ thống so số kỳ này với lịch sử của <em>chính người đó</em>, không so
          người này với người kia. Lệch hẳn khỏi nếp cũ thì nêu ra để hỏi — có thể
          vì khai khống, mà cũng có thể vì tháng đó có đơn hàng lớn thật. Cần ít
          nhất 4 kỳ lịch sử mới dám kết luận.
        </p>

        {anomalies.length === 0 ? (
          <div className="card border-emerald-200 bg-emerald-50/50 p-6 text-center">
            <div className="mb-1 flex justify-center text-emerald-600">
              <CircleCheck size={28} strokeWidth={1.75} />
            </div>
            <div className="font-medium text-emerald-800">
              Không có khai báo nào lệch khỏi nếp
            </div>
            <div className="mt-1 text-sm text-emerald-700">
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
                      Phát hiện {formatDateTime(a.createdAt)}
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
                  <p className="text-sm text-ink-700">{a.reason}</p>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Mini label="Khai kỳ này" value={fmt(a.reportedValue)} tone="amber" />
                    <Mini label="Trung vị lịch sử" value={fmt(a.historicalMedian)} />
                    <Mini label="Lệch (thước bền)" value={`${a.robustScore}×`} tone="red" />
                    <Mini
                      label="Nền dữ liệu"
                      value={`${a.sampleSize} kỳ`}
                      tone={a.sampleSize >= 6 ? "green" : "amber"}
                    />
                  </div>

                  {a.explanationText && (
                    <div className="rounded-lg border border-ink-200 bg-ink-50/60 px-3 py-2">
                      <div className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
                        Giải trình — {a.explainedBy?.fullName} ·{" "}
                        {formatDateTime(a.explainedAt)}
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
      ? "text-emerald-700"
      : tone === "red"
        ? "text-red-700"
        : tone === "amber"
          ? "text-amber-700"
          : "text-ink-900";
  return (
    <div className="rounded-lg border border-ink-200 px-3 py-2">
      <div className="text-[10px] font-semibold tracking-wide text-ink-500 uppercase">
        {label}
      </div>
      <div className={`mt-0.5 font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function fmt(n: number) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n);
}
