// File: components/kpi/shift-kpi-score-display.tsx

"use client";

import { useCallback, useEffect, useState } from "react";
import { formatVnDateTime } from "@/lib/vn-time";

/** Hỗ trợ cả breakdown bản cũ (chuỗi toFixed) lẫn bản mới (số / null). */
interface KpiBreakdown {
  code: string;
  name: string;
  actual: number | string | null;
  target: number | string | null;
  unit: string;
  achievement: number | string | null; // null = chưa có dữ liệu
  weight: number;
  effectiveWeight?: number;
  score: number | string;
  included?: boolean;
}

interface ScoreBreakdown {
  kpis: KpiBreakdown[];
}

interface ScoreData {
  id: string;
  status: string;
  totalScore: number;
  bonusMultiplier: number;
  /** null = người xem không được xem tiền */
  bonusAmount: number | null;
  baseSalary: number | null;
  approvedAt: string | null;
}

const num = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === "" ? null : Number(v);

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
  const [score, setScore] = useState<ScoreData | null>(null);
  const [breakdown, setBreakdown] = useState<ScoreBreakdown | null>(null);

  const fetchScore = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await fetch(`/api/kpi/calculate/${shiftLogId}`);

      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (response.status === 404) {
        setScore(null);
        setBreakdown(null);
        return;
      }
      if (!response.ok) {
        // Chuẩn lỗi { errorCode, message } của handle()/fail(); bản cũ dùng .error
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || body?.error || "Không tải được điểm KPI.");
      }

      const data = await response.json();
      setScore(data.data);
      setBreakdown(Array.isArray(data.data?.breakdown?.kpis) ? data.data.breakdown : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi tải dữ liệu");
    } finally {
      setLoading(false);
    }
  }, [shiftLogId]);

  useEffect(() => {
    fetchScore();
  }, [fetchScore]);

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

  const totalScore = score.totalScore;
  const bonusMultiplier = score.bonusMultiplier;
  const bonusAmount = score.bonusAmount;

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
      <div className={`grid gap-4 ${bonusAmount !== null ? "grid-cols-3" : "grid-cols-2"}`}>
        {/* Total Score */}
        <div className="bg-gray-50 rounded-lg p-4 text-center border-2 border-gray-200">
          <p className="text-gray-600 text-sm font-medium mb-2">Tổng Điểm</p>
          <p className={`text-4xl font-bold ${getScoreColor(totalScore)}`}>
            {totalScore.toFixed(1)}
          </p>
          <p className="text-xs text-gray-600 mt-1">100 = đạt kế hoạch · trần 150</p>
        </div>

        {/* Bonus Multiplier */}
        <div className={`rounded-lg p-4 text-center border-2 ${getBonusColor(bonusMultiplier)}`}>
          <p className="text-gray-600 text-sm font-medium mb-2">Hệ Số Thưởng</p>
          <p className="text-4xl font-bold text-gray-900">
            {bonusMultiplier.toFixed(2)}x
          </p>
          {score.baseSalary !== null && (
            <p className="text-xs text-gray-600 mt-1">
              Lương nền: {Math.round(score.baseSalary).toLocaleString("vi-VN")}đ
            </p>
          )}
        </div>

        {/* Bonus Amount — chỉ người được xem tiền */}
        {bonusAmount !== null && (
          <div className="bg-green-50 rounded-lg p-4 text-center border-2 border-green-200">
            <p className="text-gray-600 text-sm font-medium mb-2">Tiền Thưởng</p>
            <p className="text-3xl font-bold text-green-600">
              {Math.round(bonusAmount).toLocaleString("vi-VN")}
            </p>
            <p className="text-xs text-gray-600 mt-1">VND</p>
          </div>
        )}
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
            {breakdown.kpis.map((kpi, idx) => {
              const ach = num(kpi.achievement);
              const actual = num(kpi.actual);
              const target = num(kpi.target);
              const excluded = kpi.included === false || ach === null;
              return (
                <tr
                  key={kpi.code}
                  className={`${idx % 2 === 0 ? "bg-white" : "bg-gray-50"} ${excluded ? "text-gray-400" : ""}`}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {kpi.name}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-600">
                    {target === null ? "—" : `${target} ${kpi.unit}`}
                  </td>
                  <td className="px-4 py-3 text-center font-semibold text-gray-900">
                    {actual === null ? (
                      <span className="font-normal italic text-gray-400">Chưa có dữ liệu</span>
                    ) : (
                      `${actual} ${kpi.unit}`
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {ach === null || excluded ? (
                      <span className="italic">Không tính</span>
                    ) : (
                      <span
                        className={`inline-block px-2 py-1 rounded font-semibold ${
                          ach >= 100
                            ? "bg-green-100 text-green-800"
                            : ach >= 90
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-red-100 text-red-800"
                        }`}
                      >
                        {ach.toFixed(2)}%
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-600">
                    {kpi.weight}%
                    {!excluded &&
                      kpi.effectiveWeight !== undefined &&
                      kpi.effectiveWeight !== kpi.weight && (
                        <span className="block text-xs text-gray-400">
                          → {kpi.effectiveWeight}%
                        </span>
                      )}
                  </td>
                  <td className="px-4 py-3 text-center font-semibold text-blue-600">
                    {excluded ? "—" : Number(kpi.score).toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Ghi chú — trọng số và bậc thưởng lấy từ cấu hình (Quản trị → 6 chỉ tiêu,
          BonusConfig), không viết cứng ở đây để khỏi lệch số thật. */}
      <div className="pt-4 border-t text-sm text-gray-600 space-y-1">
        <p>
          Bậc thưởng: ≥120 điểm, 100–&lt;120, 90–&lt;100, &lt;90 — hệ số theo cấu hình
          BonusConfig. Tổng điểm trần 150.
        </p>
        <p>
          Chỉ tiêu &quot;Chưa có dữ liệu&quot; không được tính; trọng số của nó chia lại
          cho các chỉ tiêu còn lại.
        </p>
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
          ✅ Kết quả đã được phê duyệt vào {formatVnDateTime(score.approvedAt)}
        </div>
      )}
    </div>
  );
}
