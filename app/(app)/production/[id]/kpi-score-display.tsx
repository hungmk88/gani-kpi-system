"use client";

import { Calculator, CircleCheck, FileEdit } from "lucide-react";
import { formatVnDateTime } from "@/lib/vn-time";

/**
 * breakdownJson có 2 dạng:
 *   - bản cũ: achievement/score là chuỗi toFixed, kèm bonusAmount trong JSON
 *   - bản mới (version 2): số hoặc null; achievement null = "chưa có dữ liệu",
 *     included=false = bị loại khỏi tổng, effectiveWeight = trọng số sau chia lại
 */
interface KpiBreakdown {
  code: string;
  name: string;
  actual: number | string | null;
  target: number | string | null;
  unit: string;
  achievement: number | string | null;
  weight: number;
  effectiveWeight?: number;
  score: number | string;
  included?: boolean;
}

interface ScoreBreakdown {
  kpis: KpiBreakdown[];
}

interface KpiScoreDisplayProps {
  scoreId: string;
  status: string;
  totalScore: number;
  bonusMultiplier: number;
  /** null/undefined = người xem không được xem tiền → ẩn ô tiền thưởng */
  bonusAmount?: number | null;
  breakdownJson: string | null;
  calculatedBy: { id: string; fullName: string } | null;
  calculatedAt: Date | string | null;
  approvedBy: { id: string; fullName: string } | null;
  approvedAt: Date | string | null;
}

const num = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === "" ? null : Number(v);

function parse(json: string | null): ScoreBreakdown | null {
  if (!json) return null;
  try {
    const b = JSON.parse(json);
    return Array.isArray(b?.kpis) ? (b as ScoreBreakdown) : null;
  } catch {
    return null;
  }
}

export default function KpiScoreDisplay({
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
  const breakdown = parse(breakdownJson);

  if (!breakdown) {
    return (
      <div className="card p-4 text-center text-gray-500">
        Chưa có dữ liệu tính điểm
      </div>
    );
  }

  const showMoney = bonusAmount !== null && bonusAmount !== undefined;

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

  const hasExcluded = breakdown.kpis.some(
    (k) => k.included === false || num(k.achievement) === null
  );

  return (
    <div className="card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b">
        <div>
          <p className="text-sm text-ink-500">Trạng thái:</p>
          <p className="flex items-center gap-1.5 font-semibold text-ink-900">
            {status === "CALCULATED" && (
              <>
                <Calculator size={15} strokeWidth={2} /> Đã Tính
              </>
            )}
            {status === "APPROVED" && (
              <>
                <CircleCheck size={15} strokeWidth={2} /> Đã Phê Duyệt
              </>
            )}
            {status === "DRAFT" && (
              <>
                <FileEdit size={15} strokeWidth={2} /> Nháp
              </>
            )}
          </p>
        </div>
        {calculatedBy && calculatedAt && (
          <div className="text-right text-xs text-ink-500">
            <p>Tính bởi: <span className="font-medium">{calculatedBy.fullName}</span></p>
            <p>{formatVnDateTime(calculatedAt)}</p>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className={`grid gap-3 ${showMoney ? "grid-cols-3" : "grid-cols-2"}`}>
        <div className="bg-gray-50 rounded p-3 text-center border border-gray-200">
          <p className="text-xs text-ink-600 mb-1">Tổng Điểm</p>
          <p className={`text-3xl font-bold ${getScoreColor(totalScore)}`}>
            {totalScore.toFixed(1)}
          </p>
          <p className="text-xs text-ink-500 mt-1">100 = đạt kế hoạch · trần 150</p>
        </div>

        <div className={`rounded p-3 text-center border ${getBonusColor(bonusMultiplier)}`}>
          <p className="text-xs text-ink-600 mb-1">Hệ Số</p>
          <p className="text-3xl font-bold text-ink-900">
            {bonusMultiplier.toFixed(2)}x
          </p>
          <p className="text-xs text-ink-500 mt-1">Lương nền</p>
        </div>

        {showMoney && (
          <div className="bg-green-50 rounded p-3 text-center border border-green-200">
            <p className="text-xs text-ink-600 mb-1">Tiền Thưởng</p>
            <p className="text-2xl font-bold text-green-600">
              {Math.round(bonusAmount).toLocaleString("vi-VN")}
            </p>
            <p className="text-xs text-ink-500 mt-1">VND</p>
          </div>
        )}
      </div>

      {/* KPI Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-100 border-b">
              <th className="px-2 py-2 text-left font-semibold">KPI</th>
              <th className="px-2 py-2 text-center font-semibold">Mục tiêu</th>
              <th className="px-2 py-2 text-center font-semibold">Thực Tế</th>
              <th className="px-2 py-2 text-center font-semibold">% Đạt</th>
              <th className="px-2 py-2 text-center font-semibold">Trọng Số</th>
              <th className="px-2 py-2 text-center font-semibold">Điểm</th>
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
                  className={`${idx % 2 === 0 ? "bg-white" : "bg-gray-50"} ${excluded ? "text-ink-400" : ""}`}
                >
                  <td className="px-2 py-2 font-medium">{kpi.name}</td>
                  <td className="px-2 py-2 text-center text-ink-600">
                    {target === null ? "—" : `${target} ${kpi.unit}`}
                  </td>
                  <td className="px-2 py-2 text-center font-semibold">
                    {actual === null ? (
                      <span className="font-normal italic">Chưa có dữ liệu</span>
                    ) : (
                      `${actual} ${kpi.unit}`
                    )}
                  </td>
                  <td className="px-2 py-2 text-center">
                    {excluded ? (
                      <span className="italic">Không tính</span>
                    ) : (
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold ${
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
                  <td className="px-2 py-2 text-center text-ink-600">
                    {kpi.weight}%
                    {!excluded &&
                      kpi.effectiveWeight !== undefined &&
                      kpi.effectiveWeight !== kpi.weight && (
                        <span className="block text-[10px] text-ink-400">
                          → {kpi.effectiveWeight}%
                        </span>
                      )}
                  </td>
                  <td className="px-2 py-2 text-center font-semibold text-blue-600">
                    {excluded ? "—" : Number(kpi.score).toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hasExcluded && (
        <p className="text-xs text-ink-500">
          Chỉ tiêu &quot;Chưa có dữ liệu&quot; không được tính; trọng số của nó được chia
          lại theo tỷ lệ cho các chỉ tiêu còn lại (cột Trọng Số, dòng →).
        </p>
      )}

      {/* Approval Info */}
      {approvedBy && approvedAt && (
        <div className="flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <CircleCheck size={14} strokeWidth={2} />
          Phê duyệt bởi <span className="font-semibold">{approvedBy.fullName}</span> vào{" "}
          <span className="font-semibold">{formatVnDateTime(approvedAt)}</span>
        </div>
      )}
    </div>
  );
}
