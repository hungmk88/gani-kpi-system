import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleCheck, DatabaseZap } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DATA_MISMATCH_THRESHOLD_PERCENT } from "@/lib/constants";
import { fmtDateTime, fmtNum, fmtPct } from "@/lib/format";
import { getClosingPeriod } from "@/lib/services/period-service";
import { reconPeriodState } from "@/lib/services/reconciliation-service";
import {
  Badge,
  EmptyState,
  PageHeader,
  ShowingCount,
  StatCard,
} from "@/components/ui";
import ResolvePanel, { type SourceRow } from "./resolve-panel";
import PeriodPicker from "./period-picker";

export const dynamic = "force-dynamic";

/** Lịch sử đã chốt hiện tối đa chừng này dòng mỗi kỳ */
const RESOLVED_LIMIT = 20;

/** Mã nguồn đặc biệt khi chốt — các nguồn khác đã có nhãn trong sourcesJson */
const RESOLVED_SOURCE_LABEL: Record<string, string> = {
  MANUAL_OVERRIDE: "Ban Giám đốc nhập số khác",
  SELF: "Nhân viên tự khai",
};

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = (await requireSession())!;
  if (user.role !== "CEO" && user.role !== "MANAGER") redirect("/dashboard");

  const sp = await searchParams;
  const scope =
    user.role === "MANAGER"
      ? { employee: { departmentId: user.departmentId ?? "__none__" } }
      : {};

  // Mặc định là kỳ ĐANG CHỐT (đầu tháng là kỳ tháng trước) — đúng kỳ mà mọi
  // người đang khai/duyệt, nơi số lệch cần được quyết trước hạn.
  const [periods, closing] = await Promise.all([
    prisma.kpiPeriod.findMany({
      orderBy: [{ year: "desc" }, { month: "desc" }],
      take: 12,
      select: { id: true, name: true },
    }),
    getClosingPeriod(),
  ]);
  const period =
    periods.find((p) => p.id === sp.period) ??
    (sp.period
      ? await prisma.kpiPeriod.findUnique({
          where: { id: sp.period },
          select: { id: true, name: true },
        })
      : null) ??
    (closing ? { id: closing.id, name: closing.name } : null) ??
    periods[0] ??
    null;

  if (!period) {
    return (
      <>
        <PageHeader title="Đối soát dữ liệu" />
        <EmptyState
          icon={<DatabaseZap size={32} strokeWidth={1.75} />}
          title="Chưa có kỳ KPI nào"
          hint="Mở kỳ KPI đầu tiên thì số từ các nguồn mới bắt đầu được đối chiếu."
        />
      </>
    );
  }
  const periodList = periods.some((p) => p.id === period.id)
    ? periods
    : [period, ...periods];

  const inPeriod = { periodId: period.id, ...scope };

  const [mismatches, resolved, statusCounts, otherPending] = await Promise.all([
    prisma.reconciliation.findMany({
      where: { status: "MISMATCH", ...inPeriod },
      include: {
        employee: { include: { department: true } },
        kpiDefinition: true,
      },
      orderBy: { variancePercent: "desc" },
    }),
    prisma.reconciliation.findMany({
      where: { status: "RESOLVED", ...inPeriod },
      include: { employee: true, kpiDefinition: true, resolvedBy: true },
      orderBy: { resolvedAt: "desc" },
      take: RESOLVED_LIMIT,
    }),
    prisma.reconciliation.groupBy({
      by: ["status"],
      where: inPeriod,
      _count: { _all: true },
    }),
    // Ô còn treo ở KỲ KHÁC — không được để chìm chỉ vì đang xem kỳ này
    prisma.reconciliation.groupBy({
      by: ["periodId"],
      where: { status: "MISMATCH", periodId: { not: period.id }, ...scope },
      _count: { _all: true },
    }),
  ]);

  const count = (s: string) =>
    statusCounts.find((c) => c.status === s)?._count._all ?? 0;
  const matchedCount = count("MATCHED");
  const resolvedCount = count("RESOLVED");
  const state = reconPeriodState({
    matched: matchedCount,
    mismatched: mismatches.length,
    resolved: resolvedCount,
  });
  const noData = state === "no_data";

  const otherPeriodNames = otherPending.length
    ? await prisma.kpiPeriod.findMany({
        where: { id: { in: otherPending.map((o) => o.periodId) } },
        select: { id: true, name: true },
      })
    : [];

  const worst = mismatches[0]?.variancePercent ?? 0;

  return (
    <>
      <PageHeader
        title="Đối soát dữ liệu"
        subtitle={`Khi các nguồn số liệu đá nhau quá ${DATA_MISMATCH_THRESHOLD_PERCENT}%, hệ thống KHÔNG tự chọn con số nào. Nó treo lại ở đây chờ người quyết, và ghi tên người quyết vào nhật ký.`}
        actions={<PeriodPicker periods={periodList} value={period.id} />}
      />

      {otherPending.length > 0 && (
        <div
          role="status"
          className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          Còn ô lệch chưa chốt ở kỳ khác:{" "}
          {otherPending.map((o, i) => (
            <span key={o.periodId}>
              {i > 0 && ", "}
              <Link
                href={`/reconciliation?period=${o.periodId}`}
                className="font-medium underline hover:no-underline"
              >
                kỳ {otherPeriodNames.find((p) => p.id === o.periodId)?.name ?? "khác"} (
                {fmtNum(o._count._all)})
              </Link>
            </span>
          ))}
          .
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Đang treo chờ quyết"
          value={fmtNum(mismatches.length)}
          surface={mismatches.length > 0 ? "red" : undefined}
          hint={
            mismatches.length > 0
              ? "chưa có số để chấm điểm"
              : noData
                ? "chưa có dữ liệu kỳ này"
                : "không có ô nào treo"
          }
        />
        <StatCard
          label="Mức lệch cao nhất"
          value={worst > 0 ? fmtPct(worst) : "—"}
          valueTone={worst > 20 ? "red" : worst > 0 ? "amber" : "default"}
          hint={`ngưỡng cảnh báo ${fmtPct(DATA_MISMATCH_THRESHOLD_PERCENT)}`}
        />
        <StatCard
          label="Các nguồn khớp nhau"
          value={noData ? "—" : fmtNum(matchedCount)}
          hint={
            noData
              ? "chưa có nguồn ngoài nào về số"
              : "đã tự đồng bộ, không cần ai đụng vào"
          }
        />
        <StatCard
          label="Đã có người chốt"
          value={fmtNum(resolvedCount)}
          hint={`trong kỳ ${period.name}`}
        />
      </div>

      <section className="mb-8">
        <h2 className="section-title mb-3">
          Cần bạn quyết ({fmtNum(mismatches.length)})
        </h2>

        {state === "no_data" ? (
          // Trung tính, không phải dấu tích xanh: không có ô nào có thể là vì
          // nguồn ngoài chưa nạp — hoặc đang hỏng.
          <EmptyState
            icon={<DatabaseZap size={32} strokeWidth={1.75} />}
            title="Chưa có dữ liệu kỳ này"
            hint={`Kỳ ${period.name} chưa có nguồn ngoài nào (iPOS, file Excel, xưởng…) nạp số để đối chiếu với số tự khai. Khi có, các ô lệch quá ${fmtPct(DATA_MISMATCH_THRESHOLD_PERCENT)} sẽ hiện ở đây.`}
          />
        ) : state === "all_matched" ? (
          <EmptyState
            icon={<CircleCheck size={32} strokeWidth={1.75} />}
            title="Các nguồn số liệu kỳ này đang khớp nhau"
            hint={`${fmtNum(matchedCount + resolvedCount)} ô đã đối chiếu: ${fmtNum(matchedCount)} ô khớp sẵn, ${fmtNum(resolvedCount)} ô đã có người chốt.`}
          />
        ) : (
          <div className="space-y-3">
            {mismatches.map((m) => {
              const sources: SourceRow[] = JSON.parse(m.sourcesJson);
              return (
                <div key={m.id} className="card overflow-hidden">
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b border-ink-100 bg-red-50/50 px-4 py-3">
                    <div className="min-w-0">
                      <div className="font-medium text-ink-900">
                        {m.employee.fullName} — {m.kpiDefinition.name}
                      </div>
                      <div className="mt-0.5 text-xs text-ink-500">
                        {m.employee.department?.name ?? "—"} · Kỳ {period.name} ·
                        Đơn vị {m.kpiDefinition.unit} · Treo từ{" "}
                        {fmtDateTime(m.createdAt)}
                      </div>
                    </div>
                    <Badge tone="red">Lệch {fmtPct(m.variancePercent)}</Badge>
                  </div>

                  <div className="p-4">
                    <ResolvePanel
                      reconciliationId={m.id}
                      sources={sources}
                      unit={m.kpiDefinition.unit}
                      allowCustom={user.role === "CEO"}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {resolved.length > 0 && (
        <section>
          <h2 className="section-title mb-3">Lịch sử đã chốt</h2>
          <div className="table-wrap">
            <table className="tbl tbl-stack">
              <thead>
                <tr>
                  <th>Nhân sự</th>
                  <th>Chỉ tiêu</th>
                  <th className="text-right">Số đã chốt</th>
                  <th>Theo nguồn</th>
                  <th>Người chốt</th>
                  <th>Lý do</th>
                </tr>
              </thead>
              <tbody>
                {resolved.map((r) => {
                  const src: SourceRow[] = safeSources(r.sourcesJson);
                  const srcLabel =
                    RESOLVED_SOURCE_LABEL[r.resolvedSource ?? ""] ??
                    src.find((s) => s.code === r.resolvedSource)?.label ??
                    r.resolvedSource ??
                    "—";
                  return (
                    <tr key={r.id}>
                      <td className="text-ink-800">{r.employee.fullName}</td>
                      <td data-label="Chỉ tiêu" className="text-ink-700">
                        {r.kpiDefinition.name}
                      </td>
                      <td
                        data-label="Số đã chốt"
                        className="text-right font-medium text-ink-900 tabular-nums"
                      >
                        {fmtNum(r.resolvedValue)}{" "}
                        <span className="text-xs font-normal text-ink-500">
                          {r.kpiDefinition.unit}
                        </span>
                      </td>
                      <td data-label="Theo nguồn">
                        <Badge tone="slate">{srcLabel}</Badge>
                      </td>
                      <td data-label="Người chốt" className="text-ink-600">
                        {r.resolvedBy?.fullName ?? "—"}
                        <div className="text-xs text-ink-500">
                          {fmtDateTime(r.resolvedAt)}
                        </div>
                      </td>
                      <td data-label="Lý do" className="max-w-xs text-xs text-ink-600">
                        {r.resolveReason}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ShowingCount
            shown={resolved.length}
            total={resolvedCount}
            hint="các lần chốt gần nhất; đầy đủ trong Nhật ký hệ thống"
          />
        </section>
      )}
    </>
  );
}

function safeSources(json: string): SourceRow[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
