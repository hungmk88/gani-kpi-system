import { VN_TZ, vnParts } from "@/lib/vn-time";
import { fmtNum } from "@/lib/format";
import Link from "next/link";
import { PartyPopper, Target } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { buildDashboard } from "@/lib/services/dashboard-service";
import {
  buildMyTeam,
  buildQuickApprovals,
} from "@/lib/services/dashboard-extras";
import {
  ActionQueue,
  AlertCard,
  LeanTaskList,
  ProductionStatRow,
  SelfAnomalyPanel,
  TaskGroupHeading,
} from "@/components/dashboard";
import {
  KpiPayslipCard,
  MyTeamPanel,
  QuickApprovals,
  TodayHero,
  type HeroAction,
} from "@/components/vivid";
import { EmptyState, ShowingCount, StatCard } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/constants";

export const dynamic = "force-dynamic";

/**
 * BẢNG ĐIỀU HÀNH.
 *
 * Nguyên tắc xếp trang: **nêu thứ bất thường, không kể lại mọi thứ bình thường.**
 * Thứ tự từ trên xuống là thứ tự cấp bách, không phải thứ tự phòng ban:
 *
 *   0. Khối "hôm nay" (GANI Vivid) — lời chào, ngoại lệ, hạn kỳ KPI, nút chính
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
  const [d, approvals, team] = await Promise.all([
    buildDashboard(user, now),
    buildQuickApprovals(user),
    buildMyTeam(user, now),
  ]);

  const kpiScoreLabel =
    user.role === "EMPLOYEE"
      ? "Điểm KPI của bạn"
      : user.role === "MANAGER"
        ? "Điểm KPI phòng"
        : "Điểm KPI công ty";

  return (
    <>
      <TodayHero
        nowMs={now.getTime()}
        greeting={`Chào ${partOfDay(now)}, ${user.fullName.split(" ").slice(-1)[0]}`}
        dateLine={`${now.toLocaleDateString("vi-VN", {
          timeZone: VN_TZ,
          weekday: "long",
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })} · ${ROLE_LABEL[user.role]}${
          user.departmentName && user.departmentName !== ROLE_LABEL[user.role]
            ? ` · Phòng ${user.departmentName}`
            : ""
        }`}
        gate={d.gate}
        overdue={d.overdueCount}
        dueToday={d.todayCount}
        approvals={approvals.total}
        actions={heroActions(user.role, (d.myKpi?.draftCount ?? 0) > 0)}
      />

      {/* 2 ── Việc đang chờ chính người này */}
      <h2 className="section-title mb-2">
        Chờ bạn xử lý — xếp theo cái đóng trước
      </h2>
      <ActionQueue items={d.queue} />

      {/* 3 ── Số liệu, mỗi con số kèm mốc so sánh */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3 [&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(odd)]:col-span-1">
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
            value={fmtNum(d.stats.kpiScore.value, 1)}
            spark={d.stats.trend}
            sparkTone={
              d.stats.kpiScore.delta !== null && d.stats.kpiScore.delta < 0
                ? "amber"
                : "brand"
            }
            delta={d.stats.kpiScore.delta}
            deltaGoodWhen="up"
            deltaSuffix={`· ${d.stats.kpiScore.periodName} đã chốt`}
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

      {/* grid-cols-1 + min-w-0: thiếu hai thứ này thì trên điện thoại cột lưới
          tự giãn theo dòng tên việc dài (truncate = nowrap) và cả trang tràn
          ngang ra ngoài màn hình. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 [&>*]:min-w-0">
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
                    note={`lâu nhất: ${d.overdueTasks[0].lateLabel}`}
                    tone="red"
                  />
                  <LeanTaskList tasks={d.overdueTasks} tone="red" />
                  <ShowingCount
                    shown={d.overdueTasks.length}
                    total={d.overdueCount}
                    hint="trễ lâu nhất trước · bấm “Xem tất cả” để xem đủ"
                  />
                </div>
              )}

              {d.todayTasks.length > 0 && (
                <div>
                  <TaskGroupHeading
                    label="Hết hạn hôm nay"
                    count={d.todayCount}
                    tone="amber"
                  />
                  <LeanTaskList tasks={d.todayTasks} tone="amber" />
                  <ShowingCount
                    shown={d.todayTasks.length}
                    total={d.todayCount}
                    hint="hạn sớm nhất trước"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Cột phải */}
        <div className="space-y-6">
          {/* Duyệt nhanh: đơn nghỉ / yêu cầu liên phòng đang chờ chính người này */}
          <QuickApprovals items={approvals.items} total={approvals.total} />

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

          {/* 6 ── Phiếu điểm KPI: phần cộng, phần trừ, tổng — như phiếu lương */}
          {d.myKpi &&
            user.role !== "ADMIN" &&
            (d.myKpi.hasResults ? (
              <KpiPayslipCard
                periodName={d.myKpi.periodName}
                payslip={d.myKpi.payslip}
                scoreState={d.myKpi.scoreState}
                draftCount={d.myKpi.draftCount}
                selfReviewDeadline={d.myKpi.selfReviewDeadline}
              />
            ) : user.role === "CEO" ? null : (
              <div className="card p-4 text-sm text-ink-500">
                <h2 className="section-title mb-1">
                  Phiếu điểm KPI · {d.myKpi.periodName}
                </h2>
                Bạn chưa được gán chỉ tiêu nào cho kỳ này.
              </div>
            ))}

          {/* 7 ── Phòng của tôi: ai có mặt, ai nghỉ, ai đang kẹt */}
          {team && team.members.length > 1 && <MyTeamPanel team={team} />}

          {user.role === "CEO" && (
            <Link
              href="/ceo"
              className="card block p-4 transition hover:shadow-lift"
            >
              <div className="flex items-center gap-2 font-medium text-brand-700">
                <Target size={16} strokeWidth={2} /> Mở bảng điều hành Ban Giám
                đốc
              </div>
              <p className="mt-1 text-xs text-ink-500">
                Toàn bộ cảnh báo ngoại lệ, lệch số liệu và KPI chờ duyệt gom về
                một chỗ.
              </p>
            </Link>
          )}
        </div>
      </div>

      {/* Nhịp xưởng hôm nay, chỉ Admin/BGĐ. Đặt SAU hàng chờ và việc trễ:
          số liệu nền không được chiếm chỗ của ngoại lệ. */}
      {d.production && (
        <div className="mt-6">
          <ProductionStatRow summary={d.production} />
        </div>
      )}

      {/* Nhân viên giải trình ngay tại chỗ — trang Phân tích không mở cho họ. */}
      <SelfAnomalyPanel items={d.myOpenAnomalies} />
    </>
  );
}

/** "buổi sáng / trưa / chiều / tối" theo giờ Việt Nam */
function partOfDay(now: Date) {
  const h = vnParts(now).hour;
  if (h < 11) return "buổi sáng";
  if (h < 14) return "buổi trưa";
  if (h < 18) return "buổi chiều";
  return "buổi tối";
}

/** Tối đa 3 nút trong khối "hôm nay" — nút đầu là việc chính của vai trò */
function heroActions(role: string, hasDraftKpi: boolean): HeroAction[] {
  switch (role) {
    case "EMPLOYEE":
      return hasDraftKpi
        ? [
            { href: "/kpi", label: "Tự khai KPI" },
            { href: "/tasks", label: "Việc của tôi" },
            { href: "/leave-requests", label: "Xin nghỉ phép" },
          ]
        : [
            { href: "/tasks", label: "Việc của tôi" },
            { href: "/kpi", label: "KPI của tôi" },
            { href: "/leave-requests", label: "Xin nghỉ phép" },
          ];
    case "MANAGER":
      return [
        { href: "/kpi", label: "Duyệt KPI phòng" },
        { href: "/tasks/new", label: "Giao việc mới" },
        { href: "/tasks", label: "Bảng công việc" },
      ];
    case "CEO":
      return [
        { href: "/ceo", label: "Bảng điều hành" },
        { href: "/kpi", label: "Duyệt & chốt KPI" },
        { href: "/analytics", label: "Phân tích" },
      ];
    case "ADMIN":
      return [
        { href: "/admin", label: "Quản trị tài khoản" },
        { href: "/audit", label: "Nhật ký hệ thống" },
      ];
    default:
      return [];
  }
}
