import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getDashboardSummary,
  getDashboardDistribution,
  getDashboardTrends,
  normalizePeriod,
  redactDashboardMoney,
  PERIOD_LABEL,
} from "@/lib/services/kpi-dashboard";
import {
  canSeeMoney,
  withProductionRole,
} from "@/lib/services/production-service";
import {
  SHIFT_STATUSES,
  SHIFT_STATUS_LABEL,
  SHIFT_TYPES,
  SHIFT_TYPE_LABEL,
} from "@/lib/production/constants";
import { formatVnDate, formatVnDateTime } from "@/lib/vn-time";
import PrintToolbar from "./print-toolbar";

export const dynamic = "force-dynamic";

/**
 * BÁO CÁO DASHBOARD KPI SẢN XUẤT — bản in.
 *
 * Số liệu là điểm THẬT của ca đã khoá số (DailyKpiResult) — cùng nguồn với KPI
 * tháng và thưởng ca.
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

  const period = normalizePeriod(periodParam);
  const numDays = Math.min(90, Math.max(1, parseInt(daysParam ?? "7", 10) || 7));

  // Tiền thưởng chỉ CEO / Giám đốc SX được xem — người khác thấy "—".
  const includeMoney = canSeeMoney(await withProductionRole(user));

  const [rawSummary, distribution, rawTrends] = await Promise.all([
    getDashboardSummary(period),
    getDashboardDistribution(),
    getDashboardTrends(numDays),
  ]);
  const summary = includeMoney ? rawSummary : redactDashboardMoney(rawSummary);
  const trends = includeMoney ? rawTrends : redactDashboardMoney(rawTrends);

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
          <span>Xuất lúc: {formatVnDateTime(new Date())}</span>
          <span>Người xuất: {user.fullName}</span>
        </div>
      </header>

      {/* ---------------- tổng quan ---------------- */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-bold">
          1. Tổng quan ({PERIOD_LABEL[period]})
        </h2>

        {summary.summary.totalShifts === 0 && (
          <p className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Chưa có ca nào được khoá trong khoảng này. Điểm KPI ca chỉ sinh ra
            khi Ban Giám đốc khoá số — xem số ca còn chờ ở bảng &quot;Theo trạng
            thái&quot; bên dưới.
          </p>
        )}

        <div className="mb-5 grid grid-cols-3 gap-3">
          <Stat label="Số ca đã khoá" value={String(summary.summary.totalShifts)} />
          <Stat label="Lượt chấm (người × ca)" value={String(summary.summary.resultCount)} />
          <Stat label="Điểm cuối TB" value={num2(summary.summary.avgScore)} />
          <Stat label="Điểm Tầng 2 TB" value={num2(summary.summary.avgTier2Score)} />
          <Stat label="Tổng thưởng" value={vnd(summary.summary.totalBonus)} />
          <Stat label="Thưởng TB/ca" value={vnd(summary.summary.avgBonus)} />
          <Stat
            label="% không bị khoá thưởng"
            value={
              summary.summary.percentBonusUnlocked === null
                ? "—"
                : `${summary.summary.percentBonusUnlocked}%`
            }
          />
          <Stat label="Lượt bị khoá thưởng" value={String(summary.summary.bonusLockedCount)} />
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-700">
              Theo trạng thái (mọi ca trong kỳ)
            </h3>
            <table className="w-full text-sm">
              <tbody>
                {SHIFT_STATUSES.map((st) => (
                  <tr key={st}>
                    <td className="py-1 text-ink-600">{SHIFT_STATUS_LABEL[st]}</td>
                    <td className="py-1 text-right font-semibold">
                      {summary.statusCounts[st]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-700">
              Theo ca (đã khoá)
            </h3>
            <table className="w-full text-sm">
              <tbody>
                {SHIFT_TYPES.map((t) => (
                  <tr key={t}>
                    <td className="py-1 text-ink-600">{SHIFT_TYPE_LABEL[t]}</td>
                    <td className="py-1 text-right font-semibold">
                      {summary.shiftTypes[t] ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {summary.topScores.length > 0 && (
          <div className="mt-5">
            <h3 className="mb-2 text-sm font-semibold text-ink-700">
              Top 5 ca điểm TB cao nhất
            </h3>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-ink-100">
                  <th className="border border-ink-200 px-2 py-1 text-left">Ngày</th>
                  <th className="border border-ink-200 px-2 py-1 text-left">Ca</th>
                  <th className="border border-ink-200 px-2 py-1 text-left">Sản phẩm</th>
                  <th className="border border-ink-200 px-2 py-1 text-right">Điểm TB</th>
                  <th className="border border-ink-200 px-2 py-1 text-right">Tầng 2</th>
                  <th className="border border-ink-200 px-2 py-1 text-right">Số người</th>
                  <th className="border border-ink-200 px-2 py-1 text-right">Thưởng ca</th>
                </tr>
              </thead>
              <tbody>
                {summary.topScores.map((s) => (
                  <tr key={s.shiftId}>
                    <td className="border border-ink-200 px-2 py-1">
                      {formatVnDate(s.shiftDate)}
                    </td>
                    <td className="border border-ink-200 px-2 py-1">
                      {SHIFT_TYPE_LABEL[s.shiftType] ?? s.shiftType}
                    </td>
                    <td className="border border-ink-200 px-2 py-1">
                      {s.skuName}{" "}
                      <span className="text-ink-500">({s.skuCode})</span>
                    </td>
                    <td className="border border-ink-200 px-2 py-1 text-right font-semibold">
                      {s.avgScore.toFixed(2)}
                    </td>
                    <td className="border border-ink-200 px-2 py-1 text-right">
                      {num2(s.tier2Score)}
                    </td>
                    <td className="border border-ink-200 px-2 py-1 text-right">
                      {s.peopleCount}
                    </td>
                    <td className="border border-ink-200 px-2 py-1 text-right">
                      {vnd(s.shiftBonus)}
                      {s.bonusLocked && (
                        <span className="ml-1 text-amber-700">(khoá)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------------- phân bố điểm ---------------- */}
      <section className="mb-8 break-inside-avoid">
        <h2 className="mb-3 text-lg font-bold">
          2. Phân bố điểm cuối theo người (30 ngày gần nhất)
        </h2>
        <p className="mb-3 text-xs text-ink-500">
          Mỗi khoảng là một bậc hệ số thưởng. Chỉ tính ca đã khoá số.
        </p>
        <div className="mb-4 grid grid-cols-4 gap-3 text-sm">
          <Stat label="Lượt chấm" value={String(distribution.statistics.count)} />
          <Stat label="Trung bình" value={distribution.statistics.average.toFixed(2)} />
          <Stat label="Trung vị" value={distribution.statistics.median.toFixed(2)} />
          <Stat label="Độ lệch chuẩn" value={distribution.statistics.stdDev.toFixed(2)} />
        </div>
        <table className="w-full text-sm">
          <tbody>
            {distribution.chartData.map((b) => (
              <tr key={b.range}>
                <td className="w-40 py-1 text-ink-600">
                  {b.range}{" "}
                  <span className="text-xs text-ink-400">(hệ số {b.multiplier}×)</span>
                </td>
                <td className="py-1">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-4 rounded-sm bg-brand-500"
                      style={{ width: `${b.percentage}%`, minWidth: b.count ? 8 : 0 }}
                    />
                    <span className="text-xs font-medium text-ink-700">
                      {b.count} lượt ({b.percentage}%)
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
          <Stat label="Số ca đã khoá" value={String(trends.statistics.totalShifts)} />
          <Stat label="Điểm cuối TB" value={num2(trends.statistics.avgScore)} />
          <Stat
            label="Tổng thưởng"
            value={vnd(trends.statistics.totalBonusDistributed)}
          />
        </div>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-ink-100">
              <th className="border border-ink-200 px-2 py-1 text-left">Ngày</th>
              <th className="border border-ink-200 px-2 py-1 text-right">Số ca</th>
              <th className="border border-ink-200 px-2 py-1 text-right">Lượt chấm</th>
              <th className="border border-ink-200 px-2 py-1 text-right">Điểm TB</th>
              <th className="border border-ink-200 px-2 py-1 text-right">MA 3 ngày</th>
              <th className="border border-ink-200 px-2 py-1 text-right">% đạt SL</th>
              <th className="border border-ink-200 px-2 py-1 text-right">% lỗi</th>
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
                  {d.peopleCount}
                </td>
                <td className="border border-ink-200 px-2 py-1 text-right">
                  {num2(d.avgScore)}
                </td>
                <td className="border border-ink-200 px-2 py-1 text-right">
                  {num2(d.movingAvg)}
                </td>
                <td className="border border-ink-200 px-2 py-1 text-right">
                  {pct(d.avgOutputAchievement)}
                </td>
                <td className="border border-ink-200 px-2 py-1 text-right">
                  {pct(d.avgDefectRate)}
                </td>
                <td className="border border-ink-200 px-2 py-1 text-right">
                  {vnd(d.totalBonus)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-ink-500">
          % đạt SL = thành phẩm đạt QC / chỉ tiêu sản lượng; % lỗi = (phế + làm
          lại × hệ số) / sản lượng thô — cùng công thức engine chấm điểm, trung
          bình theo ca.
        </p>
      </section>

      <footer className="mt-8 border-t border-ink-200 pt-4 text-xs text-ink-500">
        <p>
          Báo cáo sinh tự động từ hệ thống Quản lý Công việc &amp; KPI ·{" "}
          {company?.value ?? "GANI FOODY"} · {formatVnDateTime(new Date())}
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
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(n);
}

/** Số tiền kèm ₫; null (đã ẩn với người không được xem tiền) → "—". */
function vnd(n: number | null | undefined) {
  const s = fmt(n);
  return s === "—" ? s : `${s} ₫`;
}

/** Số 2 chữ số thập phân; null (chưa có dữ liệu) → "—". */
function num2(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

function pct(n: number | null | undefined) {
  const s = num2(n);
  return s === "—" ? s : `${s}%`;
}
