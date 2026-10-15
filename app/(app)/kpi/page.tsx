import Link from "next/link";
import { CalendarDays, ChevronRight } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import {
  classifyScoreFor,
  isCountedKpiRow,
  scoreStateOf,
  summarizeResults,
} from "@/lib/kpi";
import { getDeadlinePeriod } from "@/lib/services/period-service";
import {
  EmptyState,
  PageHeader,
  PeriodStatusBadge,
  ProgressBar,
  ScoreBadge,
  StatCard,
  fmtScore,
  formatDate,
} from "@/components/ui";
import OpenPeriodButton from "./open-period-button";

export const dynamic = "force-dynamic";

export default async function KpiHomePage() {
  const user = (await requireSession())!;

  const periods = await prisma.kpiPeriod.findMany({
    orderBy: [{ year: "desc" }, { month: "desc" }],
    take: 12,
  });

  // "Kỳ đang chạy" = kỳ đang tới hạn (ngày 1–5 vẫn là kỳ tháng trước đang
  // chốt), không phải kỳ mới nhất — kỳ mới nhất có thể đã chốt xong.
  const deadlinePeriod = await getDeadlinePeriod();
  const current =
    (deadlinePeriod && periods.find((p) => p.id === deadlinePeriod.id)) ??
    periods[0];

  const allMine = current
    ? await prisma.kpiResult.findMany({
        where: { periodId: current.id, employeeId: user.id },
        include: { kpiDefinition: true },
        orderBy: { weightPercent: "desc" },
      })
    : [];
  // Chỉ tiêu đã ngưng dùng mà trọng số 0 thì không tính vào điểm, không cần
  // khai — liệt kê ra chỉ làm tăng "chưa khai" giả.
  const myResults = allMine.filter(isCountedKpiRow);
  const s = summarizeResults(myResults);
  const state = scoreStateOf(current?.status, myResults);
  const cls = classifyScoreFor(s.totalScore, state);
  const draftCount = myResults.filter((r) => r.status === "DRAFT").length;
  // Ban Giám đốc và quản trị thường không được gán chỉ tiêu nào — khi đó
  // hiển thị dấu gạch chứ không hiện "0 điểm · Không đạt" gây hiểu nhầm.
  const hasOwnKpi = myResults.length > 0;

  // Số dòng đang chờ vai trò của người này xử lý
  let pending = 0;
  if (current) {
    if (user.role === "MANAGER") {
      pending = await prisma.kpiResult.count({
        where: {
          periodId: current.id,
          status: "SELF_REVIEWED",
          employee: { departmentId: user.departmentId ?? "__none__" },
        },
      });
    } else if (user.role === "CEO") {
      pending = await prisma.kpiResult.count({
        where: { periodId: current.id, status: "MANAGER_REVIEWED" },
      });
    } else {
      pending = draftCount;
    }
  }

  return (
    <>
      <PageHeader
        title="KPI"
        subtitle="Thang điểm 100 · Cho vượt chỉ tiêu, trần 150% (Kinh doanh 120%) · Luồng duyệt khoá tự động ngày 2 – 4 – 5"
        actions={
          can(user, "kpi.period.manage") ? <OpenPeriodButton /> : undefined
        }
      />

      {!current ? (
        <EmptyState
          icon={<CalendarDays size={32} strokeWidth={1.75} />}
          title="Chưa có kỳ KPI nào được mở"
          hint={
            can(user, "kpi.period.manage")
              ? "Bấm 'Mở kỳ KPI mới' để bắt đầu. Hệ thống sẽ tự gán bộ chỉ tiêu của từng phòng ban cho nhân sự."
              : "Chờ Ban Giám đốc hoặc quản trị hệ thống mở kỳ đánh giá."
          }
        />
      ) : (
        <>
          {/* ------------- Kỳ hiện tại ------------- */}
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Kỳ đang chạy"
              value={current.name}
              hint={
                current.status === "OPEN"
                  ? `Hạn tự khai ${formatDate(current.selfReviewDeadline)}`
                  : undefined
              }
              href={`/kpi/${current.id}`}
            />
            {user.role !== "ADMIN" && (
              <StatCard
                label="Điểm KPI của tôi"
                value={
                  hasOwnKpi && state !== "UNSCORED" ? fmtScore(s.totalScore) : "—"
                }
                tone={hasOwnKpi ? cls.tone : "slate"}
                hint={
                  !hasOwnKpi
                    ? "chưa được gán chỉ tiêu"
                    : state === "UNSCORED"
                      ? `chưa chấm · ${myResults.length - draftCount}/${myResults.length} đã khai`
                      : state === "PROVISIONAL"
                        ? "tạm tính · kỳ chưa chốt"
                        : cls.label
                }
              />
            )}
            <StatCard
              label="Tổng trọng số của tôi"
              value={hasOwnKpi ? `${s.totalWeight}%` : "—"}
              tone={
                !hasOwnKpi ? "slate" : s.totalWeight === 100 ? "green" : "amber"
              }
              hint={
                !hasOwnKpi
                  ? "không áp dụng"
                  : s.totalWeight === 100
                    ? "chuẩn 100%"
                    : "chưa đủ/vượt 100%"
              }
            />
            <StatCard
              label={
                user.role === "MANAGER"
                  ? "Chờ bạn duyệt"
                  : user.role === "CEO"
                    ? "Chờ Ban Giám đốc"
                    : "Bạn chưa khai"
              }
              value={pending}
              tone={pending > 0 ? "amber" : "green"}
              href={`/kpi/${current.id}`}
            />
          </div>

          {/* ------------- KPI của tôi ------------- */}
          {user.role !== "ADMIN" && myResults.length > 0 && (
            <section className="mb-8">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="section-title">
                  Chỉ tiêu của tôi · {current.name}
                </h2>
                <Link
                  href={`/kpi/${current.id}`}
                  className="text-xs font-medium text-brand-600 hover:underline"
                >
                  Mở bảng làm việc →
                </Link>
              </div>
              {/* Điện thoại: mỗi chỉ tiêu một thẻ — bảng 6 cột trên 390px thì
                  cột Thực tế / Mức đạt / Điểm không bao giờ hiện ra. */}
              <ul className="space-y-2 sm:hidden">
                {myResults.map((r) => {
                  const actual = r.actualFinal ?? r.actualSelf ?? r.actualSystem;
                  return (
                    <li key={r.id} className="card p-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium text-ink-800">
                            {r.kpiDefinition?.name ?? "—"}
                          </div>
                          <div className="text-xs text-ink-500">
                            Trọng số {r.weightPercent ?? 0}% ·{" "}
                            {r.kpiDefinition?.isHigherBetter
                              ? "càng cao càng tốt"
                              : "càng thấp càng tốt"}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-semibold text-ink-900">
                            {actual === null ? "—" : fmtScore(r.weightedScore)}
                          </div>
                          <div className="text-xs text-ink-500">điểm</div>
                        </div>
                      </div>
                      <div className="mt-2 flex items-baseline justify-between gap-2 text-sm">
                        <span className="text-ink-600">
                          Giao {fmt(r.targetValue)} → Thực tế{" "}
                          <b className="text-ink-900">{fmt(actual)}</b>{" "}
                          {r.kpiDefinition?.unit}
                        </span>
                        <span className="shrink-0 text-xs text-ink-600">
                          {actual === null
                            ? "chưa khai"
                            : `${pct(r.achievementPercent)}${r.isCapped ? " · trần" : ""}`}
                        </span>
                      </div>
                      {actual !== null && (
                        <div className="mt-1.5">
                          <ProgressBar
                            value={(r.achievementPercent / 150) * 100}
                            tone={
                              r.achievementPercent >= 100
                                ? "green"
                                : r.achievementPercent >= 80
                                  ? "amber"
                                  : "red"
                            }
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
                <li className="flex items-center justify-between rounded-md bg-ink-100/70 px-3.5 py-2.5 text-sm font-semibold">
                  <span>Tổng · trọng số {s.totalWeight}%</span>
                  <ScoreBadge score={s.totalScore} state={state} />
                </li>
              </ul>

              <div className="table-wrap hidden sm:block">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Chỉ tiêu</th>
                      <th className="text-right">Trọng số</th>
                      <th className="text-right">Chỉ tiêu giao</th>
                      <th className="text-right">Thực tế</th>
                      <th className="w-40">Mức đạt</th>
                      <th className="text-right">Điểm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myResults.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <div className="font-medium text-ink-800">
                            {r.kpiDefinition?.name ?? "—"}
                          </div>
                          <div className="text-xs text-ink-500">
                            {r.kpiDefinition?.isHigherBetter
                              ? "Càng cao càng tốt"
                              : "Càng thấp càng tốt"}{" "}
                            · {r.kpiDefinition?.unit}
                          </div>
                        </td>
                        <td className="text-right text-ink-600 tabular-nums">
                          {r.weightPercent}%
                        </td>
                        <td className="text-right text-ink-600">
                          {fmt(r.targetValue)}
                        </td>
                        <td className="text-right font-medium text-ink-800">
                          {fmt(r.actualFinal ?? r.actualSelf ?? r.actualSystem)}
                        </td>
                        <td>
                          {(r.actualFinal ?? r.actualSelf ?? r.actualSystem) === null ? (
                            <span className="text-xs text-ink-500">chưa khai</span>
                          ) : (
                          <>
                          <div className="mb-1 text-xs text-ink-600">
                            {pct(r.achievementPercent)}
                            {r.isCapped && " (chạm trần)"}
                          </div>
                          <ProgressBar
                            value={(r.achievementPercent / 150) * 100}
                            tone={
                              r.achievementPercent >= 100
                                ? "green"
                                : r.achievementPercent >= 80
                                  ? "amber"
                                  : "red"
                            }
                          />
                          </>
                          )}
                        </td>
                        <td className="text-right font-semibold text-ink-900">
                          {(r.actualFinal ?? r.actualSelf ?? r.actualSystem) === null
                            ? "—"
                            : fmtScore(r.weightedScore)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-ink-50/70 font-semibold">
                      <td>Tổng cộng</td>
                      <td className="text-right">{s.totalWeight}%</td>
                      <td colSpan={3}></td>
                      <td className="text-right">
                        <ScoreBadge score={s.totalScore} state={state} />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ------------- Danh sách kỳ ------------- */}
          {/* Kỳ đang chạy / còn mở: thẻ đủ ba mốc hạn. Kỳ đã chốt: một dòng gọn
              (tháng + trạng thái) — lặp lại ba dòng ngày đã qua chỉ là nhiễu. */}
          <section>
            <h2 className="section-title mb-3">Các kỳ đánh giá</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {periods
                .filter((p) => p.id === current.id || p.status !== "FINALIZED")
                .map((p) => (
                <Link
                  key={p.id}
                  href={`/kpi/${p.id}`}
                  className="card p-4 transition hover:shadow-md"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-semibold text-ink-900">{p.name}</span>
                    <PeriodStatusBadge status={p.status} />
                  </div>
                  <div className="space-y-1 text-xs text-ink-500">
                    <div>
                      Nhân viên tự khai đến {formatDate(p.selfReviewDeadline)}
                    </div>
                    <div>
                      Trưởng phòng duyệt đến{" "}
                      {formatDate(p.managerReviewDeadline)}
                    </div>
                    <div>
                      Ban Giám đốc chốt {formatDate(p.ceoApprovalDeadline)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
            {periods.some(
              (p) => p.id !== current.id && p.status === "FINALIZED"
            ) && (
              <ul className="card mt-3 divide-y divide-ink-100">
                {periods
                  .filter((p) => p.id !== current.id && p.status === "FINALIZED")
                  .map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/kpi/${p.id}`}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition hover:bg-ink-50"
                      >
                        <span className="font-medium text-ink-900">{p.name}</span>
                        <span className="flex items-center gap-2">
                          <PeriodStatusBadge status={p.status} />
                          <ChevronRight size={16} className="text-ink-400" aria-hidden />
                        </span>
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}

function pct(n: number) {
  return `${n.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
}

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n);
}
