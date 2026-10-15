"use client";

import { useEffect, useState } from "react";
import {
  CircleX,
  Download,
  Printer,
  BarChart3,
  TrendingUp,
  Info,
  Trophy,
} from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import {
  SHIFT_STATUSES,
  SHIFT_STATUS_LABEL,
  SHIFT_TYPE_LABEL,
} from "@/lib/production/constants";
import { formatVnDate } from "@/lib/vn-time";
import { StatCard, fmtScore } from "@/components/ui";

/**
 * Dashboard KPI sản xuất — đọc điểm THẬT của ca đã khoá số (DailyKpiResult),
 * cùng nguồn với KPI tháng và thưởng ca.
 *
 * Trường tiền = null khi người xem không được xem tiền (server đã ẩn).
 */
interface SummaryResponse {
  summary: {
    totalShifts: number;
    resultCount: number;
    avgScore: number | null;
    avgTier2Score: number | null;
    totalBonus: number | null;
    avgBonus: number | null;
    bonusLockedCount: number;
    percentBonusUnlocked: number | null;
  };
  statusCounts: Record<string, number>;
  shiftTypes: Record<string, number>;
  topScores: Array<{
    shiftId: string;
    shiftDate: string;
    shiftType: string;
    skuCode: string;
    skuName: string;
    peopleCount: number;
    avgScore: number;
    tier2Score: number | null;
    shiftBonus: number | null;
    bonusLocked: boolean;
  }>;
}

interface DistributionData {
  chartData: Array<{
    range: string;
    multiplier: number;
    count: number;
    percentage: number;
  }>;
  statistics: {
    count: number;
    average: number;
    median: number;
    stdDev: number;
  };
}

interface TrendsData {
  trendData: Array<{
    date: string;
    displayDate: string;
    shiftCount: number;
    avgScore: number | null;
    movingAvg: number | null;
  }>;
  statistics: {
    daysWithData: number;
    totalShifts: number;
    avgScore: number | null;
    totalBonusDistributed: number | null;
  };
}

/**
 * Màu cột theo hệ số thưởng — chỉ 4 màu ngữ nghĩa của hệ thiết kế:
 * 0× (mất thưởng) đỏ · dưới 1× vàng · 1× lá xanh nhạt · trên 1× lá xanh đậm.
 */
const bucketColor = (multiplier: number) =>
  multiplier <= 0
    ? "#d92d20" // red-600
    : multiplier < 1
      ? "#f59e0b" // amber-500
      : multiplier === 1
        ? "#55b65f" // leaf-400
        : "#2b7d37"; // leaf-600

/** Màu biểu đồ lấy từ token của globals.css (recharts cần mã màu thật) */
const CHART = {
  brand: "#1e89ca",
  ink300: "#cdcdc5",
  ink400: "#767669",
  grid: "#e4e4df",
  tick: "#66665c",
};

const fmtScoreOrDash = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : fmtScore(n);

/** Tiền đầy đủ kiểu Việt Nam: "135.000 ₫"; null (đã ẩn) → "—". */
const fmtMoney = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : `${Math.round(n).toLocaleString("vi-VN")} ₫`;

/** Tiền gọn cho thẻ số: từ 1 triệu trở lên ghi "1,2 tr ₫". */
const fmtMoneyShort = (n: number | null | undefined) => {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) >= 1_000_000) {
    return `${(n / 1_000_000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} tr ₫`;
  }
  return fmtMoney(n);
};

const fmtInt = (n: number) => n.toLocaleString("vi-VN");

type Period = "today" | "week" | "month";
const PERIOD_LABEL: Record<Period, string> = {
  month: "Tháng này",
  week: "Tuần này",
  today: "Hôm nay",
};

export default function DashboardClient() {
  // Mặc định tháng: đầu ngày "Hôm nay" gần như luôn trống (chưa ca nào khoá).
  const [period, setPeriod] = useState<Period>("month");
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [distribution, setDistribution] = useState<DistributionData | null>(null);
  const [trends, setTrends] = useState<TrendsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchData();
  }, [period]);

  /** Lỗi theo chuẩn { errorCode, message } của handle()/fail(); bản cũ dùng .error. */
  const readJson = async (res: Response) => {
    if (res.status === 401) {
      window.location.href = "/login";
      throw new Error("Phiên đăng nhập đã hết hạn.");
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(body?.message || body?.error || "Không tải được dữ liệu Dashboard.");
    }
    return body;
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      setError("");

      const [summaryBody, distBody, trendsBody] = await Promise.all([
        fetch(`/api/kpi/dashboard/summary?period=${period}`).then(readJson),
        fetch(`/api/kpi/dashboard/distribution`).then(readJson),
        fetch(`/api/kpi/dashboard/trends?days=7`).then(readJson),
      ]);

      setSummary(summaryBody.data);
      setDistribution(distBody.data);
      setTrends(trendsBody.data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Lỗi khi tải dữ liệu"
      );
    } finally {
      setLoading(false);
    }
  };

  // Thanh chọn kỳ + nút xuất — luôn hiện, kể cả khi đang tải hoặc lỗi
  const toolbar = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div
        role="tablist"
        aria-label="Chọn khoảng thời gian"
        className="flex gap-5 overflow-x-auto border-b border-ink-200"
      >
        {(["month", "week", "today"] as const).map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={period === p}
            onClick={() => setPeriod(p)}
            className={`-mb-px border-b-2 px-1 py-2.5 text-sm font-medium whitespace-nowrap transition ${
              period === p
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-ink-500 hover:text-ink-800"
            }`}
          >
            {PERIOD_LABEL[p]}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <a
          href={`/api/kpi/dashboard/export?period=${period}&days=7`}
          className="btn-ghost btn-sm"
        >
          <Download size={16} strokeWidth={2} /> Tải Excel
        </a>
        <a
          href={`/reports/kpi-dashboard?period=${period}&days=7`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost btn-sm"
        >
          <Printer size={16} strokeWidth={2} /> Xuất PDF
        </a>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        {toolbar}
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600"></div>
            <p className="mt-2 text-sm text-ink-600">Đang tải dữ liệu…</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        {toolbar}
        <div
          role="alert"
          className="flex items-center gap-1.5 rounded-[10px] border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <CircleX size={16} strokeWidth={2} className="shrink-0" /> {error}
        </div>
      </div>
    );
  }

  const s = summary?.summary;
  const pending =
    (summary?.statusCounts.DRAFT ?? 0) + (summary?.statusCounts.QC_APPROVED ?? 0);
  // Chưa có ca khoá thì "0 ₫ thưởng" là con số giả — chưa có gì để tính.
  const noShifts = !s || s.totalShifts === 0;

  return (
    <div className="space-y-6">
      {toolbar}

      {/* Chưa có ca khoá trong kỳ — thông tin, không phải báo động */}
      {s && s.totalShifts === 0 && (
        <div className="card flex items-start gap-2 p-4 text-sm text-ink-700">
          <Info size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-brand-600" />
          <div>
            <p className="font-semibold text-ink-900">
              Chưa có ca nào được khoá trong khoảng này.
            </p>
            <p className="mt-1">
              Điểm KPI ca chỉ sinh ra khi Ban Giám đốc khoá số ca sản xuất.
              {pending > 0 &&
                ` Hiện có ${fmtInt(pending)} ca trong kỳ đang chờ KCS xác nhận hoặc chờ khoá.`}
            </p>
          </div>
        </div>
      )}

      {/* Thẻ số */}
      {s && (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
          <StatCard
            label="Ca đã khoá"
            value={fmtInt(s.totalShifts)}
            hint={`${fmtInt(s.resultCount)} lượt chấm (người × ca)`}
          />
          <StatCard
            label="Điểm trung bình"
            value={fmtScoreOrDash(s.avgScore)}
            hint={
              s.avgTier2Score === null
                ? "Mốc đạt: 100 điểm"
                : `Tầng 2 trung bình ${fmtScore(s.avgTier2Score)} · mốc đạt 100`
            }
          />
          <StatCard
            label="Tổng thưởng"
            value={noShifts ? "—" : fmtMoneyShort(s.totalBonus)}
          />
          <StatCard
            label="Thưởng trung bình mỗi ca"
            value={noShifts ? "—" : fmtMoney(s.avgBonus)}
          />
          <div className="col-span-2 lg:col-span-1">
            <StatCard
              label="Tỷ lệ không bị khoá thưởng"
              value={
                noShifts || s.percentBonusUnlocked === null
                  ? "—"
                  : `${s.percentBonusUnlocked.toLocaleString("vi-VN")}%`
              }
              hint={
                s.bonusLockedCount > 0
                  ? `${fmtInt(s.bonusLockedCount)} lượt bị khoá do cảnh báo`
                  : "Không lượt nào bị khoá"
              }
              tone={s.bonusLockedCount > 0 ? "amber" : "slate"}
            />
          </div>
        </div>
      )}

      {/* Trạng thái ca + Top ca */}
      {summary && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="card p-5">
            <h2 className="section-title mb-3">Trạng thái ca trong kỳ</h2>
            <table className="w-full text-sm">
              <tbody>
                {SHIFT_STATUSES.map((st) => (
                  <tr key={st} className="border-b border-ink-100 last:border-0">
                    <td className="py-1.5 text-ink-600">{SHIFT_STATUS_LABEL[st]}</td>
                    <td className="py-1.5 text-right font-semibold tabular-nums text-ink-900">
                      {fmtInt(summary.statusCounts[st] ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card p-5 lg:col-span-2">
            <h2 className="section-title mb-3 flex items-center gap-1.5">
              <Trophy size={17} strokeWidth={2} className="text-ink-500" /> 5 ca có điểm
              trung bình cao nhất
            </h2>
            {summary.topScores.length === 0 ? (
              <p className="text-sm text-ink-500">Chưa có ca nào được khoá trong khoảng này.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink-500">
                      <th className="py-1 pr-2 font-medium">Ngày</th>
                      <th className="py-1 pr-2 font-medium">Ca</th>
                      <th className="py-1 pr-2 font-medium">Sản phẩm</th>
                      <th className="py-1 pr-2 text-right font-medium">Điểm TB</th>
                      <th className="py-1 pr-2 text-right font-medium">Tầng 2</th>
                      <th className="py-1 pr-2 text-right font-medium">Người</th>
                      <th className="py-1 text-right font-medium">Thưởng ca</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {summary.topScores.map((t) => (
                      <tr key={t.shiftId} className="border-t border-ink-100">
                        <td className="py-1.5 pr-2 whitespace-nowrap">
                          {formatVnDate(t.shiftDate)}
                        </td>
                        <td className="py-1.5 pr-2">
                          {SHIFT_TYPE_LABEL[t.shiftType] ?? t.shiftType}
                        </td>
                        <td className="py-1.5 pr-2">
                          {t.skuName}{" "}
                          <span className="font-mono text-xs text-ink-500">{t.skuCode}</span>
                        </td>
                        <td className="py-1.5 pr-2 text-right font-semibold">
                          {fmtScore(t.avgScore)}
                        </td>
                        <td className="py-1.5 pr-2 text-right">{fmtScoreOrDash(t.tier2Score)}</td>
                        <td className="py-1.5 pr-2 text-right">{fmtInt(t.peopleCount)}</td>
                        <td className="py-1.5 text-right whitespace-nowrap">
                          {fmtMoney(t.shiftBonus)}
                          {t.bonusLocked && (
                            <span className="ml-1 text-xs text-amber-800">(khoá)</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Phân bố điểm */}
        {distribution && (
          <div className="card p-5">
            <h2 className="section-title mb-1 flex items-center gap-1.5">
              <BarChart3 size={17} strokeWidth={2} className="text-ink-500" /> Phân bố điểm
              (30 ngày)
            </h2>
            <p className="mb-4 text-xs text-ink-500">
              Điểm cuối từng người trong ca đã khoá · mỗi cột là một bậc hệ số thưởng
            </p>
            {distribution.statistics.count === 0 ? (
              <p className="py-12 text-center text-sm text-ink-500">
                Chưa có ca nào được khoá trong 30 ngày qua.
              </p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={distribution.chartData.map((b) => ({
                      ...b,
                      label: `${b.range} (${b.multiplier.toLocaleString("vi-VN")}×)`,
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: CHART.tick }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: CHART.tick }} />
                    <Tooltip
                      formatter={(v) => [`${Number(v).toLocaleString("vi-VN")} lượt`, "Số lượt"]}
                    />
                    <Bar dataKey="count" name="Số lượt">
                      {distribution.chartData.map((b) => (
                        <Cell key={b.range} fill={bucketColor(b.multiplier)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-ink-500">Lượt chấm</p>
                    <p className="text-lg font-bold tabular-nums text-ink-900">
                      {fmtInt(distribution.statistics.count)}
                    </p>
                  </div>
                  <div>
                    <p className="text-ink-500">Trung bình</p>
                    <p className="text-lg font-bold tabular-nums text-ink-900">
                      {fmtScore(distribution.statistics.average)}
                    </p>
                  </div>
                  <div>
                    <p className="text-ink-500">Trung vị</p>
                    <p className="text-lg font-bold tabular-nums text-ink-900">
                      {fmtScore(distribution.statistics.median)}
                    </p>
                  </div>
                  <div>
                    <p className="text-ink-500">Độ lệch chuẩn</p>
                    <p className="text-lg font-bold tabular-nums text-ink-900">
                      {fmtScore(distribution.statistics.stdDev)}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Xu hướng */}
        {trends && (
          <div className="card p-5">
            <h2 className="section-title mb-4 flex items-center gap-1.5">
              <TrendingUp size={17} strokeWidth={2} className="text-ink-500" /> Xu hướng (7
              ngày)
            </h2>
            {trends.statistics.daysWithData === 0 ? (
              <p className="py-12 text-center text-sm text-ink-500">
                Chưa có ca nào được khoá trong 7 ngày qua.
              </p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={trends.trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                    <XAxis dataKey="displayDate" tick={{ fontSize: 12, fill: CHART.tick }} />
                    {/* Thực tế điểm cuối tối đa ~112 (trần kỹ thuật 150) */}
                    <YAxis
                      tick={{ fontSize: 12, fill: CHART.tick }}
                      domain={[
                        0,
                        (dataMax: number) =>
                          Math.max(120, Math.ceil(dataMax / 10) * 10),
                      ]}
                    />
                    <Tooltip
                      formatter={(v, name) => [
                        typeof v === "number" ? fmtScore(v) : String(v ?? "—"),
                        name,
                      ]}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <ReferenceLine
                      y={100}
                      stroke={CHART.ink300}
                      strokeDasharray="3 3"
                      label={{
                        value: "100 = đạt",
                        position: "insideTopLeft",
                        fontSize: 12,
                        fill: CHART.tick,
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="avgScore"
                      stroke={CHART.brand}
                      strokeWidth={2}
                      name="Điểm trung bình"
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="movingAvg"
                      stroke={CHART.ink400}
                      name="Trung bình 3 ngày"
                      strokeDasharray="5 5"
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
                <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-ink-500">Ca đã khoá</p>
                    <p className="text-lg font-bold tabular-nums text-ink-900">
                      {fmtInt(trends.statistics.totalShifts)}
                    </p>
                  </div>
                  <div>
                    <p className="text-ink-500">Điểm trung bình</p>
                    <p className="text-lg font-bold tabular-nums text-ink-900">
                      {fmtScoreOrDash(trends.statistics.avgScore)}
                    </p>
                  </div>
                  <div>
                    <p className="text-ink-500">Tổng thưởng</p>
                    <p className="text-lg font-bold tabular-nums text-ink-900">
                      {trends.statistics.totalShifts === 0
                        ? "—"
                        : fmtMoneyShort(trends.statistics.totalBonusDistributed)}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
