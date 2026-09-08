import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getDashboardSummary,
  getDashboardDistribution,
  getDashboardTrends,
  PERIOD_LABEL,
  type DashboardPeriod,
} from "@/lib/services/kpi-dashboard";
import PrintToolbar from "./print-toolbar";

export const dynamic = "force-dynamic";

const SHIFT_LABEL: Record<string, string> = {
  MORNING: "Sáng",
  AFTERNOON: "Chiều",
  NIGHT: "Tối",
};

/**
 * BÁO CÁO DASHBOARD KPI SẢN XUẤT — bản in.
 *
 * Cùng cách làm với /reports/kpi/[periodId]: trang nằm ngoài khung ứng dụng,
 * có CSS riêng cho lúc in, không dùng thư viện dựng PDF nào.
 */
export default async function KpiDashboardReportPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; days?: string }>;
}) {
  const { period: periodParam, days: daysParam } = await searchParams;
  const user = await requireSession();
  if (!user) redirect("/login");
  if (user.role !== "CEO" && user.role !== "ADMIN") redirect("/dashboard");

  const period = (
    ["today", "week", "month"].includes(periodParam ?? "") ? periodParam : "today"
  ) as DashboardPeriod;
  const numDays = Math.min(90, Math.max(1, parseInt(daysParam ?? "7") || 7));

  const [summary, distribution, trends] = await Promise.all([
    getDashboardSummary(period),
    getDashboardDistribution(),
    getDashboardTrends(numDays),
  ]);

  const company = await prisma.systemSetting.findUnique({
    where: { key: "COMPANY_NAME" },
  });

  return (
    <div className="report mx-auto max-w-[900px] bg-white p-8 text-ink-900 print:max-w-none print:p-0">
      <PrintToolbar period={period} days={numDays} />

      <header className="mb-8 border-b-4 border-brand-600 pb-5">
        <div className="text-xs font-semibold tracking-widest text-brand-700 uppercase">
          {company?.value ?? "GANI FOODY"} · Báo cáo điều hành
        </div>
        <h1 className="mt-2 text-3xl font-bold">
          Báo cáo Dashboard KPI Sản xuất
        </h1>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-600">
          <span>
            Kỳ xem: <b>{PERIOD_LABEL[period]}</b>
          </span>
          <span>Xuất lúc: {new Date().toLocaleString("vi-VN")}</span>
          <span>Người xuất: {user.fullName}</span>
        </div>
      </header>

      {/* ---------------- tổng quan ---------------- */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-bold">
          1. Tổng quan ({PERIOD_LABEL[period]})
        </h2>

        <div className="mb-5 grid grid-cols-5 gap-3">
          <Stat label="Tổng ca tính" value={String(summary.summary.totalShifts)} />
          <Stat label="Điểm trung bình" value={summary.summary.avgScore.toFixed(2)} />
          <Stat label="Tổng thưởng" value={`${fmt(summary.summary.totalBonus)} ₫`} />
          <Stat label="Trung bình/ca" value={`${fmt(summary.summary.avgBonus)} ₫`} />
          <Stat label="Đã duyệt" value={`${summary.summary.percentApproved}%`} />
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-700">
              Theo trạng thái
            </h3>
            <table className="w-full text-sm">
              <tbody>
                <tr>
                  <td className="py-1 text-ink-600">Đã tính (CALCULATED)</td>
                  <td className="py-1 text-right font-semibold">
                    {summary.statusCounts.CALCULATED}
                  </td>
                </tr>
                <tr>
                  <td className="py-1 text-ink-600">Đã duyệt (APPROVED)</td>
                  <td className="py-1 text-right font-semibold">
                    {summary.statusCounts.APPROVED}
                  </td>
                </tr>
                <tr>
                  <td className="py-1 text-ink-600">Nháp (DRAFT)</td>
                  <td className="py-1 text-right font-semibold">
                    {summary.statusCounts.DRAFT}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-700">Theo ca</h3>
            <table className="w-full text-sm">
              <tbody>
                <tr>
                  <td className="py-1 text-ink-600">Sáng</td>
                  <td className="py-1 text-right font-semibold">
                    {summary.shiftTypes.MORNING}
                  </td>
                </tr>
                <tr>
                  <td className="py-1 text-ink-600">Chiều</td>
                  <td className="py-1 text-right font-semibold">
                    {summary.shiftTypes.AFTERNOON}
                  </td>
                </tr>
                <tr>
                  <td className="py-1 text-ink-600">Tối</td>
                  <td className="py-1 text-right font-semibold">
                    {summary.shiftTypes.NIGHT}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {summary.topScores.length > 0 && (
          <div className="mt-5">
            <h3 className="mb-2 text-sm font-semibold text-ink-700">
              Top 5 ca điểm cao nhất
            </h3>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-ink-100">
                  <th className="border border-ink-200 px-2 py-1 text-left">Ngày</th>
                  <th className="border border-ink-200 px-2 py-1 text-left">Ca</th>
                  <th className="border border-ink-200 px-2 py-1 text-right">Điểm</th>
                  <th className="border border-ink-200 px-2 py-1 text-right">Thưởng</th>
                  <th className="border border-ink-200 px-2 py-1 text-left">
                    Trạng thái
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.topScores.map((s, i) => (
                  <tr key={i}>
                    <td className="border border-ink-200 px-2 py-1">
                      {new Date(s.shiftDate).toLocaleDateString("vi-VN")}
                    </td>
                    <td className="border border-ink-200 px-2 py-1">
                      {SHIFT_LABEL[s.shiftType] ?? s.shiftType}
                    </td>
                    <td className="border border-ink-200 px-2 py-1 text-right font-semibold">
                      {s.totalScore.toFixed(2)}
                    </td>
                    <td className="border border-ink-200 px-2 py-1 text-right">
                      {fmt(s.bonusAmount)} ₫
                    </td>
                    <td className="border border-ink-200 px-2 py-1">{s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------------- phân bố điểm ---------------- */}
      <section className="mb-8 break-inside-avoid">
        <h2 className="mb-3 text-lg font-bold">2. Phân bố điểm (30 ngày gần nhất)</h2>
        <div className="mb-4 grid grid-cols-3 gap-3 text-sm">
          <Stat label="Trung bình" value={distribution.statistics.average.toFixed(2)} />
          <Stat label="Trung vị" value={distribution.statistics.median.toFixed(2)} />
          <Stat label="Độ lệch chuẩn" value={distribution.statistics.stdDev.toFixed(2)} />
        </div>
        <table className="w-full text-sm">
          <tbody>
            {distribution.chartData.map((b) => (
              <tr key={b.range}>
                <td className="w-32 py-1 text-ink-600">{b.range}</td>
                <td className="py-1">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-4 rounded-sm bg-brand-500"
                      style={{ width: `${b.percentage}%`, minWidth: b.count ? 8 : 0 }}
                    />
                    <span className="text-xs font-medium text-ink-700">
                      {b.count} ca ({b.percentage}%)
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ---------------- xu hướng ---------------- */}
      <section className="break-inside-avoid">
        <h2 className="mb-3 text-lg font-bold">
          3. Xu hướng ({numDays} ngày gần nhất)
        </h2>
        <div className="mb-4 grid grid-cols-4 gap-3 text-sm">
          <Stat label="Số ngày có dữ liệu" value={String(trends.statistics.daysWithData)} />
          <Stat label="Tổng ca" value={String(trends.statistics.totalShifts)} />
          <Stat label="Điểm TB/ngày" value={trends.statistics.avgDailyScore.toFixed(2)} />
          <Stat
            label="Tổng thưởng"
            value={`${fmt(trends.statistics.totalBonusDistributed)} ₫`}
          />
        </div>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-ink-100">
              <th className="border border-ink-200 px-2 py-1 text-left">Ngày</th>
              <th className="border border-ink-200 px-2 py-1 text-right">Số ca</th>
              <th className="border border-ink-200 px-2 py-1 text-right">Điểm TB</th>
              <th className="border border-ink-200 px-2 py-1 text-right">MA 3 ngày</th>
              <th className="border border-ink-200 px-2 py-1 text-right">Thưởng</th>
            </tr>
          </thead>
          <tbody>
            {trends.trendData.map((d) => (
              <tr key={d.date}>
                <td className="border border-ink-200 px-2 py-1">{d.displayDate}</td>
                <td className="border border-ink-200 px-2 py-1 text-right">
                  {d.shiftCount}
                </td>
                <td className="border border-ink-200 px-2 py-1 text-right">
                  {d.avgScore ?? "—"}
                </td>
                <td className="border border-ink-200 px-2 py-1 text-right">
                  {d.movingAvg}
                </td>
                <td className="border border-ink-200 px-2 py-1 text-right">
                  {fmt(d.totalBonus)} ₫
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className="mt-8 border-t border-ink-200 pt-4 text-xs text-ink-500">
        <p>
          Báo cáo sinh tự động từ hệ thống Quản lý Công việc &amp; KPI ·{" "}
          {company?.value ?? "GANI FOODY"} · {new Date().toLocaleString("vi-VN")}
        </p>
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-ink-200 bg-ink-50 p-3">
      <div className="text-[10px] font-semibold tracking-wide text-ink-500 uppercase">
        {label}
      </div>
      <div className="mt-1 text-xl font-bold text-ink-900">{value}</div>
    </div>
  );
}

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(n);
}
