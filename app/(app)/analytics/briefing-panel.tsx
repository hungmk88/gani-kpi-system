"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { Badge, ProgressBar } from "@/components/ui";
import { HEALTH_BANDS } from "@/lib/analytics/constants";

type HealthPart = {
  key: string;
  label: string;
  weight: number;
  score: number;
  note: string;
};

type Briefing = {
  healthScore: number;
  healthLabel: string;
  executiveSummary: string;
  keyRisks: { area: string; riskLevel: string; impact: string }[];
  workloadWarnings: string[];
  recommendations: string[];
  dataBasis: string;
  engine: "GEMINI" | "RULE_BASED";
  modelName: string | null;
  engineError: string | null;
};

/**
 * Bảng sức khoẻ vận hành + báo cáo điều hành.
 *
 * Điểm sức khoẻ hiện ra NGAY, không cần bấm gì — nó là phép tính của hệ thống
 * trên dữ liệu thật. Chỉ phần diễn giải bằng lời mới phải bấm để sinh, và giao
 * diện nói rõ ai viết phần đó.
 */
export default function BriefingPanel({
  health,
  accuracy,
}: {
  health: { score: number; parts: HealthPart[] };
  accuracy: { total: number; accuracyPercent: number | null };
}) {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<Briefing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const band =
    HEALTH_BANDS.find((b) => health.score >= b.min) ??
    HEALTH_BANDS[HEALTH_BANDS.length - 1];

  const tone =
    band.tone === "green"
      ? "green"
      : band.tone === "sky"
        ? "sky"
        : band.tone === "amber"
          ? "amber"
          : "red";

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/executive-briefing", { method: "POST" });
      const d = await res.json();
      if (!res.ok) {
        setError(d.message || "Không tạo được báo cáo.");
        return;
      }
      setData(d);
      setOpen(true);
    } catch {
      setError("Mất kết nối tới máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card overflow-hidden">
      {/* ---------- điểm sức khoẻ ---------- */}
      <div className="border-b border-ink-100 p-5">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[13px] font-medium text-ink-500">
              Sức khoẻ vận hành
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-4xl font-bold text-ink-900 tabular-nums">
                {health.score}
              </span>
              <span className="text-lg text-ink-400">/ 100</span>
              <Badge tone={tone}>{band.label}</Badge>
            </div>
          </div>
          <button
            className="btn-primary btn-sm"
            disabled={busy}
            onClick={data ? () => setOpen(!open) : generate}
          >
            {busy ? (
              "Đang viết..."
            ) : data ? (
              open ? (
                "Thu gọn báo cáo"
              ) : (
                "Mở lại báo cáo"
              )
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <FileText size={14} strokeWidth={2} /> Viết báo cáo điều hành
              </span>
            )}
          </button>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          {health.parts.map((p) => (
            <div key={p.key}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-ink-600">{p.label}</span>
                <span className="font-medium text-ink-800 tabular-nums">{p.score}</span>
              </div>
              <ProgressBar
                value={p.score}
                tone={
                  p.score >= 85 ? "green" : p.score >= 60 ? "amber" : "red"
                }
              />
              <div className="mt-1 text-xs text-ink-500">{p.note}</div>
            </div>
          ))}
        </div>

        <p className="mt-3 text-xs text-ink-500">
          Điểm này do <b>hệ thống tính bằng công thức cố định</b> trên dữ liệu
          thật, không phải AI đoán. Trọng số từng phần do Ban Giám đốc cấu
          hình.
        </p>
      </div>

      {/* ---------- báo cáo ---------- */}
      {error && (
        <div className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {data && open && (
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="slate">
              {data.engine === "GEMINI"
                ? `Diễn giải bởi Gemini · ${data.modelName}`
                : "Diễn giải bằng luật cứng (chưa cấu hình khoá AI)"}
            </Badge>
            {accuracy.total === 0 ? (
              <Badge tone="amber">Dự báo chưa được kiểm chứng</Badge>
            ) : (
              <Badge tone="slate">
                Dự báo đúng{" "}
                {accuracy.accuracyPercent?.toLocaleString("vi-VN", {
                  maximumFractionDigits: 1,
                })}
                % trên {accuracy.total.toLocaleString("vi-VN")} việc
              </Badge>
            )}
          </div>

          {data.engineError && (
            <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {data.engineError}
            </div>
          )}

          <div className="rounded-md bg-ink-50 px-4 py-3">
            <div className="mb-1 text-sm font-semibold text-ink-800">
              Tóm tắt
            </div>
            <p className="text-sm text-ink-800">{data.executiveSummary}</p>
          </div>

          {data.keyRisks.length > 0 && (
            <div>
              <div className="mb-2 text-sm font-semibold text-ink-800">
                Rủi ro chính
              </div>
              <div className="space-y-1.5">
                {data.keyRisks.map((r, i) => (
                  <div
                    key={i}
                    className={`rounded-md px-3 py-2 text-sm ${
                      r.riskLevel === "CRITICAL" ? "bg-red-50" : "bg-amber-50"
                    }`}
                  >
                    <span className="font-medium text-ink-900">{r.area}</span>
                    <span className="text-ink-700"> — {r.impact}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.workloadWarnings.length > 0 && (
            <div>
              <div className="mb-2 text-sm font-semibold text-ink-800">
                Tải nhân sự
              </div>
              <ul className="list-inside list-disc space-y-1 text-sm text-ink-700">
                {data.workloadWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="mb-2 text-sm font-semibold text-ink-800">
              Việc nên làm tuần này
            </div>
            <ol className="list-inside list-decimal space-y-1.5 text-sm text-ink-700">
              {data.recommendations.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ol>
          </div>

          <div className="border-t border-ink-100 pt-3 text-xs text-ink-500">
            {data.dataBasis}
            <br />
            Phần diễn giải và khuyến nghị là gợi ý — quyết định vẫn là của Ban
            Giám đốc.
          </div>
        </div>
      )}
    </div>
  );
}
