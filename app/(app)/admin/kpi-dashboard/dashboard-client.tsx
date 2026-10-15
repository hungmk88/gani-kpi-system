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
  PieChart,
  Pie,
  Cell,
} from "recharts";

/** Trường tiền = null khi người xem không được xem tiền (server đã ẩn). */
interface SummaryData {
  totalShifts: number;
  avgScore: number;
  totalBonus: number | null;
  avgBonus: number | null;
  percentApproved: number;
}

interface DistributionData {
  chartData: Array<{
    range: string;
    count: number;
    percentage: number;
  }>;
  statistics: {
    average: number;
    median: number;
    stdDev: number;
  };
}

interface TrendsData {
  trendData: Array<{
    date: string;
    displayDate: string;
    avgScore: number | null;
    movingAvg: number | null;
  }>;
  statistics: {
    totalShifts: number;
    avgDailyScore: number;
    totalBonusDistributed: number | null;
  };
}

const COLORS = ["#ef4444", "#f97316", "#eab308", "#84cc16", "#22c55e", "#10b981"];

export default function DashboardClient() {
  const [period, setPeriod] = useState<"today" | "week" | "month">("today");
  const [summary, setSummary] = useState<SummaryData | null>(null);
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

      setSummary(summaryBody.data.summary);
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

      {/* Summary Cards */}
      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="card p-4">
            <p className="text-xs text-ink-600 font-medium mb-2">
              Tổng Ca Tính
            </p>
            <p className="text-3xl font-bold text-ink-900">
              {summary.totalShifts}
            </p>
          </div>

          <div className="card p-4">
            <p className="text-xs text-ink-600 font-medium mb-2">
              Điểm Trung Bình
            </p>
            <p className="text-3xl font-bold text-brand-600">
              {summary.avgScore.toFixed(1)}
            </p>
            <p className="text-xs text-ink-500 mt-1">100 = đạt · trần 150</p>
          </div>

          <div className="card p-4">
            <p className="text-xs text-ink-600 font-medium mb-2">
              Tổng Thưởng
            </p>
            <p className="text-3xl font-bold text-green-600">
              {summary.totalBonus === null
                ? "—"
                : `${(summary.totalBonus / 1000000).toFixed(1)}M`}
            </p>
            <p className="text-xs text-ink-500 mt-1">VND</p>
          </div>

          <div className="card p-4">
            <p className="text-xs text-ink-600 font-medium mb-2">
              Trung Bình/Ca
            </p>
            <p className="text-3xl font-bold text-violet-600">
              {summary.avgBonus === null
                ? "—"
                : `${(summary.avgBonus / 1000).toFixed(0)}K`}
            </p>
            <p className="text-xs text-ink-500 mt-1">VND</p>
          </div>

          <div className="card p-4">
            <p className="text-xs text-ink-600 font-medium mb-2">
              Phê Duyệt
            </p>
            <p className="text-3xl font-bold text-cyan-600">
              {summary.percentApproved}%
            </p>
            <p className="text-xs text-ink-500 mt-1">Đã duyệt</p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Score Distribution */}
        {distribution && (
          <div className="card p-5">
            <h2 className="section-title mb-4 flex items-center gap-1.5">
              <BarChart3 size={17} strokeWidth={2} /> Phân Bố Điểm (30 ngày)
            </h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={distribution.chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="range" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
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
          </div>
        )}

        {/* Trends */}
        {trends && (
          <div className="card p-5">
            <h2 className="section-title mb-4 flex items-center gap-1.5">
              <TrendingUp size={17} strokeWidth={2} /> Xu Hướng (7 ngày)
            </h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trends.trendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="displayDate" />
                <YAxis domain={[0, 150]} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="avgScore"
                  stroke="#f97316"
                  name="Điểm Thực"
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="movingAvg"
                  stroke="#3b82f6"
                  name="MA 3D"
                  strokeDasharray="5 5"
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div>
                <p className="text-ink-600">Trung Bình KỲ</p>
                <p className="text-lg font-bold">
                  {trends.statistics.avgDailyScore.toFixed(1)}
                </p>
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
          </div>
        )}
      </div>
    </div>
  );
}
