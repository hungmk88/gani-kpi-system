import { formatVnDate, formatVnTime, VN_TZ } from "@/lib/vn-time";
import Link from "next/link";
import { PartyPopper, Target } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { buildDashboard } from "@/lib/services/dashboard-service";
import {
  ActionQueue,
  AlertCard,
  LeanTaskList,
  PeriodGateTrack,
  ProductionStatRow,
  SelfAnomalyPanel,
  TaskGroupHeading,
} from "@/components/dashboard";
import {
  Badge,
  EmptyState,
  PageHeader,
  ProgressBar,
  StatCard,
} from "@/components/ui";
import { ROLE_LABEL } from "@/lib/constants";

export const dynamic = "force-dynamic";

/**
 * BẢNG ĐIỀU HÀNH.
 *
 * Nguyên tắc xếp trang: **nêu thứ bất thường, không kể lại mọi thứ bình thường.**
 * Thứ tự từ trên xuống là thứ tự cấp bách, không phải thứ tự phòng ban:
 *
 *   1. Cửa nào sắp đóng      — hậu quả không đảo ngược được
 *   2. Việc gì đang chờ mình — có thể bấm vào làm ngay
 *   3. Số liệu, có so sánh   — nói xu hướng, không chỉ nói con số
 *   4. Việc trễ / hôm nay    — hai nhóm tách hẳn nhau
 *   5. Máy đang cảnh báo gì  — ba bộ máy phân tích
 *
 * Phần gom dữ liệu nằm ở lib/services/dashboard-service.ts.
 */
export default async function DashboardPage() {
  const user = (await requireSession())!;
  const now = new Date();
  const d = await buildDashboard(user, now);

  const kpiScoreLabel =
    user.role === "EMPLOYEE"
      ? "Điểm KPI của bạn"
      : user.role === "MANAGER"
        ? "Điểm KPI phòng"
        : "Điểm KPI công ty";

  return (
    <>
      <PageHeader
        title={`Chào ${user.fullName.split(" ").slice(-1)[0]}`}
        subtitle={`${ROLE_LABEL[user.role]}${
          user.departmentName ? ` · Phòng ${user.departmentName}` : ""
        } · ${now.toLocaleDateString("vi-VN", {
          timeZone: VN_TZ,
          weekday: "long",
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })} · ${formatVnTime(now)}`}
      />

      {/* 1 ── Nhịp kỳ KPI. Quản trị không có KPI nên không thấy khối này. */}
      {d.gate && <PeriodGateTrack gate={d.gate} />}

      {/* 1b ── Nhịp xưởng hôm nay, chỉ Admin/BGĐ — họ không ở xưởng hằng ngày */}
      {d.production && <ProductionStatRow summary={d.production} />}

      {/* 2 ── Việc đang chờ chính người này */}
      <h2 className="section-title mb-2">
        Chờ bạn xử lý — xếp theo cái đóng trước
      </h2>
      <ActionQueue items={d.queue} />

      {/* 3 ── Số liệu, mỗi con số kèm mốc so sánh */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          label="Việc đang mở"
          value={d.stats.open.value}
          delta={d.stats.open.delta}
          deltaGoodWhen="down"
          hint={user.role === "EMPLOYEE" ? "việc của bạn" : "trong tầm quản lý"}
          href="/tasks"
        />
        <StatCard
          label="Việc trễ hạn"
          value={d.stats.overdue.value}
          valueTone={d.stats.overdue.value > 0 ? "red" : "default"}
          delta={d.stats.overdue.delta}
          deltaGoodWhen="down"
          tone={d.stats.overdue.value > 0 ? "red" : "green"}
          hint={
            d.stats.overdue.value > 0 ? "cần xử lý ngay" : "không có việc trễ"
          }
          href="/tasks?filter=overdue"
        />
        {d.stats.kpiScore ? (
          <StatCard
            label={kpiScoreLabel}
            value={d.stats.kpiScore.value.toFixed(1)}
            spark={d.stats.trend}
            sparkTone={
              d.stats.kpiScore.delta !== null && d.stats.kpiScore.delta < 0
                ? "amber"
                : "brand"
            }
            delta={d.stats.kpiScore.delta}
            deltaGoodWhen="up"
            deltaSuffix="so với kỳ trước"
            href="/kpi"
          />
        ) : (
          <StatCard
            label={kpiScoreLabel}
            value="—"
            hint="chưa có kỳ nào chấm xong"
            href="/kpi"
          />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* 4 ── Việc: quá hạn và hôm nay là hai nhóm riêng */}
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title">Việc cần nhìn hôm nay</h2>
            <Link
              href="/tasks"
              className="text-xs font-medium text-brand-600 hover:underline"
            >
              Xem tất cả →
            </Link>
          </div>

          {d.overdueTasks.length === 0 && d.todayTasks.length === 0 ? (
            <EmptyState
              icon={<PartyPopper size={32} strokeWidth={1.75} />}
              title="Không có việc nào trễ hay tới hạn hôm nay"
              hint="Danh sách sạch. Vào mục Công việc để xem các việc còn hạn."
            />
          ) : (
            <div className="space-y-5">
              {d.overdueTasks.length > 0 && (
                <div>
                  <TaskGroupHeading
                    label="Đã quá hạn"
                    count={d.overdueCount}
                    note={`cũ nhất ${d.overdueTasks[0].lateDays} ngày`}
                    tone="red"
                  />
                  <LeanTaskList tasks={d.overdueTasks} tone="red" />
                </div>
              )}

              {d.todayTasks.length > 0 && (
                <div>
                  <TaskGroupHeading
                    label="Hết hạn hôm nay"
                    count={d.todayTasks.length}
                    tone="amber"
                  />
                  <LeanTaskList tasks={d.todayTasks} tone="amber" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Cột phải */}
        <div className="space-y-6">
          {/* 5 ── Ba bộ máy phân tích */}
          {d.alerts.length > 0 && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="section-title">Hệ thống đang cảnh báo</h2>
                {/* Trang Phân tích chỉ mở cho trưởng phòng và Ban Giám đốc —
                    người khác bấm vào sẽ bị đá ngược về đây. */}
                {(user.role === "MANAGER" || user.role === "CEO") && (
                  <Link
                    href="/analytics"
                    className="text-xs font-medium text-brand-600 hover:underline"
                  >
                    Mở →
                  </Link>
                )}
              </div>
              <div className="space-y-2">
                {d.alerts.map((a) => (
                  <AlertCard key={a.id} alert={a} />
                ))}
              </div>
            </div>
          )}

          {/* 6 ── KPI của tôi: chỉ nêu chỉ tiêu đang kéo tụt */}
          {d.myKpi && user.role !== "ADMIN" && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="section-title">
                  KPI của tôi · {d.myKpi.periodName}
                </h2>
                <Link
                  href="/kpi"
                  className="text-xs font-medium text-brand-600 hover:underline"
                >
                  Mở →
                </Link>
              </div>

              <div className="card p-4">
                {!d.myKpi.hasResults ? (
                  <p className="text-sm text-ink-500">
                    Bạn chưa được gán chỉ tiêu nào cho kỳ này.
                  </p>
                ) : (
                  <>
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <Badge tone={d.myKpi.classTone}>
                        {d.myKpi.totalScore.toFixed(2)} điểm ·{" "}
                        {d.myKpi.classLabel}
                      </Badge>
                      <span className="text-xs text-ink-500">
                        {d.myKpi.draftCount > 0
                          ? `còn ${d.myKpi.draftCount} chưa khai`
                          : "đã tự khai xong"}
                      </span>
                    </div>

                    {d.myKpi.draftCount > 0 && (
                      <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        Còn <b>{d.myKpi.draftCount}</b> chỉ tiêu chưa tự khai.
                        Hạn chót{" "}
                        23:59 ngày {formatVnDate(d.myKpi.selfReviewDeadline)}.
                      </div>
                    )}

                    {/* Nêu đúng chỉ tiêu đang kéo tụt, phần còn lại gộp vào
                        điểm tổng — muốn xem đủ thì bấm sang trang KPI. */}
                    {d.myKpi.weakest && (
                      <>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate text-ink-700">
                            {d.myKpi.weakest.name}
                          </span>
                          <span
                            className={`shrink-0 font-medium ${
                              d.myKpi.weakest.achievement >= 100
                                ? "text-emerald-700"
                                : d.myKpi.weakest.achievement >= 80
                                  ? "text-amber-700"
                                  : "text-red-600"
                            }`}
                          >
                            {d.myKpi.weakest.achievement}%
                          </span>
                        </div>
                        <div className="mt-1">
                          <ProgressBar
                            value={(d.myKpi.weakest.achievement / 150) * 100}
                            tone={
                              d.myKpi.weakest.achievement >= 100
                                ? "green"
                                : d.myKpi.weakest.achievement >= 80
                                  ? "amber"
                                  : "red"
                            }
                          />
                        </div>
                        <p className="mt-1.5 text-[11px] text-ink-500">
                          {d.myKpi.weakest.achievement >= 100
                            ? "Chỉ tiêu thấp nhất của bạn — vẫn đang đạt."
                            : "Chỉ tiêu thấp nhất — đang kéo điểm tổng xuống."}
                        </p>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {user.role === "CEO" && (
            <Link
              href="/ceo"
              className="card block p-4 transition hover:shadow-md"
            >
              <div className="flex items-center gap-2 font-medium text-brand-700">
                <Target size={16} strokeWidth={2} /> Mở Bảng điều hành Ban Giám đốc
              </div>
              <p className="mt-1 text-xs text-ink-500">
                Toàn bộ cảnh báo ngoại lệ, lệch số liệu và KPI chờ duyệt gom về
                một chỗ.
              </p>
            </Link>
          )}
        </div>
      </div>

      {/* Nhân viên giải trình ngay tại chỗ — trang Phân tích không mở cho họ. */}
      <SelfAnomalyPanel items={d.myOpenAnomalies} />
    </>
  );
}
