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
import { SHIFT_TYPES, SHIFT_TYPE_LABEL } from "@/lib/production/constants";
import { SHIFT_STAGES, SHIFT_STAGE_LABEL } from "@/lib/production/shift-flow";
import { fmtDate, fmtDateTime, fmtNum, fmtPct, fmtScore, fmtVnd } from "@/lib/format";
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

  // Chưa có ca khoá thì tiền thưởng "0 ₫" là số giả — in "—"
  const noShifts = summary.summary.totalShifts === 0;
  // Chưa có lượt chấm nào thì trung bình/trung vị/độ lệch "0,00" cũng là số giả
  const noSample = distribution.statistics.count === 0;

  const company = await prisma.systemSetting.findUnique({
    where: { key: "COMPANY_NAME" },
  });

  return (
    <div className="report mx-auto max-w-[900px] bg-white p-8 text-ink-900 print:max-w-none print:p-0">
      <PrintToolbar period={period} days={numDays} />

      <header className="mb-8 border-b-4 border-brand-600 pb-5">
        <div className="text-sm font-semibold text-brand-700">
          {company?.value ?? "GANI FOODY"} · Báo cáo điều hành
        </div>
        <h1 className="mt-2 text-3xl font-bold">
          Báo cáo KPI sản xuất
        </h1>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-600">
          <span>
            Kỳ xem: <b>{PERIOD_LABEL[period]}</b>
          </span>
          <span>Xuất lúc: {fmtDateTime(new Date())}</span>
          <span>Người xuất: {user.fullName}</span>
        </div>
      </header>

      {/* ---------------- tổng quan ---------------- */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-bold">
          1. Tổng quan ({PERIOD_LABEL[period]})
        </h2>

        {summary.summary.totalShifts === 0 && (
          <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Chưa có ca nào được khoá trong khoảng này. Điểm KPI ca chỉ sinh ra
            khi Ban Giám đốc khoá số — xem số ca còn chờ ở bảng &quot;Theo trạng
            thái&quot; bên dưới.
          </p>
        )}

        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3">
          <Stat label="Số ca đã khoá" value={fmt(summary.summary.totalShifts)} />
          <Stat label="Lượt chấm (người × ca)" value={fmt(summary.summary.resultCount)} />
          <Stat label="Điểm cuối trung bình" value={num2(summary.summary.avgScore)} />
          <Stat label="Điểm tầng 2 trung bình" value={num2(summary.summary.avgTier2Score)} />
          <Stat label="Tổng thưởng" value={noShifts ? "—" : vnd(summary.summary.totalBonus)} />
          <Stat label="Thưởng trung bình mỗi ca" value={noShifts ? "—" : vnd(summary.summary.avgBonus)} />
          <Stat
            label="Tỷ lệ không bị khoá thưởng"
            value={
              noShifts || summary.summary.percentBonusUnlocked === null
                ? "—"
                : fmtPct(summary.summary.percentBonusUnlocked)
            }
          />
          <Stat label="Lượt bị khoá thưởng" value={fmt(summary.summary.bonusLockedCount)} />
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-700">
              Theo trạng thái (mọi ca trong kỳ)
            </h3>
            <table className="w-full text-sm">
              <tbody>
                {SHIFT_STAGES.map((st) => (
                  <tr key={st}>
                    <td className="py-1 text-ink-600">{SHIFT_STAGE_LABEL[st]}</td>
                    <td className="py-1 text-right font-semibold tabular-nums">
                      {fmt(summary.statusCounts[st] ?? 0)}
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
                    <td className="py-1 text-right font-semibold tabular-nums">
                      {fmt(summary.shiftTypes[t] ?? 0)}
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
              5 ca có điểm trung bình cao nhất
            </h3>
            <table className="w-full border-collapse text-xs tabular-nums">
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
                      {fmtDate(s.shiftDate)}
                    </td>
                    <td className="border border-ink-200 px-2 py-1">
                      {SHIFT_TYPE_LABEL[s.shiftType] ?? s.shiftType}
                    </td>
                    <td className="border border-ink-200 px-2 py-1">
                      {s.skuName}{" "}
                      <span className="font-mono text-ink-500">({s.skuCode})</span>
                    </td>
                    <td className="border border-ink-200 px-2 py-1 text-right font-semibold">
                      {num2(s.avgScore)}
                    </td>
                    <td className="border border-ink-200 px-2 py-1 text-right">
                      {num2(s.tier2Score)}
                    </td>
                    <td className="border border-ink-200 px-2 py-1 text-right">
                      {fmt(s.peopleCount)}
                    </td>
                    <td className="border border-ink-200 px-2 py-1 text-right">
                      {vnd(s.shiftBonus)}
                      {s.bonusLocked && (
                        <span className="ml-1 text-amber-800">(khoá)</span>
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
        <div className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 print:grid-cols-4">
          <Stat label="Lượt chấm" value={fmt(distribution.statistics.count)} />
          <Stat
            label="Trung bình"
            value={noSample ? "—" : num2(distribution.statistics.average)}
          />
          <Stat
            label="Trung vị"
            value={noSample ? "—" : num2(distribution.statistics.median)}
          />
          <Stat
            label="Độ lệch chuẩn"
            value={noSample ? "—" : num2(distribution.statistics.stdDev)}
          />
        </div>
        <table className="w-full text-sm tabular-nums">
          <tbody>
            {distribution.chartData.map((b) => (
              <tr key={b.range}>
                <td className="w-40 py-1 text-ink-600">
                  {b.range}{" "}
                  <span className="text-xs text-ink-500">
                    (hệ số {fmtNum(b.multiplier)}×)
                  </span>
                </td>
                <td className="py-1">
                  <div className="flex items-center gap-2">
                    <div
                      className={`h-4 rounded-sm ${bucketBar(b.multiplier)}`}
                      style={{ width: `${b.percentage}%`, minWidth: b.count ? 8 : 0 }}
                    />
                    <span className="text-xs font-medium text-ink-700">
                      {fmt(b.count)} lượt ({fmtPct(b.percentage)})
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
        <div className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 print:grid-cols-4">
          <Stat label="Số ngày có dữ liệu" value={fmt(trends.statistics.daysWithData)} />
          <Stat label="Số ca đã khoá" value={fmt(trends.statistics.totalShifts)} />
          <Stat label="Điểm cuối trung bình" value={num2(trends.statistics.avgScore)} />
          <Stat
            label="Tổng thưởng"
            value={
              trends.statistics.totalShifts === 0
                ? "—"
                : vnd(trends.statistics.totalBonusDistributed)
            }
          />
        </div>
        <table className="w-full border-collapse text-xs tabular-nums">
          <thead>
            <tr className="bg-ink-100">
              <th className="border border-ink-200 px-2 py-1 text-left">Ngày</th>
              <th className="border border-ink-200 px-2 py-1 text-right">Số ca</th>
              <th className="border border-ink-200 px-2 py-1 text-right">Lượt chấm</th>
              <th className="border border-ink-200 px-2 py-1 text-right">Điểm TB</th>
              <th className="border border-ink-200 px-2 py-1 text-right">Trung bình 3 ngày</th>
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
                  {fmt(d.shiftCount)}
                </td>
                <td className="border border-ink-200 px-2 py-1 text-right">
                  {fmt(d.peopleCount)}
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
          Báo cáo sinh tự động từ hệ thống quản lý công việc &amp; KPI ·{" "}
          {company?.value ?? "GANI FOODY"} · {fmtDateTime(new Date())}
        </p>
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-ink-200 bg-white p-3">
      <div className="text-xs font-medium text-ink-500">{label}</div>
      <div className="mt-1 text-xl font-bold text-ink-900 tabular-nums">{value}</div>
    </div>
  );
}

/** Số nguyên kiểu Việt Nam; null/NaN → "—" (lib/format) */
function fmt(n: number | null | undefined) {
  return fmtNum(n, 0);
}

/** Số tiền kèm ₫; null (đã ẩn với người không được xem tiền) → "—". */
function vnd(n: number | null | undefined) {
  return fmtVnd(n);
}

/** Số 2 chữ số thập phân kiểu Việt Nam ("98,50"); null (chưa có dữ liệu) → "—". */
function num2(n: number | null | undefined) {
  return fmtScore(n);
}

/** Màu cột theo hệ số thưởng: 0× đỏ · dưới 1× vàng · 1× lá nhạt · trên 1× lá đậm */
function bucketBar(multiplier: number) {
  if (multiplier <= 0) return "bg-red-600";
  if (multiplier < 1) return "bg-amber-500";
  if (multiplier === 1) return "bg-leaf-400";
  return "bg-leaf-600";
}

function pct(n: number | null | undefined) {
  const s = num2(n);
  return s === "—" ? s : `${s}%`;
}
