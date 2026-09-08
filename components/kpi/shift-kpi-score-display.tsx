// File: components/kpi/shift-kpi-score-display.tsx

"use client";

import { useEffect, useState } from "react";

interface KpiBreakdown {
  code: string;
  name: string;
  actual: number;
  target: number;
  unit: string;
  achievement: string; // percentage
  weight: number;
  score: string;
}

interface ScoreBreakdown {
  kpis: KpiBreakdown[];
  totalScore: string;
  bonusMultiplier: string;
  bonusAmount: string;
}

interface ShiftKpiScoreDisplayProps {
  shiftLogId: string;
  onApprove?: (scoreId: string) => void;
}

export function ShiftKpiScoreDisplay({
  shiftLogId,
  onApprove,
}: ShiftKpiScoreDisplayProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [score, setScore] = useState<any>(null);
  const [breakdown, setBreakdown] = useState<ScoreBreakdown | null>(null);

  useEffect(() => {
    fetchScore();
  }, [shiftLogId]);

  const fetchScore = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/kpi/calculate/${shiftLogId}`);

      if (!response.ok) throw new Error("Failed to fetch score");

      const data = await response.json();
      setScore(data.data);
      if (data.data.breakdown) {
        setBreakdown(data.data.breakdown);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi tải dữ liệu");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Đang tải dữ liệu...</div>;
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        {error}
      </div>
    );
  }

  if (!score || !breakdown) {
    return (
      <div className="text-center py-8 text-gray-500">
        Chưa có dữ liệu tính điểm
      </div>
    );
  }

  const totalScore = parseFloat(breakdown.totalScore);
  const bonusMultiplier = parseFloat(breakdown.bonusMultiplier);
  const bonusAmount = parseFloat(breakdown.bonusAmount);

  // Color based on score
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
    <div className="bg-white rounded-lg shadow-lg p-6 space-y-6">
      {/* Header */}
      <div className="border-b pb-4">
        <h2 className="text-2xl font-bold text-gray-900">📊 Kết Quả KPI</h2>
        <p className="text-sm text-gray-600 mt-1">
          Status: <span className="font-medium">{score.status}</span>
        </p>
      </div>

      {/* Total Score & Bonus Summary */}
      <div className="grid grid-cols-3 gap-4">
        {/* Total Score */}
        <div className="bg-gray-50 rounded-lg p-4 text-center border-2 border-gray-200">
          <p className="text-gray-600 text-sm font-medium mb-2">Tổng Điểm</p>
          <p className={`text-4xl font-bold ${getScoreColor(totalScore)}`}>
            {totalScore.toFixed(1)}
          </p>
          <p className="text-xs text-gray-600 mt-1">/ 100 điểm</p>
        </div>

        {/* Bonus Multiplier */}
        <div className={`rounded-lg p-4 text-center border-2 ${getBonusColor(bonusMultiplier)}`}>
          <p className="text-gray-600 text-sm font-medium mb-2">Hệ Số Thưởng</p>
          <p className="text-4xl font-bold text-gray-900">
            {bonusMultiplier.toFixed(2)}x
          </p>
          <p className="text-xs text-gray-600 mt-1">Lương nền: 233.000đ</p>
        </div>

        {/* Bonus Amount */}
        <div className="bg-green-50 rounded-lg p-4 text-center border-2 border-green-200">
          <p className="text-gray-600 text-sm font-medium mb-2">Tiền Thưởng</p>
          <p className="text-3xl font-bold text-green-600">
            {bonusAmount.toLocaleString("vi-VN")}
          </p>
          <p className="text-xs text-gray-600 mt-1">VND</p>
        </div>
      </div>

      {/* 6 KPI Breakdown Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 border-b-2 border-gray-300">
              <th className="px-4 py-2 text-left font-semibold text-gray-700">
                KPI
              </th>
              <th className="px-4 py-2 text-center font-semibold text-gray-700">
                Target
              </th>
              <th className="px-4 py-2 text-center font-semibold text-gray-700">
                Thực Tế
              </th>
              <th className="px-4 py-2 text-center font-semibold text-gray-700">
                Achievement %
              </th>
              <th className="px-4 py-2 text-center font-semibold text-gray-700">
                Trọng Số
              </th>
              <th className="px-4 py-2 text-center font-semibold text-gray-700">
                Điểm
              </th>
            </tr>
          </thead>
          <tbody>
            {breakdown.kpis.map((kpi, idx) => (
              <tr
                key={kpi.code}
                className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}
              >
                <td className="px-4 py-3 font-medium text-gray-900">
                  {kpi.name}
                </td>
                <td className="px-4 py-3 text-center text-gray-600">
                  {kpi.target} {kpi.unit}
                </td>
                <td className="px-4 py-3 text-center font-semibold text-gray-900">
                  {kpi.actual} {kpi.unit}
                </td>
                <td className="px-4 py-3 text-center">
                  <span
                    className={`inline-block px-2 py-1 rounded font-semibold ${
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
                <td className="px-4 py-3 text-center text-gray-600">
                  {kpi.weight}%
                </td>
                <td className="px-4 py-3 text-center font-semibold text-blue-600">
                  {kpi.score}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="grid grid-cols-3 gap-4 pt-4 border-t">
        <div className="text-sm">
          <p className="font-medium text-gray-700 mb-2">📊 Quy Tắc Điểm:</p>
          <ul className="space-y-1 text-gray-600">
            <li>✅ ≥120%: 1.5x (349.500đ)</li>
            <li>✅ 100-119%: 1.0x (233.000đ)</li>
            <li>⚠️ 90-99%: 0.75x (174.750đ)</li>
            <li>❌ &lt;90%: 0x (0đ)</li>
          </ul>
        </div>

        <div className="text-sm">
          <p className="font-medium text-gray-700 mb-2">📈 Trọng Số KPI:</p>
          <ul className="space-y-1 text-gray-600">
            <li>Sản Lượng: 25%</li>
            <li>Hao Hụt: 25%</li>
            <li>Chất Lượng: 20%</li>
            <li>Đúng Spec: 15%</li>
          </ul>
        </div>

        <div className="text-sm">
          <p className="font-medium text-gray-700 mb-2">🎯 Tiếp Theo:</p>
          <ul className="space-y-1 text-gray-600">
            <li>An Toàn: 10%</li>
            <li>Deadline: 5%</li>
            <li>Total: 100%</li>
          </ul>
        </div>
      </div>

      {/* Action Buttons */}
      {score.status === "CALCULATED" && onApprove && (
        <div className="flex gap-4 pt-4">
          <button
            onClick={() => onApprove(score.id)}
            className="flex-1 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
          >
            ✅ Phê Duyệt
          </button>
          <button
            onClick={fetchScore}
            className="px-6 py-2 bg-gray-300 text-gray-800 rounded-lg hover:bg-gray-400 font-medium"
          >
            🔄 Tải Lại
          </button>
        </div>
      )}

      {score.status === "APPROVED" && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-green-800">
          ✅ Kết quả đã được phê duyệt vào {new Date(score.approvedAt).toLocaleString("vi-VN")}
        </div>
      )}
    </div>
  );
}
