// File: app/kpi/nam-quyet-dinh/page.tsx

"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LineChart, Save, Lightbulb, CircleCheck } from "lucide-react";
import { formatVnDate } from "@/lib/vn-time";
import { SHIFT_TYPE_LABEL } from "@/lib/production/constants";

interface KpiDefinition {
  code: string;
  name: string;
  unit: string;
  weight: number;
  isHigherBetter?: boolean;
}

interface Permissions {
  canApprove: boolean;
  canEdit: boolean;
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
  shiftType: string;
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

  const [period, setPeriod] = useState<{ id: string; name: string; status: string } | null>(null);
  const [periodTarget, setPeriodTarget] = useState<PeriodTarget | null>(null);
  const [kpiDefinitions, setKpiDefinitions] = useState<KpiDefinition[]>([]);
  const [shiftTargets, setShiftTargets] = useState<ShiftTarget[]>([]);
  const [permissions, setPermissions] = useState<Permissions>({ canApprove: false, canEdit: false });
  const [notice, setNotice] = useState("");

  /**
   * Lỗi theo chuẩn { errorCode, message } của handle()/fail() (bản cũ: .error).
   * 401 → về trang đăng nhập; trả về null để caller dừng lại.
   */
  const readError = async (res: Response, fallback: string) => {
    if (res.status === 401) {
      router.replace("/login");
      return null;
    }
    const body = await res.json().catch(() => null);
    if (res.status === 403) {
      return body?.message || "Bạn không có quyền truy cập mục tiêu KPI Phòng SX.";
    }
    return body?.message || body?.error || fallback;
  };

  // Fetch targets
  useEffect(() => {
    if (!periodId) {
      setError("Không tìm thấy kỳ KPI");
      setLoading(false);
      return;
    }

    fetchTargets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodId]);

  const fetchTargets = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/kpi/targets/${encodeURIComponent(periodId)}`);

      if (!response.ok) {
        const msg = await readError(response, "Không tải được mục tiêu KPI.");
        if (msg) setError(msg);
        return;
      }

      const data = await response.json();
      setPeriod(data.period);
      setPeriodTarget(data.periodTarget);
      setKpiDefinitions(data.kpiDefinitions ?? []);
      setShiftTargets(data.shiftTargets ?? []);
      setPermissions(data.permissions ?? { canApprove: false, canEdit: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi tải dữ liệu");
    } finally {
      setLoading(false);
    }
  };

  /** Trưởng phòng chỉ lưu nháp; chỉ CEO lưu kèm phê duyệt. */
  const saveTarget = async (status: "DRAFT" | "APPROVED") => {
    if (!periodTarget) {
      setError("Lỗi: không có dữ liệu mục tiêu");
      return;
    }

    try {
      setSaving(true);
      setError("");
      setNotice("");

      const response = await fetch("/api/kpi/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodId,
          output_target: periodTarget.output_target,
          waste_target: periodTarget.waste_target,
          quality_target: periodTarget.quality_target,
          spec_target: periodTarget.spec_target,
          safety_target: periodTarget.safety_target,
          deadline_target: periodTarget.deadline_target,
          status,
        }),
      });

      if (!response.ok) {
        const msg = await readError(response, "Không lưu được mục tiêu KPI.");
        if (msg) setError(msg);
        return;
      }

      const result = await response.json();
      setPeriodTarget(result.data);
      setNotice(
        status === "APPROVED"
          ? "Đã lưu và phê duyệt mục tiêu KPI."
          : "Đã lưu nháp mục tiêu KPI — chờ Ban Giám đốc phê duyệt."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi lưu dữ liệu");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTarget = (e: React.FormEvent) => {
    e.preventDefault();
    saveTarget("DRAFT");
  };

  const weightOf = (code: string) =>
    kpiDefinitions.find((d) => d.code === code)?.weight;

  const STATUS_LABEL: Record<string, string> = {
    NOT_CREATED: "Chưa tạo",
    DRAFT: "Nháp — chờ Ban Giám đốc duyệt",
    APPROVED: "Đã phê duyệt",
    LOCKED: "Đã khoá",
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
          <h1 className="flex items-center gap-2 text-3xl font-bold text-gray-900">
            <LineChart size={28} strokeWidth={2} /> Năm Quyết Định
          </h1>
          <p className="text-gray-600 mt-2">
            {period?.name} • Phòng Sản Xuất (HCM01)
          </p>
        </div>

        {notice && (
          <div className="mb-6 flex items-center gap-1.5 p-4 bg-green-50 border border-green-200 rounded-lg text-green-800">
            <CircleCheck size={16} strokeWidth={2} /> {notice}
          </div>
        )}

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
                { key: "output_target", code: "PROD_OUTPUT", label: "Sản Lượng Thực Tế", unit: "kg/ca", placeholder: "500" },
                { key: "waste_target", code: "PROD_WASTE", label: "Tỷ Lệ Hao Hụt", unit: "%", placeholder: "4" },
                { key: "quality_target", code: "PROD_QUALITY", label: "Tỷ Lệ Chất Lượng (OK)", unit: "%", placeholder: "95" },
                { key: "spec_target", code: "PROD_SPEC", label: "Tỷ Lệ Đúng Spec", unit: "%", placeholder: "98" },
                { key: "safety_target", code: "PROD_SAFETY", label: "An Toàn Lao Động", unit: "điểm", placeholder: "100" },
                { key: "deadline_target", code: "PROD_DEADLINE", label: "Đúng Deadline Batch", unit: "%", placeholder: "100" },
              ].map(({ key, code, label, unit, placeholder }) => (
                <div key={key} className="flex items-center gap-4">
                  <label className="w-1/3 font-medium text-gray-700">
                    {label}
                    {weightOf(code) !== undefined && (
                      <span className="ml-1 text-xs font-normal text-gray-500">
                        ({weightOf(code)}%)
                      </span>
                    )}
                  </label>
                  <div className="flex-1 flex gap-2">
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      placeholder={placeholder}
                      disabled={!permissions.canEdit}
                      // 0 là chỉ tiêu hợp lệ (vd 0 sự cố) — dùng ?? để không biến 0 thành ô trống
                      value={periodTarget[key as keyof PeriodTarget] ?? ""}
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
                disabled={saving || !permissions.canEdit}
                className="inline-flex items-center gap-1.5 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                {saving ? (
                  "Đang lưu..."
                ) : (
                  <>
                    <Save size={16} strokeWidth={2} /> Lưu Nháp
                  </>
                )}
              </button>
              {permissions.canApprove && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => saveTarget("APPROVED")}
                  className="inline-flex items-center gap-1.5 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
                >
                  <CircleCheck size={16} strokeWidth={2} /> Lưu &amp; Phê Duyệt
                </button>
              )}
              <button
                type="button"
                onClick={() => router.back()}
                className="px-6 py-2 bg-gray-300 text-gray-800 rounded-lg hover:bg-gray-400 font-medium"
              >
                Quay Lại
              </button>
            </div>

            {/* Status */}
            <div className="mt-4 text-sm text-gray-600">
              <p>
                Trạng thái:{" "}
                <span className="font-medium">
                  {STATUS_LABEL[periodTarget.status] ?? periodTarget.status}
                </span>
              </p>
              {!permissions.canEdit && (
                <p className="text-amber-700">
                  Kỳ hoặc mục tiêu đã khoá — chỉ xem, không sửa được.
                </p>
              )}
              <p className="text-xs text-gray-500 mt-1">
                Mục tiêu chỉ được dùng để chấm thưởng ca sau khi Ban Giám đốc phê duyệt.
              </p>
            </div>
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
                      {formatVnDate(shift.shiftDate)} •{" "}
                      {SHIFT_TYPE_LABEL[shift.shiftType] ?? shift.shiftType}
                    </div>
                    <div className="mt-2 text-sm text-gray-600">
                      Sản Lượng: {shift.output_target ?? "—"} kg/ca | Hao Hụt:{" "}
                      {shift.waste_target ?? "—"}%
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center text-gray-500 py-8">
                  Chưa có mục tiêu từng ca
                </div>
              )}
            </div>
            <p className="flex items-center gap-1.5 text-sm text-gray-600 mt-6">
              <Lightbulb size={14} strokeWidth={2} /> Tạo mục tiêu từng ca sẽ được cập nhật trong Phase 2
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
