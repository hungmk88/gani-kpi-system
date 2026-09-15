import Link from "next/link";
import { Inbox, Lock, Flame } from "lucide-react";
import {
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  KPI_STATUS_LABEL,
  PERIOD_STATUS_LABEL,
} from "@/lib/constants";
import { RISK_LEVEL_LABEL, riskLevel } from "@/lib/risk";

/* ------------------------------------------------------------------ khung */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  icon = <Inbox size={32} strokeWidth={1.75} />,
}: {
  title: string;
  hint?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 text-ink-400">{icon}</div>
      <div className="font-medium text-ink-700">{title}</div>
      {hint && <div className="mt-1 max-w-md text-sm text-ink-500">{hint}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ số liệu */

const TONE: Record<string, string> = {
  brand: "bg-brand-50 text-brand-700 border-brand-200",
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  red: "bg-red-50 text-red-700 border-red-200",
  sky: "bg-sky-50 text-sky-700 border-sky-200",
  slate: "bg-ink-100 text-ink-700 border-ink-200",
  violet: "bg-violet-50 text-violet-700 border-violet-200",
};

/**
 * Nền cho StatCard khi tô cả tấm thẻ (prop `surface`).
 *
 * "gani-blue"/"gani-green" lấy đúng từ logo GANI B2B (`logo GANI.png`), không
 * phải màu chung chung của Tailwind — đo trực tiếp từ điểm ảnh: chữ "GANI"
 * `#1E89CA`, lá `#3BA548`. Ba sắc độ mỗi màu tính bằng HSL giữ nguyên tông
 * (hue), chỉ đổi độ sáng (lightness): nền 87%, viền 60%, chữ 30% — chữ trên
 * nền đạt tỉ lệ tương phản 5,3–5,6:1, qua chuẩn AA cho cả chữ nhỏ (yêu cầu
 * 4,5:1).
 *
 * Bốn màu ý nghĩa (đỏ/vàng/xanh/tím) dùng đúng thang Tailwind ở mức 100/300/800
 * — cùng hue với `TONE` phía trên (chỉ đậm hơn vì tô cả thẻ chứ không phải một
 * chip nhỏ), Tailwind đã tự đảm bảo tỉ lệ tương phản đạt AA ở tổ hợp này.
 */
const SURFACE: Record<
  string,
  { bg: string; border: string; label: string; hint: string }
> = {
  "gani-blue": {
    bg: "bg-[#C5E4F6]",
    border: "border-[#4DABE5]",
    label: "text-[#145A85]",
    hint: "border-white/60 bg-white/55 text-[#145A85]",
  },
  "gani-green": {
    bg: "bg-[#CEEED2]",
    border: "border-[#69C975]",
    label: "text-[#26692E]",
    hint: "border-white/60 bg-white/55 text-[#26692E]",
  },
  red: {
    bg: "bg-red-100",
    border: "border-red-300",
    label: "text-red-800",
    hint: "border-white/60 bg-white/55 text-red-800",
  },
  amber: {
    bg: "bg-amber-100",
    border: "border-amber-300",
    label: "text-amber-800",
    hint: "border-white/60 bg-white/55 text-amber-800",
  },
  green: {
    bg: "bg-emerald-100",
    border: "border-emerald-300",
    label: "text-emerald-800",
    hint: "border-white/60 bg-white/55 text-emerald-800",
  },
  violet: {
    bg: "bg-violet-100",
    border: "border-violet-300",
    label: "text-violet-800",
    hint: "border-white/60 bg-white/55 text-violet-800",
  },
};

/**
 * Cột mini vẽ xu hướng vài kỳ gần nhất.
 *
 * Cố ý không có trục và không có số: nó trả lời "đang lên hay đang xuống",
 * không trả lời "bao nhiêu". Ai cần con số thì bấm vào xem trang KPI.
 */
export function Sparkline({
  values,
  highlightLast = "brand",
}: {
  values: number[];
  highlightLast?: "brand" | "green" | "amber" | "red";
}) {
  const real = values.filter((v) => v > 0);
  if (real.length < 2) return null;

  const max = Math.max(...real);
  const lastColor = {
    brand: "bg-brand-500",
    green: "bg-emerald-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
  }[highlightLast];

  return (
    <div
      className="mt-2 flex h-5 items-end gap-0.5"
      aria-label={`Xu hướng ${real.length} kỳ gần nhất`}
    >
      {values.map((v, i) => (
        <div
          key={i}
          className={`flex-1 rounded-sm ${
            i === values.length - 1 ? lastColor : "bg-ink-200"
          }`}
          style={{ height: `${max > 0 ? Math.max(8, (v / max) * 100) : 8}%` }}
        />
      ))}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "slate",
  href,
  delta,
  deltaGoodWhen = "down",
  deltaSuffix = "so với tuần trước",
  spark,
  sparkTone,
  valueTone,
  surface,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: keyof typeof TONE;
  href?: string;
  /** Chênh so với mốc trước. Truyền vào thì nó tự thay chỗ của `hint`. */
  delta?: number | null;
  /** Tăng là tốt hay giảm là tốt — quyết định màu của mũi tên */
  deltaGoodWhen?: "up" | "down";
  deltaSuffix?: string;
  /** Vài kỳ gần nhất, vẽ thành cột mini dưới con số */
  spark?: number[];
  sparkTone?: "brand" | "green" | "amber" | "red";
  valueTone?: "red" | "amber" | "default";
  /**
   * Nền màu cho cả tấm thẻ, không chỉ ô hint. Mặc định để trắng (giống mọi
   * StatCard khác trong hệ thống) — chỉ đặt khi cố ý muốn một nhóm thẻ nổi
   * bật hẳn lên, ví dụ khối nhịp xưởng trên trang chủ hoặc bảng điều hành.
   * Xem chú thích ở hằng số SURFACE.
   */
  surface?: "gani-blue" | "gani-green" | "red" | "amber" | "green" | "violet";
}) {
  // Một con số trần không nói được gì: 18 việc đang mở là nhiều hay ít?
  // Có mốc so sánh thì nó mới thành thông tin.
  let deltaNode: React.ReactNode = null;
  if (delta !== undefined && delta !== null) {
    if (delta === 0) {
      deltaNode = (
        <div className={`mt-2 inline-block rounded-md border px-1.5 py-0.5 text-xs ${TONE.slate}`}>
          không đổi {deltaSuffix}
        </div>
      );
    } else {
      const isGood = deltaGoodWhen === "up" ? delta > 0 : delta < 0;
      deltaNode = (
        <div
          className={`mt-2 inline-block rounded-md border px-1.5 py-0.5 text-xs ${
            TONE[isGood ? "green" : "red"]
          }`}
        >
          {delta > 0 ? "↑" : "↓"} {Math.abs(delta)} {deltaSuffix}
        </div>
      );
    }
  }

  const valueColor =
    valueTone === "red"
      ? "text-red-600"
      : valueTone === "amber"
        ? "text-amber-700"
        : "text-ink-900";

  // Không mix .card (lớp component, bg-white cố định) với utility bg-* đè
  // lên — thứ tự trong stylesheet không đảm bảo utility thắng. Khi tô màu
  // thì dựng nguyên bộ class rời, không dựa vào .card nữa.
  const surfaceClass = surface
    ? `${SURFACE[surface].bg} ${SURFACE[surface].border} rounded-xl border shadow-sm`
    : "card";

  const inner = (
    <div className={`${surfaceClass} h-full p-4 transition hover:shadow-md`}>
      <div
        className={`text-xs font-semibold tracking-wide uppercase ${
          surface ? SURFACE[surface].label : "text-ink-500"
        }`}
      >
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={`text-2xl font-bold ${valueColor}`}>{value}</span>
      </div>
      {spark && <Sparkline values={spark} highlightLast={sparkTone} />}
      {deltaNode}
      {!deltaNode && hint && (
        <div
          className={`mt-2 inline-block rounded-md border px-1.5 py-0.5 text-xs ${
            surface ? SURFACE[surface].hint : TONE[tone]
          }`}
        >
          {hint}
        </div>
      )}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export function ProgressBar({
  value,
  tone = "brand",
}: {
  value: number;
  tone?: "brand" | "green" | "amber" | "red";
}) {
  const color = {
    brand: "bg-brand-500",
    green: "bg-emerald-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
  }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
      <div
        className={`h-full rounded-full ${color}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ nhãn */

export function Badge({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: keyof typeof TONE;
}) {
  return (
    <span className={`badge border ${TONE[tone]}`}>{children}</span>
  );
}

const TASK_STATUS_TONE: Record<string, keyof typeof TONE> = {
  BACKLOG: "slate",
  TO_DO: "slate",
  IN_PROGRESS: "brand",
  BLOCKED: "red",
  REVIEW: "violet",
  DONE: "green",
  CANCELLED: "slate",
};

export function TaskStatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={TASK_STATUS_TONE[status] ?? "slate"}>
      {TASK_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

const PRIORITY_TONE: Record<string, keyof typeof TONE> = {
  LOW: "slate",
  MEDIUM: "sky",
  HIGH: "amber",
  CRITICAL: "red",
};

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <Badge tone={PRIORITY_TONE[priority] ?? "slate"}>
      {priority === "CRITICAL" && (
        <Flame size={11} strokeWidth={2.5} className="mr-1 inline -mt-0.5" />
      )}
      {TASK_PRIORITY_LABEL[priority] ?? priority}
    </Badge>
  );
}

export function RiskBadge({ score }: { score: number }) {
  const level = riskLevel(score);
  const tone: keyof typeof TONE =
    level === "CRITICAL"
      ? "red"
      : level === "HIGH"
        ? "amber"
        : level === "MEDIUM"
          ? "sky"
          : "slate";
  return (
    <Badge tone={tone}>
      {RISK_LEVEL_LABEL[level]} · {score}
    </Badge>
  );
}

const KPI_STATUS_TONE: Record<string, keyof typeof TONE> = {
  DRAFT: "slate",
  SELF_REVIEWED: "sky",
  MANAGER_REVIEWED: "violet",
  FINALIZED: "green",
};

export function KpiStatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={KPI_STATUS_TONE[status] ?? "slate"}>
      {status === "FINALIZED" && (
        <Lock size={11} strokeWidth={2.5} className="mr-1 inline -mt-0.5" />
      )}
      {KPI_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

export function PeriodStatusBadge({ status }: { status: string }) {
  const tone: keyof typeof TONE =
    status === "FINALIZED"
      ? "green"
      : status === "MANAGER_LOCKED"
        ? "violet"
        : status === "SELF_LOCKED"
          ? "sky"
          : "brand";
  return <Badge tone={tone}>{PERIOD_STATUS_LABEL[status] ?? status}</Badge>;
}

export function ScoreBadge({ score }: { score: number }) {
  const tone: keyof typeof TONE =
    score >= 120
      ? "emerald"
      : score >= 100
        ? "green"
        : score >= 85
          ? "sky"
          : score >= 70
            ? "amber"
            : "red";
  return <Badge tone={tone}>{score.toFixed(2)} điểm</Badge>;
}

/* ------------------------------------------------------------------ ngày giờ */

export function formatDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  });
}

export function DueDate({ date, done }: { date: Date | string; done?: boolean }) {
  const d = new Date(date);
  const late = !done && d.getTime() < Date.now();
  return (
    <span className={late ? "font-medium text-red-600" : "text-ink-600"}>
      {formatDate(d)}
      {late && " · trễ"}
    </span>
  );
}
