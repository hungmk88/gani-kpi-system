"use client";

import { useState } from "react";
import { Search } from "lucide-react";

type Advisory = {
  suggestedScore: number;
  confidencePercent: number;
  factSummary: string;
  aiInference: string;
  strengths: string[];
  weaknesses: string[];
  risks: string[];
  recommendation: string;
  engine: "GEMINI" | "RULE_BASED";
  modelName: string | null;
  latencyMs: number;
  engineError: string | null;
};

/**
 * Bảng cố vấn KPI.
 *
 * Điểm mấu chốt về mặt giao diện: nút "Dùng số này" CHỈ điền số vào ô nhập,
 * không gửi đi đâu cả. Người duyệt vẫn phải tự bấm nút duyệt như bình thường.
 * Không có đường nào để máy tự chốt điểm.
 */
export default function KpiAdvisoryPanel({
  kpiResultId,
  onUseScore,
}: {
  kpiResultId: string;
  onUseScore?: (score: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<Advisory | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setOpen(true);
    if (data) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/ai/kpi-advisory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kpiResultId }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.message || "Không lấy được phân tích.");
        return;
      }
      setData(d);
    } catch {
      setError("Mất kết nối tới máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        className="mt-1.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100"
        onClick={ask}
      >
        <Search size={13} strokeWidth={2} /> Xin phân tích tham khảo
      </button>
    );
  }

  return (
    <div className="mt-1.5 rounded-lg border border-violet-200 bg-violet-50/60 p-2.5 text-xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold text-violet-900">
          Phân tích tham khảo
        </span>
        <button
          className="text-violet-500 hover:text-violet-800"
          onClick={() => setOpen(false)}
        >
          Đóng
        </button>
      </div>

      {busy && <div className="text-violet-700">Đang phân tích...</div>}

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-red-700">
          {error}
        </div>
      )}

      {data && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded border border-violet-300 bg-white px-1.5 py-0.5 font-semibold text-violet-800">
              Đề xuất {data.suggestedScore}%
            </span>
            <ConfidencePill value={data.confidencePercent} />
            <span className="rounded border border-ink-200 bg-white px-1.5 py-0.5 text-ink-500">
              {data.engine === "GEMINI"
                ? `Gemini · ${data.modelName}`
                : "Luật cứng"}
            </span>
          </div>

          {data.engineError && (
            <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">
              {data.engineError}
            </div>
          )}

          <Block label="SỐ LIỆU THẬT" tone="ink">
            {data.factSummary}
          </Block>

          <Block label="PHẦN MÁY SUY ĐOÁN — CÓ THỂ SAI" tone="violet">
            {data.aiInference}
          </Block>

          {data.strengths.length > 0 && (
            <ListBlock label="Điểm được" items={data.strengths} tone="emerald" />
          )}
          {data.weaknesses.length > 0 && (
            <ListBlock label="Điểm hụt" items={data.weaknesses} tone="amber" />
          )}
          {data.risks.length > 0 && (
            <ListBlock label="Cần lưu ý" items={data.risks} tone="red" />
          )}

          <Block label="GỢI Ý CHO NGƯỜI DUYỆT" tone="ink">
            {data.recommendation}
          </Block>

          <div className="rounded border border-ink-200 bg-white px-2 py-1.5 text-[11px] text-ink-500">
            Đây chỉ là phân tích tham khảo. Điểm chính thức do trưởng phòng và
            Ban Giám đốc quyết định — máy không ghi gì vào bảng điểm.
          </div>

          {onUseScore && (
            <button
              className="w-full rounded-lg border border-violet-300 bg-white px-2 py-1.5 font-medium text-violet-700 hover:bg-violet-100"
              onClick={() => onUseScore(data.suggestedScore)}
            >
              Điền {data.suggestedScore}% vào ô số chốt
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ConfidencePill({ value }: { value: number }) {
  const tone =
    value >= 75
      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
      : value >= 50
        ? "border-amber-300 bg-amber-50 text-amber-700"
        : "border-red-300 bg-red-50 text-red-700";
  return (
    <span className={`rounded border px-1.5 py-0.5 ${tone}`}>
      Tự tin {value}%
    </span>
  );
}

function Block({
  label,
  tone,
  children,
}: {
  label: string;
  tone: "ink" | "violet";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded border px-2 py-1.5 ${
        tone === "violet"
          ? "border-violet-200 bg-white"
          : "border-ink-200 bg-white"
      }`}
    >
      <div
        className={`mb-0.5 text-[10px] font-bold tracking-wide ${
          tone === "violet" ? "text-violet-600" : "text-ink-500"
        }`}
      >
        {label}
      </div>
      <div className="text-ink-700">{children}</div>
    </div>
  );
}

function ListBlock({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone: "emerald" | "amber" | "red";
}) {
  const cls = {
    emerald: "text-emerald-700",
    amber: "text-amber-700",
    red: "text-red-700",
  }[tone];
  return (
    <div className="rounded border border-ink-200 bg-white px-2 py-1.5">
      <div className={`mb-0.5 text-[10px] font-bold tracking-wide ${cls}`}>
        {label.toUpperCase()}
      </div>
      <ul className="list-inside list-disc space-y-0.5 text-ink-700">
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  );
}
