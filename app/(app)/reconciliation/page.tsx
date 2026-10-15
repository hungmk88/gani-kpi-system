import { redirect } from "next/navigation";
import { CircleCheck } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DATA_MISMATCH_THRESHOLD_PERCENT } from "@/lib/constants";
import {
  Badge,
  EmptyState,
  PageHeader,
  StatCard,
  formatDateTime,
} from "@/components/ui";
import ResolvePanel, { type SourceRow } from "./resolve-panel";

export const dynamic = "force-dynamic";

export default async function ReconciliationPage() {
  const user = (await requireSession())!;
  if (user.role !== "CEO" && user.role !== "MANAGER") redirect("/dashboard");

  const scope =
    user.role === "MANAGER"
      ? { employee: { departmentId: user.departmentId ?? "__none__" } }
      : {};

  const [mismatches, resolved, matchedCount] = await Promise.all([
    prisma.reconciliation.findMany({
      where: { status: "MISMATCH", ...scope },
      include: {
        employee: { include: { department: true } },
        kpiDefinition: true,
        period: true,
      },
      orderBy: { variancePercent: "desc" },
    }),
    prisma.reconciliation.findMany({
      where: { status: "RESOLVED", ...scope },
      include: {
        employee: true,
        kpiDefinition: true,
        resolvedBy: true,
        period: true,
      },
      orderBy: { resolvedAt: "desc" },
      take: 20,
    }),
    prisma.reconciliation.count({ where: { status: "MATCHED", ...scope } }),
  ]);

  const worst = mismatches[0]?.variancePercent ?? 0;

  return (
    <>
      <PageHeader
        title="Đối soát dữ liệu"
        subtitle={`Khi các nguồn số liệu đá nhau quá ${DATA_MISMATCH_THRESHOLD_PERCENT}%, hệ thống KHÔNG tự chọn con số nào. Nó treo lại ở đây chờ người quyết, và ghi tên người quyết vào nhật ký.`}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Đang treo chờ quyết"
          value={mismatches.length}
          tone={mismatches.length > 0 ? "red" : "green"}
          hint={
            mismatches.length > 0
              ? "chưa có số để chấm điểm"
              : "không có ô nào treo"
          }
        />
        <StatCard
          label="Mức lệch cao nhất"
          value={worst > 0 ? `${worst}%` : "—"}
          tone={worst > 20 ? "red" : worst > 0 ? "amber" : "green"}
          hint={`ngưỡng cảnh báo ${DATA_MISMATCH_THRESHOLD_PERCENT}%`}
        />
        <StatCard
          label="Các nguồn khớp nhau"
          value={matchedCount}
          tone="green"
          hint="đã tự đồng bộ, không cần ai đụng vào"
        />
        <StatCard
          label="Đã có người chốt"
          value={resolved.length}
          tone="slate"
          hint="20 lần gần nhất"
        />
      </div>

      <section className="mb-8">
        <h2 className="section-title mb-3">
          Cần bạn quyết ({mismatches.length})
        </h2>

        {mismatches.length === 0 ? (
          <EmptyState
            icon={<CircleCheck size={32} strokeWidth={1.75} />}
            title="Các nguồn số liệu đang khớp nhau"
            hint="Khi iPOS, file Excel và số nhân viên tự khai lệch nhau quá 5%, ô đó sẽ hiện ở đây."
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
                        {m.employee.department?.name ?? "—"} · Kỳ{" "}
                        {m.period.name} · Đơn vị {m.kpiDefinition.unit} · Treo
                        từ {formatDateTime(m.createdAt)}
                      </div>
                    </div>
                    <Badge tone="red">Lệch {m.variancePercent}%</Badge>
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
            <table className="tbl">
              <thead>
                <tr>
                  <th>Nhân sự</th>
                  <th>Chỉ tiêu</th>
                  <th>Kỳ</th>
                  <th className="text-right">Số đã chốt</th>
                  <th>Theo nguồn</th>
                  <th>Người chốt</th>
                  <th>Lý do</th>
                </tr>
              </thead>
              <tbody>
                {resolved.map((r) => (
                  <tr key={r.id}>
                    <td className="text-ink-800">{r.employee.fullName}</td>
                    <td className="text-ink-700">{r.kpiDefinition.name}</td>
                    <td className="text-ink-600">{r.period.name}</td>
                    <td className="text-right font-medium text-ink-900">
                      {fmt(r.resolvedValue)}
                    </td>
                    <td>
                      <Badge tone="slate">{r.resolvedSource}</Badge>
                    </td>
                    <td className="text-ink-600">
                      {r.resolvedBy?.fullName ?? "—"}
                      <div className="text-xs text-ink-400">
                        {formatDateTime(r.resolvedAt)}
                      </div>
                    </td>
                    <td className="max-w-xs text-xs text-ink-600">
                      {r.resolveReason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(
    n
  );
}
