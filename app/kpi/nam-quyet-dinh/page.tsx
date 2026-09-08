// File: app/kpi/nam-quyet-dinh/page.tsx

"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface KpiDefinition {
  code: string;
  name: string;
  unit: string;
  weight: number;
}

interface PeriodTarget {
  id: string | null;
  status: string;
  department: string;
  output_target: number | null;
  waste_target: number | null;
  quality_target: number | null;
  spec_target: number | null;
  safety_target: number | null;
  deadline_target: number | null;
}

interface ShiftTarget {
  id: string;
  shiftDate: string;
  shiftType: "MORNING" | "AFTERNOON" | "NIGHT";
  output_target: number | null;
  waste_target: number | null;
}

export default function NamQuyetDinhPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-lg">Đang tải dữ liệu...</div>
        </div>
      }
    >
      <NamQuyetDinhContent />
    </Suspense>
  );
}

function NamQuyetDinhContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const periodId = searchParams.get("periodId") || "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("period"); // "period" | "shift"

  const [period, setPeriod] = useState<any>(null);
  const [periodTarget, setPeriodTarget] = useState<PeriodTarget | null>(null);
  const [kpiDefinitions, setKpiDefinitions] = useState<KpiDefinition[]>([]);
  const [shiftTargets, setShiftTargets] = useState<ShiftTarget[]>([]);

  // Fetch targets
  useEffect(() => {
    if (!periodId) {
      setError("Không tìm thấy kỳ KPI");
      setLoading(false);
      return;
    }

    fetchTargets();
  }, [periodId]);

  const fetchTargets = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/kpi/targets/${periodId}`);
      
      if (!response.ok) throw new Error("Failed to fetch targets");
      
      const data = await response.json();
      setPeriod(data.period);
      setPeriodTarget(data.periodTarget);
      setKpiDefinitions(data.kpiDefinitions);
      setShiftTargets(data.shiftTargets);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi tải dữ liệu");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!periodTarget) {
      setError("Lỗi: không có dữ liệu mục tiêu");
      return;
    }

    try {
      setSaving(true);
      setError("");

      const response = await fetch("/api/kpi/targets", {
        method: periodTarget.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(periodTarget.id && { periodTargetId: periodTarget.id }),
          periodId,
          department: "PRODUCTION",
          output_target: periodTarget.output_target,
          waste_target: periodTarget.waste_target,
          quality_target: periodTarget.quality_target,
          spec_target: periodTarget.spec_target,
          safety_target: periodTarget.safety_target,
          deadline_target: periodTarget.deadline_target,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save");
      }

      const result = await response.json();
      setPeriodTarget(result.data);
      alert("✅ Mục tiêu KPI đã được lưu thành công!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi lưu dữ liệu");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Đang tải dữ liệu...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">📊 Năm Quyết Định</h1>
          <p className="text-gray-600 mt-2">
            {period?.name} • Phòng Sản Xuất (HCM01)
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-4 mb-6 border-b">
          <button
            onClick={() => setActiveTab("period")}
            className={`px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === "period"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            Mục Tiêu Chung
          </button>
          <button
            onClick={() => setActiveTab("shift")}
            className={`px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === "shift"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            Mục Tiêu Từng Ca ({shiftTargets.length})
          </button>
        </div>

        {/* TAB 1: Mục Tiêu Chung */}
        {activeTab === "period" && periodTarget && (
          <form onSubmit={handleSaveTarget} className="bg-white rounded-lg shadow p-6">
            <div className="space-y-6">
              {/* 6 KPI Inputs */}
              {[
                { key: "output_target", label: "Sản Lượng Thực Tế", unit: "kg/ca", placeholder: "500" },
                { key: "waste_target", label: "Tỷ Lệ Hao Hụt", unit: "%", placeholder: "4" },
                { key: "quality_target", label: "Tỷ Lệ Chất Lượng (OK)", unit: "%", placeholder: "95" },
                { key: "spec_target", label: "Tỷ Lệ Đúng Spec", unit: "%", placeholder: "98" },
                { key: "safety_target", label: "An Toàn Lao Động", unit: "điểm", placeholder: "100" },
                { key: "deadline_target", label: "Đúng Deadline Batch", unit: "%", placeholder: "100" },
              ].map(({ key, label, unit, placeholder }) => (
                <div key={key} className="flex items-center gap-4">
                  <label className="w-1/3 font-medium text-gray-700">{label}</label>
                  <div className="flex-1 flex gap-2">
                    <input
                      type="number"
                      step="0.01"
                      placeholder={placeholder}
                      value={periodTarget[key as keyof PeriodTarget] || ""}
                      onChange={(e) =>
                        setPeriodTarget({
                          ...periodTarget,
                          [key]: e.target.value ? parseFloat(e.target.value) : null,
                        })
                      }
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <span className="w-16 text-gray-600 text-center py-2">{unit}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Buttons */}
            <div className="mt-8 flex gap-4">
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                {saving ? "Đang lưu..." : "💾 Lưu Mục Tiêu"}
              </button>
              <button
                type="button"
                onClick={() => router.back()}
                className="px-6 py-2 bg-gray-300 text-gray-800 rounded-lg hover:bg-gray-400 font-medium"
              >
                Quay Lại
              </button>
            </div>

            {/* Status */}
            {periodTarget.id && (
              <div className="mt-4 text-sm text-gray-600">
                <p>Trạng thái: <span className="font-medium">{periodTarget.status}</span></p>
                <p>Lần cập nhật cuối: {periodTarget.id ? "Vừa tạo/cập nhật" : "Chưa lưu"}</p>
              </div>
            )}
          </form>
        )}

        {/* TAB 2: Mục Tiêu Từng Ca */}
        {activeTab === "shift" && (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="space-y-4">
              {shiftTargets.length > 0 ? (
                shiftTargets.map((shift) => (
                  <div key={shift.id} className="p-4 border border-gray-200 rounded-lg">
                    <div className="font-medium text-gray-900">
                      {new Date(shift.shiftDate).toLocaleDateString("vi-VN")} •{" "}
                      {shift.shiftType === "MORNING"
                        ? "Sáng"
                        : shift.shiftType === "AFTERNOON"
                        ? "Chiều"
                        : "Tối"}
                    </div>
                    <div className="mt-2 text-sm text-gray-600">
                      Sản Lượng: {shift.output_target} kg/ca | Hao Hụt:{" "}
                      {shift.waste_target}%
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center text-gray-500 py-8">
                  Chưa có mục tiêu từng ca
                </div>
              )}
            </div>
            <p className="text-sm text-gray-600 mt-6">
              💡 Tạo mục tiêu từng ca sẽ được cập nhật trong Phase 2
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
