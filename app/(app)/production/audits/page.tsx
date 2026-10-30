import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleCheck, Lock } from "lucide-react";
import { requireSession } from "@/lib/auth";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  canExplainAudit,
  canOpenAuditPortal,
  withProductionRole,
} from "@/lib/services/production-service";
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
} from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/format";
import AuditActions from "./audit-actions";

export const dynamic = "force-dynamic";

export default async function AuditsPage() {
  const base = (await requireSession())!;
  const user = await withProductionRole(base);

  // Cùng điều kiện với mọi liên kết dẫn tới trang này (canOpenAuditPortal)
  if (!canOpenAuditPortal(user)) redirect("/production");

  /* Mỗi nhóm một truy vấn riêng, có count() riêng.
     Trước đây gộp một truy vấn sắp theo `status asc` + take 60: status là chuỗi
     nên sắp theo bảng chữ cái (CEO_APPROVED, EXPLAINED, PENDING_EXPLANATION,
     REJECTED) → khi nhiều cảnh báo, cảnh báo ĐÃ XỬ LÝ chiếm hết 60 chỗ và cảnh
     báo ĐANG CHỜ biến mất khỏi màn hình; thẻ thống kê cũng đếm trên mảng đã cắt.
     Giờ: việc đang treo lên trước, đã xong chỉ lấy một phần và ghi rõ X/N. */
  const include = {
    shiftLog: {
      include: {
        sku: true,
        createdBy: true,
        kpiResults: true,
        participants: { select: { userId: true } },
      },
    },
    explainedBy: true,
    reviewedBy: true,
  } satisfies Prisma.AntiGamingAuditInclude;

  const OPEN_TAKE = 100;
  const DONE_TAKE = 30;
  const DONE_STATUSES = ["CEO_APPROVED", "REJECTED"];

  const [
    pending,
    pendingTotal,
    explained,
    explainedTotal,
    done,
    doneTotal,
    lockedPeople,
  ] = await Promise.all([
    // Chờ giải trình: nghiêm trọng trước (CRITICAL < WARNING theo chữ cái),
    // rồi cái chờ lâu nhất trước — người bị khoá thưởng lâu nhất được xử lý trước.
    prisma.antiGamingAudit.findMany({
      where: { status: "PENDING_EXPLANATION" },
      include,
      orderBy: [{ severity: "asc" }, { createdAt: "asc" }],
      take: OPEN_TAKE,
    }),
    prisma.antiGamingAudit.count({ where: { status: "PENDING_EXPLANATION" } }),
    prisma.antiGamingAudit.findMany({
      where: { status: "EXPLAINED" },
      include,
      orderBy: [{ severity: "asc" }, { explainedAt: "asc" }],
      take: OPEN_TAKE,
    }),
    prisma.antiGamingAudit.count({ where: { status: "EXPLAINED" } }),
    prisma.antiGamingAudit.findMany({
      where: { status: { in: DONE_STATUSES } },
      include,
      orderBy: [{ reviewedAt: "desc" }, { createdAt: "desc" }],
      take: DONE_TAKE,
    }),
    prisma.antiGamingAudit.count({ where: { status: { in: DONE_STATUSES } } }),
    prisma.dailyKpiResult.count({ where: { isBonusLocked: true } }),
  ]);

  const totalAll = pendingTotal + explainedTotal + doneTotal;
  const isCeo = user.role === "CEO";

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
          value={pendingTotal}
          tone={pendingTotal > 0 ? "amber" : "slate"}
          hint="quản đốc cần vào nói rõ"
        />
        <StatCard
          label="Chờ BGĐ quyết"
          value={explainedTotal}
          tone="slate"
          hint="đã có giải trình"
        />
        <StatCard
          label="Người đang khoá thưởng"
          value={lockedPeople}
          tone={lockedPeople > 0 ? "red" : "slate"}
          surface={lockedPeople > 0 ? "red" : undefined}
          hint={lockedPeople > 0 ? "chưa nhận được thưởng ca" : "không ai bị khoá"}
        />
        <StatCard label="Đã xử lý xong" value={doneTotal} hint="từ trước tới nay" />
      </div>

      {totalAll === 0 ? (
        <EmptyState
          icon={<CircleCheck size={32} strokeWidth={1.75} />}
          title="Không có cảnh báo nào"
          hint="Hệ thống quét ba dấu hiệu: chạy sản lượng mà phá nguyên liệu, giấu phế phẩm sang mục làm lại, và lệch cân đối khối lượng."
        />
      ) : (
        <div className="space-y-4">
          {[
            {
              key: "pending",
              title: `Chờ giải trình (${pendingTotal})`,
              list: pending,
              total: pendingTotal,
            },
            {
              key: "explained",
              title: `Chờ Ban Giám đốc quyết (${explainedTotal})`,
              list: explained,
              total: explainedTotal,
            },
            {
              key: "done",
              title: `Đã xử lý (${doneTotal})`,
              list: done,
              total: doneTotal,
            },
          ]
            .filter((g) => g.list.length > 0)
            .map((g) => (
              <section key={g.key}>
                <h2 className="section-title mb-3">{g.title}</h2>
                {g.list.length < g.total && (
                  <p className="mb-2 text-xs text-ink-500">
                    Đang hiển thị {g.list.length}/{g.total}
                    {g.key === "done"
                      ? " — các cảnh báo xử lý gần nhất."
                      : " — nghiêm trọng và chờ lâu nhất lên trước."}
                  </p>
                )}
                <div className="space-y-3">
                  {g.list.map((a) => {
                    const lockedCount = a.shiftLog.kpiResults.filter(
                      (r) => r.isBonusLocked
                    ).length;
                    // Đã xử lý xong thì không còn là ngoại lệ — thẻ trung tính
                    const resolved =
                      a.status === "CEO_APPROVED" || a.status === "REJECTED";
                    return (
                      <div
                        key={a.id}
                        className={`card overflow-hidden ${
                          resolved
                            ? ""
                            : a.severity === "CRITICAL"
                              ? "border-red-200"
                              : "border-amber-200"
                        }`}
                      >
                        {/* --- đầu thẻ --- */}
                        <div
                          className={`flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3 ${
                            resolved
                              ? "border-ink-100"
                              : a.severity === "CRITICAL"
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
                              {fmtDate(a.shiftLog.shiftDate)} ·{" "}
                              <span className="font-mono">{a.shiftLog.sku.skuCode}</span> —{" "}
                              {a.shiftLog.sku.skuName}
                              {" · khai bởi "}
                              {a.shiftLog.createdBy.fullName}
                            </div>
                          </div>
                          <div className="text-right">
                            <Badge tone="slate">
                              {AUDIT_STATUS_LABEL[a.status] ?? a.status}
                            </Badge>
                            {lockedCount > 0 && (
                              <div className="mt-1 flex items-center gap-1 text-xs font-medium text-red-700">
                                <Lock size={12} strokeWidth={2.5} /> {lockedCount} người đang khoá thưởng
                              </div>
                            )}
                          </div>
                        </div>

                        {/* --- thân thẻ --- */}
                        <div className="space-y-3 p-4">
                          <div className="rounded-md bg-ink-50 px-3 py-2 text-sm text-ink-700">
                            {a.auditNote}
                          </div>

                          {a.explanationText && (
                            <div className="border-l-2 border-ink-200 py-1 pl-3">
                              <div className="text-xs font-semibold text-ink-500">
                                Giải trình — {a.explainedBy?.fullName} ·{" "}
                                {fmtDateTime(a.explainedAt)}
                              </div>
                              <div className="mt-1 text-sm whitespace-pre-wrap text-ink-700">
                                {a.explanationText}
                              </div>
                            </div>
                          )}

                          {a.ceoReviewNote && (
                            <div
                              className={
                                a.status === "REJECTED"
                                  ? "rounded-md border border-red-200 bg-red-50 px-3 py-2"
                                  : "border-l-2 border-brand-500 py-1 pl-3"
                              }
                            >
                              <div className="text-xs font-semibold text-ink-500">
                                Ý kiến Ban Giám đốc — {a.reviewedBy?.fullName} ·{" "}
                                {fmtDateTime(a.reviewedAt)}
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
                            canExplain={canExplainAudit(user, {
                              createdById: a.shiftLog.createdById,
                              participantUserIds: a.shiftLog.participants.map(
                                (p) => p.userId
                              ),
                            })}
                            isCeo={isCeo}
                            explainedByMe={
                              !!a.explainedById && a.explainedById === user.id
                            }
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
