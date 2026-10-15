"use client";

import { useState } from "react";
import { Calculator, CircleX, CircleCheck, Loader2 } from "lucide-react";

interface KpiScoreCalculatorProps {
  shiftLogId: string;
}

type CalcResult = {
  totalScore: number;
  bonusMultiplier: number;
  bonusAmount: number | null;
  status: string;
};

/** Đọc lỗi theo chuẩn { errorCode, message } của handle()/fail(); bản cũ dùng .error. */
async function readError(res: Response, fallback: string) {
  try {
    const body = await res.json();
    return body?.message || body?.error || fallback;
  } catch {
    return fallback;
  }
}

export default function KpiScoreCalculator({ shiftLogId }: KpiScoreCalculatorProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [result, setResult] = useState<CalcResult | null>(null);

  // Chỉ gửi mã ca. Số thực tế, kỳ KPI và mục tiêu do server tự lấy từ ca đã
  // khoá — client không được (và không cần) gửi số nào.
  const handleCalculate = async () => {
    try {
      setLoading(true);
      setError("");
      setSuccess(false);

      const res = await fetch("/api/kpi/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shiftLogId }),
      });

      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) {
        throw new Error(await readError(res, "Tính điểm KPI thất bại."));
      }

      const body = await res.json();
      setResult(body.data as CalcResult);
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
        Hệ thống tự tính điểm từ số liệu ca đã khoá và mục tiêu kỳ đã được duyệt.
        Chỉ tiêu chưa có nguồn dữ liệu (Đúng Spec, Đúng Deadline) được bỏ qua và
        trọng số chia lại cho các chỉ tiêu còn lại.
      </p>

      {error && (
        <div className="mb-4 flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <CircleX size={15} strokeWidth={2} /> {error}
        </div>
      )}

      {success && (
        <div className="mb-4 flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <CircleCheck size={15} strokeWidth={2} /> Tính điểm thành công
          {result && (
            <>
              {" "}— {result.totalScore.toFixed(1)} điểm, hệ số {result.bonusMultiplier.toFixed(2)}x
              {result.bonusAmount !== null &&
                `, thưởng ${Math.round(result.bonusAmount).toLocaleString("vi-VN")} ₫`}
            </>
          )}
          . Đang tải lại...
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
