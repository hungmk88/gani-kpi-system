"use client";

interface KpiBreakdown {
  code: string;
  name: string;
  actual: number;
  target: number;
  unit: string;
  achievement: string;
  weight: number;
  score: string;
}

interface ScoreBreakdown {
  kpis: KpiBreakdown[];
  totalScore: string;
  bonusMultiplier: string;
  bonusAmount: string;
}

interface KpiScoreDisplayProps {
  scoreId: string;
  status: string;
  totalScore: number;
  bonusMultiplier: number;
  bonusAmount: number;
  breakdownJson: string | null;
  calculatedBy: { id: string; fullName: string } | null;
  calculatedAt: Date | null;
  approvedBy: { id: string; fullName: string } | null;
  approvedAt: Date | null;
}

export default function KpiScoreDisplay({
  scoreId,
  status,
  totalScore,
  bonusMultiplier,
  bonusAmount,
  breakdownJson,
  calculatedBy,
  calculatedAt,
  approvedBy,
  approvedAt,
}: KpiScoreDisplayProps) {
  const breakdown: ScoreBreakdown | null = breakdownJson
    ? JSON.parse(breakdownJson)
    : null;

  if (!breakdown) {
    return (
      <div className="card p-4 text-center text-gray-500">
        Chưa có dữ liệu tính điểm
      </div>
    );
  }

  const getScoreColor = (score: number) => {
    if (score >= 120) return "text-green-600";
    if (score >= 100) return "text-blue-600";
    if (score >= 90) return "text-yellow-600";
    return "text-red-600";
  };

  const getBonusColor = (multiplier: number) => {
    if (multiplier >= 1.5) return "bg-green-100 border-green-300";
    if (multiplier >= 1.0) return "bg-blue-100 border-blue-300";
    if (multiplier > 0) return "bg-yellow-100 border-yellow-300";
    return "bg-gray-100 border-gray-300";
  };

  return (
    <div className="card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b">
        <div>
          <p className="text-sm text-ink-500">Status:</p>
          <p className="font-semibold text-ink-900">
            {status === "CALCULATED" && "🧮 Đã Tính"}
            {status === "APPROVED" && "✅ Đã Phê Duyệt"}
            {status === "DRAFT" && "📝 Nháp"}
          </p>
        </div>
        {calculatedBy && calculatedAt && (
          <div className="text-right text-xs text-ink-500">
            <p>Tính bởi: <span className="font-medium">{calculatedBy.fullName}</span></p>
            <p>{new Date(calculatedAt).toLocaleString("vi-VN")}</p>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        {/* Total Score */}
        <div className="bg-gray-50 rounded p-3 text-center border border-gray-200">
          <p className="text-xs text-ink-600 mb-1">Tổng Điểm</p>
          <p className={`text-3xl font-bold ${getScoreColor(totalScore)}`}>
            {totalScore.toFixed(1)}
          </p>
          <p className="text-xs text-ink-500 mt-1">/ 100</p>
        </div>

        {/* Bonus Multiplier */}
        <div className={`rounded p-3 text-center border ${getBonusColor(bonusMultiplier)}`}>
          <p className="text-xs text-ink-600 mb-1">Hệ Số</p>
          <p className="text-3xl font-bold text-ink-900">
            {bonusMultiplier.toFixed(2)}x
          </p>
          <p className="text-xs text-ink-500 mt-1">Lương nền</p>
        </div>

        {/* Bonus Amount */}
        <div className="bg-green-50 rounded p-3 text-center border border-green-200">
          <p className="text-xs text-ink-600 mb-1">Tiền Thưởng</p>
          <p className="text-2xl font-bold text-green-600">
            {Math.round(bonusAmount).toLocaleString("vi-VN")}
          </p>
          <p className="text-xs text-ink-500 mt-1">VND</p>
        </div>
      </div>

      {/* KPI Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-100 border-b">
              <th className="px-2 py-2 text-left font-semibold">KPI</th>
              <th className="px-2 py-2 text-center font-semibold">Target</th>
              <th className="px-2 py-2 text-center font-semibold">Thực Tế</th>
              <th className="px-2 py-2 text-center font-semibold">Achievement</th>
              <th className="px-2 py-2 text-center font-semibold">Trọng Số</th>
              <th className="px-2 py-2 text-center font-semibold">Điểm</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.kpis.map((kpi, idx) => (
              <tr key={kpi.code} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                <td className="px-2 py-2 font-medium">{kpi.name}</td>
                <td className="px-2 py-2 text-center text-ink-600">
                  {kpi.target} {kpi.unit}
                </td>
                <td className="px-2 py-2 text-center font-semibold">
                  {kpi.actual} {kpi.unit}
                </td>
                <td className="px-2 py-2 text-center">
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold ${
                      parseFloat(kpi.achievement) >= 100
                        ? "bg-green-100 text-green-800"
                        : parseFloat(kpi.achievement) >= 90
                        ? "bg-yellow-100 text-yellow-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {kpi.achievement}%
                  </span>
                </td>
                <td className="px-2 py-2 text-center text-ink-600">
                  {kpi.weight}%
                </td>
                <td className="px-2 py-2 text-center font-semibold text-blue-600">
                  {kpi.score}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Approval Info */}
      {approvedBy && approvedAt && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          ✅ Phê duyệt bởi <span className="font-semibold">{approvedBy.fullName}</span> vào{" "}
          <span className="font-semibold">{new Date(approvedAt).toLocaleString("vi-VN")}</span>
        </div>
      )}
    </div>
  );
}
