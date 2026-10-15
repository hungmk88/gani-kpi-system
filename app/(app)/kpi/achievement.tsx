import { Badge } from "@/components/ui";
import { fmtNum, fmtPct } from "@/lib/format";
import { gatekeeperOutcome, type GatekeeperRule } from "@/lib/kpi";

/**
 * Thanh mức đạt của MỘT chỉ tiêu — dùng chung cho các màn KPI.
 *
 * Thang chạy tới trần của chính chỉ tiêu đó (150%, Sales 120%), kèm vạch mốc
 * 100%: nhìn là biết đã qua chỉ tiêu chưa, không phải nhẩm "thanh dài 2/3 là
 * bao nhiêu phần trăm". Không dùng ProgressBar chung vì nó không có vạch mốc.
 */
export function AchievementBar({ percent, cap }: { percent: number; cap: number }) {
  const tone =
    percent >= 100 ? "bg-leaf-500" : percent >= 80 ? "bg-amber-500" : "bg-red-500";
  const width = Math.max(0, Math.min(100, (percent / cap) * 100));
  const mark = Math.min(100, (100 / cap) * 100);
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={cap}
      aria-label={`Mức đạt ${fmtPct(percent)}, trần ${fmtPct(cap)}`}
      className="relative h-1.5 w-full rounded-full bg-ink-100"
    >
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${width}%` }} />
      <span
        aria-hidden
        title="Mốc 100%"
        className="absolute -top-0.5 -bottom-0.5 w-0.5 -translate-x-1/2 rounded-full bg-ink-600"
        style={{ left: `${mark}%` }}
      />
    </div>
  );
}

/** "98,5%" hoặc "120% · chạm trần 120%" — trần đúng của dòng, không cứng 150%. */
export function achievementText(percent: number, isCapped: boolean, cap: number) {
  return isCapped ? `${fmtPct(percent)} · chạm trần ${fmtPct(cap)}` : fmtPct(percent);
}

/** Luật của chỉ tiêu gatekeeper: "Ngưỡng ≤2% · trừ 5 điểm". */
export function gatekeeperRuleText(rule: GatekeeperRule) {
  return `Ngưỡng ≤${fmtNum(rule.thresholdPercent)}% · trừ ${fmtNum(rule.penaltyPoints)} điểm`;
}

/**
 * Trạng thái gatekeeper thay cho cột mức đạt: không có "mức đạt %", không có
 * "chạm trần" — chỉ có trong ngưỡng hay vượt ngưỡng (bị trừ điểm).
 */
export function GatekeeperStatus({
  rule,
  actual,
}: {
  rule: GatekeeperRule;
  actual: number | null;
}) {
  const outcome = gatekeeperOutcome(rule, actual);
  if (outcome === "NO_DATA") {
    return <span className="text-xs text-ink-500">chưa có số</span>;
  }
  if (outcome === "PASS") return <Badge tone="green">Đạt ngưỡng</Badge>;
  return (
    <Badge tone="red">
      Vượt ngưỡng · −{fmtNum(rule.penaltyPoints)} điểm
    </Badge>
  );
}
