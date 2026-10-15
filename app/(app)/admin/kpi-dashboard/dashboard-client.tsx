"use client";

import { useEffect, useState } from "react";
import {
  CircleX,
  CalendarDays,
  CalendarRange,
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

/** Màu theo bậc thưởng: <90 đỏ → ≥110 xanh đậm. */
const BUCKET_COLORS = ["#ef4444", "#f97316", "#84cc16", "#22c55e", "#059669"];

const fmt1 = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toFixed(1);

export default function DashboardClient() {
  const [period, setPeriod] = useState<"today" | "week" | "month">("today");
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-brand-300 border-t-brand-600"></div>
          <p className="mt-2 text-ink-600">Đang tải dữ liệu...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card flex items-center gap-1.5 border-red-200 bg-red-50 p-4 text-red-800">
        <CircleX size={16} strokeWidth={2} /> {error}
      </div>
    );
  }

  const s = summary?.summary;
  const pending =
    (summary?.statusCounts.DRAFT ?? 0) + (summary?.statusCounts.QC_APPROVED ?? 0);

  return (
    <div className="space-y-6">
      {/* Period Selector */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            {(["today", "week", "month"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded font-medium transition ${
                  period === p
                    ? "bg-brand-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {p === "today" && (
                  <>
                    <CalendarDays size={15} strokeWidth={2} /> Hôm Nay
                  </>
                )}
                {p === "week" && (
                  <>
                    <CalendarRange size={15} strokeWidth={2} /> Tuần Này
                  </>
                )}
                {p === "month" && (
                  <>
                    <CalendarDays size={15} strokeWidth={2} /> Tháng Này
                  </>
                )}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <a
              href={`/api/kpi/dashboard/export?period=${period}&days=7`}
              className="btn-ghost inline-flex items-center gap-1.5"
            >
              <Download size={15} strokeWidth={2} /> Tải Excel
            </a>
            <a
              href={`/reports/kpi-dashboard?period=${period}&days=7`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost inline-flex items-center gap-1.5"
            >
              <Printer size={15} strokeWidth={2} /> Xuất PDF
            </a>
          </div>
        </div>
      </div>

      {/* Chưa có ca khoá trong kỳ */}
      {s && s.totalShifts === 0 && (
        <div className="card flex items-start gap-2 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <Info size={16} strokeWidth={2} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Chưa có ca nào được khoá trong khoảng này.</p>
            <p className="mt-1">
              Điểm KPI ca chỉ sinh ra khi Ban Giám đốc khoá số ca sản xuất.
              {pending > 0 &&
                ` Hiện có ${pending} ca trong kỳ đang chờ KCS xác nhận hoặc chờ khoá.`}
            </p>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      {s && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="card p-4">
            <p className="text-xs text-ink-600 font-medium mb-2">Ca Đã Khoá</p>
            <p className="text-3xl font-bold text-ink-900">{s.totalShifts}</p>
            <p className="text-xs text-ink-500 mt-1">{s.resultCount} lượt chấm (người × ca)</p>
          </div>

          <div className="card p-4">
            <p className="text-xs text-ink-600 font-medium mb-2">Điểm Trung Bình</p>
            <p className="text-3xl font-bold text-brand-600">{fmt1(s.avgScore)}</p>
            <p className="text-xs text-ink-500 mt-1">
              Tầng 2 TB {fmt1(s.avgTier2Score)} · 100 = đạt
            </p>
          </div>

          <div className="card p-4">
            <p className="text-xs text-ink-600 font-medium mb-2">Tổng Thưởng</p>
            <p className="text-3xl font-bold text-green-600">
              {s.totalBonus === null
                ? "—"
                : `${(s.totalBonus / 1000000).toFixed(1)}M`}
            </p>
            <p className="text-xs text-ink-500 mt-1">VND</p>
          </div>

          <div className="card p-4">
            <p className="text-xs text-ink-600 font-medium mb-2">Thưởng TB/Ca</p>
            <p className="text-3xl font-bold text-violet-600">
              {s.avgBonus === null ? "—" : `${(s.avgBonus / 1000).toFixed(0)}K`}
            </p>
            <p className="text-xs text-ink-500 mt-1">VND</p>
          </div>

          <div className="card p-4">
            <p className="text-xs text-ink-600 font-medium mb-2">
              % Không Bị Khoá Thưởng
            </p>
            <p className="text-3xl font-bold text-cyan-600">
              {s.percentBonusUnlocked === null ? "—" : `${s.percentBonusUnlocked}%`}
            </p>
            <p className="text-xs text-ink-500 mt-1">
              {s.bonusLockedCount} lượt bị khoá do cảnh báo
            </p>
          </div>
        </div>
      )}

      {/* Pipeline + Top ca */}
      {summary && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="card p-5">
            <h2 className="section-title mb-3">Trạng thái ca trong kỳ</h2>
            <table className="w-full text-sm">
              <tbody>
                {SHIFT_STATUSES.map((st) => (
                  <tr key={st} className="border-b border-ink-100 last:border-0">
                    <td className="py-1.5 text-ink-600">{SHIFT_STATUS_LABEL[st]}</td>
                    <td className="py-1.5 text-right font-semibold">
                      {summary.statusCounts[st] ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card p-5 lg:col-span-2">
            <h2 className="section-title mb-3 flex items-center gap-1.5">
              <Trophy size={17} strokeWidth={2} /> Top 5 ca điểm TB cao nhất
            </h2>
            {summary.topScores.length === 0 ? (
              <p className="text-sm text-ink-500">Chưa có ca nào được khoá trong khoảng này.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink-500">
                      <th className="py-1 pr-2">Ngày</th>
                      <th className="py-1 pr-2">Ca</th>
                      <th className="py-1 pr-2">Sản phẩm</th>
                      <th className="py-1 pr-2 text-right">Điểm TB</th>
                      <th className="py-1 pr-2 text-right">Tầng 2</th>
                      <th className="py-1 pr-2 text-right">Người</th>
                      <th className="py-1 text-right">Thưởng ca</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.topScores.map((t) => (
                      <tr key={t.shiftId} className="border-t border-ink-100">
                        <td className="py-1.5 pr-2">{formatVnDate(t.shiftDate)}</td>
                        <td className="py-1.5 pr-2">
                          {SHIFT_TYPE_LABEL[t.shiftType] ?? t.shiftType}
                        </td>
                        <td className="py-1.5 pr-2">
                          {t.skuName}{" "}
                          <span className="text-xs text-ink-400">{t.skuCode}</span>
                        </td>
                        <td className="py-1.5 pr-2 text-right font-semibold">
                          {t.avgScore.toFixed(1)}
                        </td>
                        <td className="py-1.5 pr-2 text-right">{fmt1(t.tier2Score)}</td>
                        <td className="py-1.5 pr-2 text-right">{t.peopleCount}</td>
                        <td className="py-1.5 text-right">
                          {t.shiftBonus === null
                            ? "—"
                            : `${(t.shiftBonus / 1000).toFixed(0)}K`}
                          {t.bonusLocked && (
                            <span className="ml-1 text-xs text-amber-700">(khoá)</span>
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
        {/* Score Distribution */}
        {distribution && (
          <div className="card p-5">
            <h2 className="section-title mb-1 flex items-center gap-1.5">
              <BarChart3 size={17} strokeWidth={2} /> Phân Bố Điểm (30 ngày)
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
                      label: `${b.range} (${b.multiplier}×)`,
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} />
                    <Tooltip
                      formatter={(v) => [`${v} lượt`, "Số lượt"]}
                    />
                    <Bar dataKey="count" name="Số lượt">
                      {distribution.chartData.map((b, i) => (
                        <Cell
                          key={b.range}
                          fill={BUCKET_COLORS[i % BUCKET_COLORS.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-4 grid grid-cols-4 gap-2 text-sm">
                  <div>
                    <p className="text-ink-600">Lượt Chấm</p>
                    <p className="text-lg font-bold">{distribution.statistics.count}</p>
                  </div>
                  <div>
                    <p className="text-ink-600">Trung Bình</p>
                    <p className="text-lg font-bold">
                      {distribution.statistics.average.toFixed(1)}
                    </p>
                  </div>
                  <div>
                    <p className="text-ink-600">Trung Vị</p>
                    <p className="text-lg font-bold">
                      {distribution.statistics.median.toFixed(1)}
                    </p>
                  </div>
                  <div>
                    <p className="text-ink-600">Độ Lệch</p>
                    <p className="text-lg font-bold">
                      {distribution.statistics.stdDev.toFixed(1)}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Trends */}
        {trends && (
          <div className="card p-5">
            <h2 className="section-title mb-4 flex items-center gap-1.5">
              <TrendingUp size={17} strokeWidth={2} /> Xu Hướng (7 ngày)
            </h2>
            {trends.statistics.daysWithData === 0 ? (
              <p className="py-12 text-center text-sm text-ink-500">
                Chưa có ca nào được khoá trong 7 ngày qua.
              </p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={trends.trendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="displayDate" />
                    {/* Thực tế điểm cuối tối đa ~112 (trần kỹ thuật 150) */}
                    <YAxis
                      domain={[
                        0,
                        (dataMax: number) =>
                          Math.max(120, Math.ceil(dataMax / 10) * 10),
                      ]}
                    />
                    <Tooltip />
                    <Legend />
                    <ReferenceLine
                      y={100}
                      stroke="#94a3b8"
                      strokeDasharray="3 3"
                      label={{ value: "100 = đạt", position: "insideTopLeft", fontSize: 10 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="avgScore"
                      stroke="#f97316"
                      name="Điểm TB"
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="movingAvg"
                      stroke="#3b82f6"
                      name="MA 3 ngày"
                      strokeDasharray="5 5"
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
                <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="text-ink-600">Ca Đã Khoá</p>
                    <p className="text-lg font-bold">{trends.statistics.totalShifts}</p>
                  </div>
                  <div>
                    <p className="text-ink-600">Điểm TB Kỳ</p>
                    <p className="text-lg font-bold">{fmt1(trends.statistics.avgScore)}</p>
                  </div>
                  <div>
                    <p className="text-ink-600">Tổng Thưởng</p>
                    <p className="text-lg font-bold">
                      {trends.statistics.totalBonusDistributed === null
                        ? "—"
                        : `${(trends.statistics.totalBonusDistributed / 1000).toFixed(0)}K`}
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
