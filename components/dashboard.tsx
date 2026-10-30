import { formatVnTime } from "@/lib/vn-time";
import Link from "next/link";
import { Check } from "lucide-react";
import AnomalyActions from "@/components/anomaly-actions";
import {
  ANOMALY_SEVERITY_LABEL,
  CONFIDENCE_LABEL,
} from "@/lib/analytics/constants";
import { StatCard } from "@/components/ui";
import { fmtNum } from "@/lib/format";
import type {
  ActionItem,
  DashboardAlert,
  LeanTask,
  ProductionSummary,
} from "@/lib/services/dashboard-service";

/**
 * CÁC KHỐI RIÊNG CỦA BẢNG ĐIỀU HÀNH.
 *
 * Tách khỏi components/ui.tsx vì chúng chỉ dùng ở một trang. Những thứ dùng
 * chung nhiều nơi (StatCard, Badge, ProgressBar…) vẫn nằm bên kia.
 */

/* ==================================================================== */
/* NHỊP XƯỞNG SẢN XUẤT — CHỈ ADMIN VÀ BAN GIÁM ĐỐC                       */
/* ==================================================================== */

/**
 * Hai chỉ số nhìn nhanh về xưởng, dành riêng cho Admin và Ban Giám đốc — hai
 * vai trò không ở trong xưởng hằng ngày nên cần một cái liếc là biết tình hình,
 * thay vì phải mở hẳn mục Xưởng sản xuất.
 *
 * Sản lượng chỉ tính phần đã qua KCS xác nhận. Còn ca chưa xác nhận thì nói rõ
 * ra bằng chữ, không giấu — im lặng bỏ qua sẽ khiến con số trông đủ hơn thực tế.
 */
export function ProductionStatRow({ summary }: { summary: ProductionSummary }) {
  const outputLabel = fmtNum(summary.outputTonnes, 1);

  // Xưởng chưa chạy gì: một dòng trung tính, không dựng hai thẻ to tướng
  // "0 người / 0 tấn" chiếm chỗ của ngoại lệ.
  if (summary.workforceToday === 0 && summary.outputTonnes === 0) {
    return (
      <Link
        href="/production"
        className="card flex items-center justify-between gap-3 px-4 py-3 text-sm text-ink-600 transition hover:shadow-lift"
      >
        <span>
          <span className="font-medium text-ink-800">Xưởng hôm nay:</span>{" "}
          chưa có ca nào ghi nhận
          {summary.pendingQcShifts > 0
            ? ` · ${summary.pendingQcShifts} ca chờ KCS xác nhận`
            : ""}
        </span>
        <span className="shrink-0 text-xs font-medium text-brand-600">Mở →</span>
      </Link>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <StatCard
        label="Nhân lực hôm nay"
        value={`${summary.workforceToday} người`}
        hint={
          summary.workforceToday > 0
            ? "đang có mặt trong ca sản xuất"
            : "chưa có ca nào ghi nhận hôm nay"
        }
        href="/production"
      />
      <StatCard
        label={`Sản lượng ${summary.monthLabel}`}
        value={`${outputLabel} tấn`}
        hint={
          summary.pendingQcShifts > 0
            ? `đã KCS xác nhận · còn ${summary.pendingQcShifts} ca chờ xác nhận`
            : "đã KCS xác nhận đủ"
        }
        href="/production"
      />
    </div>
  );
}


/* ==================================================================== */
/* 2. HÀNG CHỜ HÀNH ĐỘNG                                                 */
/* ==================================================================== */

/**
 * Thay cho bốn thẻ số: thẻ số nói *bao nhiêu*, hàng chờ nói *làm gì, trước khi
 * nào, bấm vào đâu*.
 *
 * Luật xếp thứ tự nằm ở dashboard-service (khoá cứng trước, rồi tới hạn gần
 * trước). Ở đây chỉ vẽ, và cắt còn tối đa 5 dòng — quá 5 thì nó thành một danh
 * sách việc thứ hai và người ta bắt đầu bỏ qua.
 */
export function ActionQueue({ items }: { items: ActionItem[] }) {
  if (items.length === 0) {
    return (
      // Trạng thái bình thường: thẻ trung tính, chỉ dấu tích mang màu lá
      <div className="card mb-5 flex items-center gap-2 px-3.5 py-2.5 text-sm text-ink-700">
        <Check size={16} strokeWidth={2.5} className="shrink-0 text-leaf-600" aria-hidden />
        <span>Không có việc nào đang chờ bạn. Hàng chờ sạch.</span>
      </div>
    );
  }

  const edge = {
    red: "border-l-red-500",
    amber: "border-l-amber-500",
    brand: "border-l-brand-600",
  };
  const when = {
    red: "text-red-700",
    amber: "text-amber-800",
    brand: "text-ink-500",
  };

  return (
    <div className="mb-5 space-y-2">
      {items.map((it) => (
        <Link
          key={it.id}
          href={it.href}
          className={`flex items-center gap-3 rounded-[14px] border border-l-[3px] border-ink-200 bg-white p-3 transition hover:shadow-lift ${edge[it.tone]}`}
        >
          <span
            className={`w-16 shrink-0 text-xs leading-tight font-semibold ${when[it.tone]}`}
          >
            {it.when}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-ink-900">
              {it.title}
            </span>
            <span className="mt-0.5 block text-xs text-ink-500">{it.detail}</span>
          </span>
          <span
            className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium ${
              it.hardLock
                ? "bg-brand-600 text-white"
                : "border border-ink-200 bg-white text-ink-700"
            }`}
          >
            {it.cta}
          </span>
        </Link>
      ))}
    </div>
  );
}

/* ==================================================================== */
/* 4. DÒNG VIỆC RÚT GỌN                                                  */
/* ==================================================================== */

/**
 * Dòng việc gọn: bỏ thanh tiến độ ngang, chuyển màu trạng thái thành vệt dọc
 * bên trái, dồn số liệu vào một dòng phụ.
 *
 * Đổi lại là mất thanh tiến độ nhìn được — chấp nhận, vì trên bảng điều hành
 * người ta lọc xem việc nào cần mở ra chứ không đọc tiến độ ở đây.
 */
export function LeanTaskList({
  tasks,
  tone,
}: {
  tasks: LeanTask[];
  tone: "red" | "amber";
}) {
  const edge = tone === "red" ? "border-l-red-500" : "border-l-amber-500";
  const chip =
    tone === "red"
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-amber-200 bg-amber-50 text-amber-800";

  return (
    <div className="card divide-y divide-ink-100 p-1">
      {tasks.map((t) => (
        <Link
          key={t.id}
          href={`/tasks/${t.id}`}
          className={`flex items-center gap-3 border-l-[3px] px-2.5 py-2 transition hover:bg-ink-50 ${edge}`}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink-900">
              {t.title}
            </span>
            <span className="mt-0.5 block text-xs text-ink-500">
              <span className="font-mono">{t.code}</span> · {t.assignee} · tiến độ{" "}
              {t.progress}%
            </span>
          </span>
          <span
            className={`shrink-0 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${chip}`}
          >
            {t.lateLabel ?? formatVnTime(t.dueDate)}
          </span>
        </Link>
      ))}
    </div>
  );
}

export function TaskGroupHeading({
  label,
  count,
  note,
  tone,
}: {
  label: string;
  count: number;
  note?: string;
  tone: "red" | "amber";
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <h3
        className={`text-sm font-semibold ${
          tone === "red" ? "text-red-700" : "text-amber-800"
        }`}
      >
        {label}
      </h3>
      <span className="text-xs text-ink-400">
        {count} việc{note ? ` · ${note}` : ""}
      </span>
    </div>
  );
}

/* ==================================================================== */
/* 5. CẢNH BÁO TỪ BA BỘ MÁY PHÂN TÍCH                                    */
/* ==================================================================== */

/**
 * Kéo dự báo vỡ kế hoạch, cân bằng tải và bất thường KPI lên bảng điều hành.
 *
 * Giữ nguyên tính trung thực đã có ở tầng dưới: mỗi cảnh báo ghi rõ dựa trên
 * bao nhiêu mẫu và độ tin cậy nào. Tháng đầu chưa đủ nền thì nó nói thẳng là
 * chưa đủ, không bịa ra một con số trông thuyết phục.
 */
/**
 * Ô để chính người đang xem giải trình số của mình.
 *
 * Trang Phân tích chỉ mở cho trưởng phòng và Ban Giám đốc, nên trước đây nhân
 * viên bị đánh dấu bất thường không có đường nào vào giải trình — dù API đã cho
 * phép từ đầu. Ô này đặt ngay trên bảng điều hành để họ trả lời tại chỗ.
 *
 * Giữ đúng giọng của tầng dưới: đây là dấu hiệu thống kê, không phải lời buộc
 * tội. Không khoá thưởng, không trừ điểm — chỉ hỏi.
 */
export function SelfAnomalyPanel({
  items,
}: {
  items: {
    id: string;
    kpiName: string;
    reason: string;
    reportedValue: number;
    historicalMedian: number;
    sampleSize: number;
    severity: string;
    confidence: string;
  }[];
}) {
  if (items.length === 0) return null;

  return (
    <div id="giai-trinh" className="mt-8 scroll-mt-6">
      <h2 className="section-title mb-2">Số của bạn cần một lời giải thích</h2>
      <p className="mb-3 max-w-2xl text-sm text-ink-500">
        Hệ thống so số bạn khai kỳ này với nếp của chính bạn các kỳ trước và thấy
        lệch hẳn. Lệch có thể vì tháng này có đơn lớn thật — nên nó chỉ hỏi, không
        kết luận gì. Chưa có lời giải thích thì Ban Giám đốc chưa chốt được kỳ.
      </p>

      <div className="space-y-3">
        {items.map((a) => (
          <div key={a.id} className="card p-4">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="font-medium text-ink-900">{a.kpiName}</span>
              <span
                className={`badge border ${
                  a.severity === "CRITICAL"
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                {ANOMALY_SEVERITY_LABEL[a.severity] ?? a.severity}
              </span>
            </div>

            <p className="mb-3 text-sm text-ink-600">{plainAnomalyReason(a.reason)}</p>

            <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-500 tabular-nums">
              <span>
                bạn khai: <b className="text-ink-800">{fmtNum(a.reportedValue)}</b>
              </span>
              <span>
                nếp cũ: <b className="text-ink-800">{fmtNum(a.historicalMedian)}</b>
              </span>
              <span>
                dựa trên {a.sampleSize} kỳ ·{" "}
                {CONFIDENCE_LABEL[a.confidence] ?? a.confidence}
              </span>
            </div>

            <AnomalyActions
              anomalyId={a.id}
              status="OPEN"
              isOwner
              canReview={false}
            />
          </div>
        ))}
      </div>
    </div>
  );
}


/**
 * Lời giải thích bất thường do bộ máy phân tích viết sẵn (đã lưu trong CSDL)
 * còn dùng thuật ngữ "thước bền" và số thập phân dấu chấm. Đổi sang lời thường
 * khi HIỂN THỊ — không sửa dữ liệu gốc.
 */
export function plainAnomalyReason(reason: string) {
  const vn = (n: string) => n.replace(".", ",");
  return reason
    .replace(
      /Lệch ([\d.]+) lần theo thước bền/,
      (_, n: string) => `Lệch gấp ${vn(n)} lần mức dao động thường ngày`
    )
    .replace(
      / và ([\d.]+) lần theo độ lệch chuẩn/,
      (_, n: string) => ` (${vn(n)} lần theo độ lệch chuẩn)`
    );
}

export function AlertCard({ alert }: { alert: DashboardAlert }) {
  const titleColor = {
    red: "text-red-700",
    amber: "text-amber-800",
    brand: "text-ink-900",
  }[alert.tone];

  return (
    <Link href={alert.href} className="card block p-3 transition hover:shadow-lift">
      <div className={`text-xs font-semibold ${titleColor}`}>{alert.title}</div>
      <p className="mt-1 text-xs leading-snug text-ink-600">{alert.detail}</p>
      <p className="mt-1.5 text-xs text-ink-500">{alert.footnote}</p>
    </Link>
  );
}
