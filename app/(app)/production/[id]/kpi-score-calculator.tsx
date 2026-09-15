"use client";

import { useState } from "react";
import { Calculator, CircleX, CircleCheck, Loader2 } from "lucide-react";

interface KpiScoreCalculatorProps {
  shiftLogId: string;
}

export default function KpiScoreCalculator({ shiftLogId }: KpiScoreCalculatorProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleCalculate = async () => {
    try {
      setLoading(true);
      setError("");
      setSuccess(false);

      // Get shift data để lấy values
      const shiftRes = await fetch(`/api/production/shifts/${shiftLogId}`);
      if (!shiftRes.ok) throw new Error("Không tìm thấy ca sản xuất");

      const shiftData = await shiftRes.json();
      const shift = shiftData.data;

      // Tính toán các KPI values
      const kpiResults = {
        output_actual: shift.rawOutputKg,
        waste_actual: shift.rawMaterialInputKg > 0
          ? ((shift.rawMaterialInputKg - shift.rawOutputKg) / shift.rawMaterialInputKg * 100)
          : 0,
        quality_actual: shift.rawOutputKg > 0
          ? (shift.qcPassedKg / shift.rawOutputKg * 100)
          : 0,
        spec_actual: 97, // Mặc định từ QA data
        safety_actual: shift.haccpViolationCount > 0 ? 80 : 100,
        deadline_actual: 100, // Mặc định, có thể tính từ timeline
      };

      // Lấy periodTargetId từ shift date
      const shiftDate = new Date(shift.shiftDate);
      const month = shiftDate.getMonth() + 1;
      const year = shiftDate.getFullYear();

      // Tìm kỳ KPI tương ứng
      const periodRes = await fetch(
        `/api/kpi/periods?month=${month}&year=${year}`
      );
      if (!periodRes.ok) throw new Error("Không tìm thấy kỳ KPI");

      const periodData = await periodRes.json();
      const period = periodData.data[0];
      if (!period) throw new Error("Không tìm thấy kỳ KPI phù hợp");

      // Tìm period target
      const targetRes = await fetch(
        `/api/kpi/targets?periodId=${period.id}`
      );
      if (!targetRes.ok) throw new Error("Không tìm thấy mục tiêu KPI");

      const targetData = await targetRes.json();
      const periodTarget = targetData.data;
      if (!periodTarget) throw new Error("Chưa thiết lập mục tiêu KPI");

      // Gọi API tính điểm
      const calcRes = await fetch("/api/kpi/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shiftLogId,
          periodTargetId: periodTarget.id,
          kpiResults,
        }),
      });

      if (!calcRes.ok) {
        const errData = await calcRes.json();
        throw new Error(errData.error || "Tính điểm KPI thất bại");
      }

      setSuccess(true);
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card border-blue-200 bg-blue-50/40 p-5">
      <h2 className="section-title mb-2 flex items-center gap-1.5">
        <Calculator size={18} strokeWidth={2} /> Tính Điểm KPI 6 Chỉ Tiêu
      </h2>
      <p className="text-sm text-ink-600 mb-4">
        Hệ thống sẽ tự động tính điểm dựa trên số liệu ca sản xuất.
      </p>

      {error && (
        <div className="mb-4 flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <CircleX size={15} strokeWidth={2} /> {error}
        </div>
      )}

      {success && (
        <div className="mb-4 flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <CircleCheck size={15} strokeWidth={2} /> Tính điểm thành công! Đang tải lại...
        </div>
      )}

      <button
        onClick={handleCalculate}
        disabled={loading || success}
        className={`inline-flex items-center gap-1.5 px-6 py-2 rounded-lg font-medium text-white ${
          loading || success
            ? "bg-gray-400 cursor-not-allowed"
            : "bg-blue-600 hover:bg-blue-700"
        }`}
      >
        {loading ? (
          <>
            <Loader2 size={15} strokeWidth={2} className="animate-spin" /> Đang tính...
          </>
        ) : success ? (
          <>
            <CircleCheck size={15} strokeWidth={2} /> Thành công
          </>
        ) : (
          <>
            <Calculator size={15} strokeWidth={2} /> Tính Điểm
          </>
        )}
      </button>
    </div>
  );
}
