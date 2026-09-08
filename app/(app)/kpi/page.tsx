import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { classifyScore, summarizeResults } from "@/lib/kpi";
import {
  EmptyState,
  PageHeader,
  PeriodStatusBadge,
  ProgressBar,
  ScoreBadge,
  StatCard,
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

  const current = periods[0];

  const myResults = current
    ? await prisma.kpiResult.findMany({
        where: { periodId: current.id, employeeId: user.id },
        include: { kpiDefinition: true },
        orderBy: { weightPercent: "desc" },
      })
    : [];
  const s = summarizeResults(myResults);
  const cls = classifyScore(s.totalScore);
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
      pending = myResults.filter((r) => r.status === "DRAFT").length;
    }
  }

  return (
    <>
      <PageHeader
        title="KPI"
        subtitle="Thang điểm 100 · Cho vượt chỉ tiêu, chặn trần ở 150% · Luồng duyệt khoá tự động ngày 2 – 4 – 5"
        actions={
          can(user, "kpi.period.manage") ? <OpenPeriodButton /> : undefined
        }
      />

      {!current ? (
        <EmptyState
          icon="📅"
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
            {(user.role === "CEO" || (user.role === "MANAGER" && user.departmentId)) && (
              <Link
                href={`/kpi/nam-quyet-dinh?periodId=${current.id}`}
                className="card p-4 transition hover:shadow-md hover:bg-blue-50"
              >
                <div className="text-sm font-semibold text-ink-600">📊 Năm Quyết Định</div>
                <div className="mt-2 text-sm text-ink-500">Nhập mục tiêu KPI phòng SX</div>
              </Link>
            )}
            {user.role !== "ADMIN" && (
              <StatCard
                label="Điểm KPI của tôi"
                value={hasOwnKpi ? s.totalScore.toFixed(1) : "—"}
                tone={hasOwnKpi ? cls.tone : "slate"}
                hint={hasOwnKpi ? cls.label : "chưa được gán chỉ tiêu"}
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
              <div className="table-wrap">
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
                        <td className="text-right text-ink-600">
                          {r.weightPercent}%
                        </td>
                        <td className="text-right text-ink-600">
                          {fmt(r.targetValue)}
                        </td>
                        <td className="text-right font-medium text-ink-800">
                          {fmt(r.actualFinal ?? r.actualSelf ?? r.actualSystem)}
                        </td>
                        <td>
                          <div className="mb-1 text-xs text-ink-600">
                            {r.achievementPercent}%
                            {r.isCapped && " (chạm trần 150%)"}
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
                        </td>
                        <td className="text-right font-semibold text-ink-900">
                          {r.weightedScore.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-ink-50/70 font-semibold">
                      <td>Tổng cộng</td>
                      <td className="text-right">{s.totalWeight}%</td>
                      <td colSpan={3}></td>
                      <td className="text-right">
                        <ScoreBadge score={s.totalScore} />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ------------- Danh sách kỳ ------------- */}
          <section>
            <h2 className="section-title mb-3">Các kỳ đánh giá</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {periods.map((p) => (
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
          </section>
        </>
      )}
    </>
  );
}

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n);
}
