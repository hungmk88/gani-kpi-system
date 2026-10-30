"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { fmtPct } from "@/lib/format";
import { fetchJson, jsonInit } from "@/lib/fetch-json";

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
      const r = await fetchJson<Advisory>(
        "/api/ai/kpi-advisory",
        jsonInit("POST", { kpiResultId })
      );
      if (!r.ok) {
        // AI chậm → 504 dạng HTML; fetchJson đổi thành câu dễ hiểu
        setError(r.message || "Không lấy được phân tích.");
        return;
      }
      setData(r.data);
    } catch {
      setError("Mất kết nối tới máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn btn-sm mt-1.5 w-full" onClick={ask}>
        <Search size={14} strokeWidth={2} aria-hidden /> Xin phân tích tham khảo
      </button>
    );
  }

  const pct = (n: number) => fmtPct(n);

  // Khung phân tích: một khối viền mảnh, các phần bên trong chỉ cách nhau bằng
  // khoảng trắng và nhãn viết thường câu — không lồng hộp trong hộp.
  return (
    <div className="mt-1.5 rounded-md border border-ink-200 bg-white p-2.5 text-xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold text-ink-800">Phân tích tham khảo</span>
        <button
          className="text-brand-700 hover:underline"
          onClick={() => setOpen(false)}
        >
          Đóng
        </button>
      </div>

      {busy && <div className="text-ink-500">Đang phân tích...</div>}

      {error && (
        <div className="rounded-md bg-red-50 px-2 py-1.5 text-red-700">
          {error}
        </div>
      )}

      {data && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold text-ink-900 tabular-nums">
              Đề xuất {pct(data.suggestedScore)}
            </span>
            <ConfidencePill value={data.confidencePercent} />
            <span className="text-ink-500">
              {data.engine === "GEMINI"
                ? `Gemini · ${data.modelName}`
                : "Luật cứng"}
            </span>
          </div>

          {data.engineError && (
            <div className="rounded-md bg-amber-50 px-2 py-1 text-amber-800">
              {data.engineError}
            </div>
          )}

          <Block label="Số liệu thật" tone="ink">
            {data.factSummary}
          </Block>

          <Block label="Phần máy suy đoán — có thể sai" tone="violet">
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

          <Block label="Gợi ý cho người duyệt" tone="ink">
            {data.recommendation}
          </Block>

          <div className="border-t border-ink-100 pt-2 text-xs text-ink-500">
            Đây chỉ là phân tích tham khảo. Điểm chính thức do trưởng phòng và
            Ban Giám đốc quyết định — máy không ghi gì vào bảng điểm.
          </div>

          {onUseScore && (
            <button
              className="btn-ghost btn-sm w-full"
              onClick={() => onUseScore(data.suggestedScore)}
            >
              Điền {pct(data.suggestedScore)} vào ô số chốt
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ConfidencePill({ value }: { value: number }) {
  // Tự tin cao là trạng thái bình thường → chữ màu lá, không nền
  const tone =
    value >= 75
      ? "text-leaf-700"
      : value >= 50
        ? "rounded-md bg-amber-50 px-1.5 py-0.5 text-amber-800"
        : "rounded-md bg-red-50 px-1.5 py-0.5 text-red-700";
  return (
    <span className={tone}>
      Tự tin {fmtPct(value)}
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
    <div>
      <div
        className={`mb-0.5 text-xs font-semibold ${
          tone === "violet" ? "text-brand-700" : "text-ink-600"
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
    emerald: "text-leaf-700",
    amber: "text-amber-800",
    red: "text-red-700",
  }[tone];
  return (
    <div>
      <div className={`mb-0.5 text-xs font-semibold ${cls}`}>{label}</div>
      <ul className="list-inside list-disc space-y-0.5 text-ink-700">
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  );
}
