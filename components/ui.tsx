import { formatVnDate, formatVnDateTime } from "@/lib/vn-time";
import Link from "next/link";
import { Inbox, Lock, Flame } from "lucide-react";
import {
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  KPI_STATUS_LABEL,
  PERIOD_STATUS_LABEL,
} from "@/lib/constants";
import { RISK_LEVEL_LABEL, riskLevel } from "@/lib/risk";
import { fmtNum, fmtScore } from "@/lib/format";

export { fmtScore };

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
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 sm:mb-6">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-ink-900 sm:text-2xl">
          {title}
        </h1>
        {/* Điện thoại: mô tả tối đa 2 dòng — màn hình đầu tiên dành cho tín
            hiệu và nút bấm, không phải cho lời giải thích. */}
        {subtitle && (
          <p className="mt-1 line-clamp-2 max-w-3xl text-sm text-ink-500 sm:line-clamp-none">
            {subtitle}
          </p>
        )}
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

/**
 * Khung xương khi đang tải — giữ đúng bố cục trang để không nhảy khi dữ liệu
 * về. Dùng trong loading.tsx của từng nhóm trang.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-ink-100 ${className}`} />;
}

export function PageSkeleton({ rows = 6, stats = 4 }: { rows?: number; stats?: number }) {
  return (
    <div role="status" aria-live="polite" aria-label="Đang tải">
      <span className="sr-only">Đang tải…</span>
      <Skeleton className="mb-2 h-7 w-56" />
      <Skeleton className="mb-6 h-4 w-80 max-w-full" />
      {stats > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: stats }, (_, i) => (
            <div key={i} className="card p-4">
              <Skeleton className="mb-3 h-3.5 w-24" />
              <Skeleton className="h-7 w-16" />
            </div>
          ))}
        </div>
      )}
      <div className="card divide-y divide-ink-100">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3.5">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="hidden h-4 w-24 sm:block" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * "Đang hiển thị 200/1.340" — bắt buộc hiện khi danh sách bị cắt theo giới
 * hạn truy vấn, để người xem không tưởng đó là toàn bộ.
 */
export function ShowingCount({
  shown,
  total,
  hint,
}: {
  shown: number;
  total: number;
  hint?: string;
}) {
  if (total <= shown) return null;
  return (
    <div className="mt-2 text-xs text-ink-500">
      Đang hiển thị {fmtNum(shown)}/{fmtNum(total)}
      {hint ? ` · ${hint}` : ""}
    </div>
  );
}

/* ------------------------------------------------------------------ số liệu */

/**
 * Tông màu huy hiệu — hệ thiết kế GANI: chỉ NGOẠI LỆ (đỏ, vàng) mới có nền
 * màu. Trạng thái bình thường (đạt, đang chạy, thông tin) chỉ là chữ màu kèm
 * chấm tròn — cả cột "Đang dùng" xanh lá nền màu là nhiễu, không phải tín hiệu.
 * Không viền ở mọi tông.
 */
const TONE: Record<string, string> = {
  red: "bg-red-50 text-red-700",
  amber: "bg-amber-50 text-amber-800",
  brand: "bg-transparent px-0 text-brand-700",
  sky: "bg-transparent px-0 text-brand-700",
  violet: "bg-transparent px-0 text-brand-700",
  green: "bg-transparent px-0 text-leaf-700",
  emerald: "bg-transparent px-0 text-leaf-700",
  slate: "bg-ink-100 text-ink-700",
};

/** Chấm tròn đứng trước chữ ở các tông không có nền */
const DOT: Record<string, string | undefined> = {
  brand: "bg-brand-500",
  sky: "bg-brand-500",
  violet: "bg-brand-500",
  green: "bg-leaf-500",
  emerald: "bg-leaf-500",
};

/**
 * Cột mini vẽ xu hướng vài kỳ gần nhất.
 *
 * Cố ý không có trục và không có số: nó trả lời "đang lên hay đang xuống",
 * không trả lời "bao nhiêu". Kỳ điểm 0 (chưa chấm) bị bỏ — vẽ vào là thành
 * một vạch tụt giả. Thang co theo khoảng thấp–cao để 96 và 100 còn nhìn ra
 * khác nhau (thang từ 0 thì năm cột cao bằng nhau).
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
  const min = Math.min(...real);
  const span = max - min;
  const lastColor = {
    brand: "bg-brand-500",
    green: "bg-leaf-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
  }[highlightLast];

  return (
    <div
      role="img"
      className="mt-2 flex h-6 items-end gap-0.5"
      aria-label={`Xu hướng ${real.length} kỳ gần nhất`}
    >
      {real.map((v, i) => (
        <div
          key={i}
          className={`flex-1 rounded-sm ${
            i === real.length - 1 ? lastColor : "bg-ink-200"
          }`}
          style={{ height: `${span > 0 ? 25 + ((v - min) / span) * 75 : 60}%` }}
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
        <div className="mt-2 text-xs text-ink-500">không đổi {deltaSuffix}</div>
      );
    } else {
      const isGood = deltaGoodWhen === "up" ? delta > 0 : delta < 0;
      deltaNode = (
        <div
          className={`mt-2 text-xs font-medium ${
            isGood ? "text-leaf-700" : "text-red-700"
          }`}
        >
          {delta > 0 ? "↑" : "↓"}{" "}
          {Math.abs(delta).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}{" "}
          <span className="font-normal text-ink-500">{deltaSuffix}</span>
        </div>
      );
    }
  }

  // Thẻ chỉ "lên tiếng" khi là ngoại lệ: surface đỏ/vàng → vạch màu bên trái
  // + nhãn màu. Mọi trường hợp khác là thẻ trắng — không tô nền cả tấm thẻ
  // (trước đây thẻ xanh lá "0" cũng nổi bật ngang thẻ đỏ "3 việc trễ").
  const alarm =
    surface === "red" ? "red" : surface === "amber" ? "amber" : null;
  const valueColor =
    valueTone === "red" || alarm === "red"
      ? "text-red-700"
      : valueTone === "amber" || alarm === "amber"
        ? "text-amber-800"
        : "text-ink-900";
  const hintColor =
    tone === "red"
      ? "text-red-700"
      : tone === "amber"
        ? "text-amber-800"
        : "text-ink-500";

  const inner = (
    <div
      className={`card h-full p-4 ${
        alarm === "red"
          ? "border-l-[3px] border-l-red-600"
          : alarm === "amber"
            ? "border-l-[3px] border-l-amber-500"
            : ""
      } ${href ? "transition hover:border-ink-300 hover:shadow-lift" : ""}`}
    >
      <div
        className={`text-[13px] font-medium ${
          alarm === "red"
            ? "text-red-700"
            : alarm === "amber"
              ? "text-amber-800"
              : "text-ink-500"
        }`}
      >
        {label}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span
          className={`stat-value text-[28px] leading-tight font-bold tracking-tight ${valueColor}`}
        >
          {value}
        </span>
      </div>
      {spark && <Sparkline values={spark} highlightLast={sparkTone} />}
      {deltaNode}
      {!deltaNode && hint && (
        <div className={`mt-2 text-xs ${hintColor}`}>{hint}</div>
      )}
    </div>
  );
  return href ? (
    <Link
      href={href}
      className="block rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
    >
      {inner}
    </Link>
  ) : (
    inner
  );
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
    green: "bg-leaf-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
  }[tone];
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100"
    >
      <div
        className={`h-full rounded-full ${color}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ nhãn */

/* ------------------------------------------------------------- ảnh đại diện */

/**
 * Hai chữ cái đầu theo cách gọi tên người Việt: hai chữ cuối của họ tên
 * ("Trần Minh Quân" → "MQ"), tên một chữ thì lấy một chữ.
 */
export function initialsOf(fullName: string) {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const pick = words.length === 1 ? [words[0]] : words.slice(-2);
  return pick.map((w) => w[0]!.toLocaleUpperCase("vi-VN")).join("");
}

/**
 * Nền avatar chỉ trong họ màu thương hiệu (lam, lá, trung tính) — KHÔNG dùng
 * đỏ/vàng, vốn dành cho ngoại lệ. Cùng một tên luôn ra cùng một màu.
 */
const AVATAR_TONES = [
  "bg-brand-100 text-brand-800",
  "bg-leaf-100 text-leaf-800",
  "bg-ink-100 text-ink-700",
  "bg-brand-600 text-white",
  "bg-leaf-600 text-white",
];

export function Avatar({
  name,
  size = 36,
  className = "",
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const tone = AVATAR_TONES[h % AVATAR_TONES.length];
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none ${tone} ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initialsOf(name)}
    </span>
  );
}

export function Badge({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: keyof typeof TONE;
}) {
  const dot = DOT[tone];
  return (
    <span className={`badge border-transparent ${TONE[tone] ?? TONE.slate}`}>
      {dot && (
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      )}
      {children}
    </span>
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

/**
 * Huy hiệu tổng điểm. Kỳ chưa chấm/chưa chốt thì KHÔNG tô màu xếp loại —
 * "0,00 điểm" đỏ khi nhân viên còn chưa tới hạn tự khai là báo động giả.
 */
export function ScoreBadge({
  score,
  state = "FINAL",
}: {
  score: number;
  state?: "UNSCORED" | "PROVISIONAL" | "FINAL";
}) {
  if (state === "UNSCORED") return <Badge tone="slate">Chưa chấm</Badge>;
  if (state === "PROVISIONAL") {
    return <Badge tone="slate">{fmtScore(score)} điểm · tạm tính</Badge>;
  }
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
  return <Badge tone={tone}>{fmtScore(score)} điểm</Badge>;
}

/* ------------------------------------------------------------------ ngày giờ */

export function formatDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return formatVnDate(d);
}

/** Ngày giờ theo giờ Việt Nam, đúng ở cả server (UTC) lẫn trình duyệt. */
export function formatDateTime(d: Date | string | null | undefined) {
  return formatVnDateTime(d);
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
