import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { withProductionRole } from "@/lib/services/production-service";
import {
  AUDIT_STATUS_LABEL,
  BEHAVIOR_LABEL,
  SHIFT_TYPE_LABEL,
} from "@/lib/production/constants";
import {
  Badge,
  EmptyState,
  PageHeader,
  StatCard,
  formatDate,
  formatDateTime,
} from "@/components/ui";
import AuditActions from "./audit-actions";

export const dynamic = "force-dynamic";

export default async function AuditsPage() {
  const base = (await requireSession())!;
  const user = await withProductionRole(base);

  const allowed =
    user.role === "CEO" ||
    ["SUPERVISOR", "PRODUCTION_DIRECTOR", "TEAM_LEADER", "QC_OFFICER"].includes(
      user.productionRole ?? ""
    );
  if (!allowed) redirect("/production");

  const audits = await prisma.antiGamingAudit.findMany({
    include: {
      shiftLog: {
        include: {
          sku: true,
          createdBy: true,
          kpiResults: true,
        },
      },
      explainedBy: true,
      reviewedBy: true,
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 60,
  });

  const pending = audits.filter((a) => a.status === "PENDING_EXPLANATION");
  const explained = audits.filter((a) => a.status === "EXPLAINED");
  const done = audits.filter((a) =>
    ["CEO_APPROVED", "REJECTED"].includes(a.status)
  );

  const lockedPeople = await prisma.dailyKpiResult.count({
    where: { isBonusLocked: true },
  });

  const canExplain =
    user.role === "CEO" ||
    ["SUPERVISOR", "PRODUCTION_DIRECTOR", "TEAM_LEADER"].includes(
      user.productionRole ?? ""
    );

  return (
    <>
      <PageHeader
        title="Cảnh báo chạy chỉ tiêu"
        subtitle="Máy phát hiện dấu hiệu bất thường thì KHOÁ THƯỞNG tạm thời, không trừ điểm và không kết tội. Người có quyền giải trình, Ban Giám đốc quyết cuối."
        actions={
          <Link href="/production" className="btn-ghost">
            ← Xưởng sản xuất
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Chờ giải trình"
          value={pending.length}
          tone={pending.length > 0 ? "amber" : "green"}
          hint="quản đốc cần vào nói rõ"
        />
        <StatCard
          label="Chờ BGĐ quyết"
          value={explained.length}
          tone={explained.length > 0 ? "violet" : "green"}
          hint="đã có giải trình"
        />
        <StatCard
          label="Người đang khoá thưởng"
          value={lockedPeople}
          tone={lockedPeople > 0 ? "red" : "green"}
          hint={lockedPeople > 0 ? "chưa nhận được thưởng ca" : "không ai bị khoá"}
        />
        <StatCard label="Đã xử lý xong" value={done.length} hint="gần đây" />
      </div>

      {audits.length === 0 ? (
        <EmptyState
          icon="✅"
          title="Không có cảnh báo nào"
          hint="Hệ thống quét ba dấu hiệu: chạy sản lượng mà phá nguyên liệu, giấu phế phẩm sang mục làm lại, và lệch cân đối khối lượng."
        />
      ) : (
        <div className="space-y-4">
          {[
            { title: `Chờ giải trình (${pending.length})`, list: pending },
            { title: `Chờ Ban Giám đốc quyết (${explained.length})`, list: explained },
            { title: `Đã xử lý (${done.length})`, list: done },
          ]
            .filter((g) => g.list.length > 0)
            .map((g) => (
              <section key={g.title}>
                <h2 className="section-title mb-3">{g.title}</h2>
                <div className="space-y-3">
                  {g.list.map((a) => {
                    const lockedCount = a.shiftLog.kpiResults.filter(
                      (r) => r.isBonusLocked
                    ).length;
                    return (
                      <div
                        key={a.id}
                        className={`card overflow-hidden ${
                          a.severity === "CRITICAL"
                            ? "border-red-200"
                            : "border-amber-200"
                        }`}
                      >
                        {/* --- đầu thẻ --- */}
                        <div
                          className={`flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3 ${
                            a.severity === "CRITICAL"
                              ? "border-red-200 bg-red-50/60"
                              : "border-amber-200 bg-amber-50/60"
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge
                                tone={a.severity === "CRITICAL" ? "red" : "amber"}
                              >
                                {a.severity === "CRITICAL"
                                  ? "Nghiêm trọng"
                                  : "Cảnh báo"}
                              </Badge>
                              <span className="font-medium text-ink-900">
                                {BEHAVIOR_LABEL[a.behaviorType] ?? a.behaviorType}
                              </span>
                            </div>
                            <div className="mt-1 text-xs text-ink-600">
                              {SHIFT_TYPE_LABEL[a.shiftLog.shiftType]} ·{" "}
                              {formatDate(a.shiftLog.shiftDate)} ·{" "}
                              {a.shiftLog.sku.skuCode} — {a.shiftLog.sku.skuName}
                              {" · khai bởi "}
                              {a.shiftLog.createdBy.fullName}
                            </div>
                          </div>
                          <div className="text-right">
                            <Badge tone="slate">
                              {AUDIT_STATUS_LABEL[a.status] ?? a.status}
                            </Badge>
                            {lockedCount > 0 && (
                              <div className="mt-1 text-xs font-medium text-red-700">
                                🔒 {lockedCount} người đang khoá thưởng
                              </div>
                            )}
                          </div>
                        </div>

                        {/* --- thân thẻ --- */}
                        <div className="space-y-3 p-4">
                          <div className="rounded-lg border border-ink-200 bg-ink-50/60 px-3 py-2 text-sm text-ink-700">
                            {a.auditNote}
                          </div>

                          {a.explanationText && (
                            <div className="rounded-lg border border-ink-200 bg-white px-3 py-2">
                              <div className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
                                Giải trình — {a.explainedBy?.fullName} ·{" "}
                                {formatDateTime(a.explainedAt)}
                              </div>
                              <div className="mt-1 text-sm whitespace-pre-wrap text-ink-700">
                                {a.explanationText}
                              </div>
                            </div>
                          )}

                          {a.ceoReviewNote && (
                            <div
                              className={`rounded-lg border px-3 py-2 ${
                                a.status === "CEO_APPROVED"
                                  ? "border-emerald-200 bg-emerald-50"
                                  : "border-red-200 bg-red-50"
                              }`}
                            >
                              <div className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
                                Ý kiến Ban Giám đốc — {a.reviewedBy?.fullName} ·{" "}
                                {formatDateTime(a.reviewedAt)}
                              </div>
                              <div className="mt-1 text-sm text-ink-700">
                                {a.ceoReviewNote}
                              </div>
                            </div>
                          )}

                          <AuditActions
                            auditId={a.id}
                            shiftId={a.shiftLogId}
                            status={a.status}
                            canExplain={canExplain}
                            isCeo={user.role === "CEO"}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
        </div>
      )}
    </>
  );
}
