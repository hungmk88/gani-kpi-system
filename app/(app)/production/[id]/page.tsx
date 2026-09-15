import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock, BarChart3, Check } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  canSeeMoney,
  withProductionRole,
} from "@/lib/services/production-service";
import { computeShiftMetrics } from "@/lib/production/kpi-engine";
import {
  AUDIT_STATUS_LABEL,
  BEHAVIOR_LABEL,
  PRODUCTION_ROLE_LABEL,
  SHIFT_STATUS_LABEL,
  SHIFT_TYPE_LABEL,
  STAGE_LABEL,
  TIER1_WEIGHT,
  TIER2_WEIGHT,
} from "@/lib/production/constants";
import {
  Badge,
  PageHeader,
  ProgressBar,
  formatDate,
  formatDateTime,
} from "@/components/ui";
import ShiftActions from "./shift-actions";
import KpiScoreCalculator from "./kpi-score-calculator";
import KpiScoreDisplay from "./kpi-score-display";

export const dynamic = "force-dynamic";

export default async function ShiftDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const base = (await requireSession())!;
  const user = await withProductionRole(base);

  const log = await prisma.productionShiftLog.findUnique({
    where: { id },
    include: {
      sku: true,
      createdBy: true,
      qcOfficer: true,
      lockedBy: true,
      participants: { include: { user: true } },
      kpiResults: { include: { user: true } },
      kpiScore: {
        include: {
          calculatedBy: true,
          approvedBy: true,
        },
      },
      audits: {
        include: { explainedBy: true, reviewedBy: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!log) notFound();

  const isWide =
    user.role === "CEO" ||
    user.role === "ADMIN" ||
    ["SUPERVISOR", "QC_OFFICER", "PRODUCTION_DIRECTOR"].includes(
      user.productionRole ?? ""
    );
  const isParticipant = log.participants.some((p) => p.userId === user.id);

  if (!isWide && !isParticipant && log.createdById !== user.id) {
    return (
      <div className="card p-8 text-center">
        <div className="mb-2 flex justify-center text-ink-400">
          <Lock size={30} strokeWidth={1.75} />
        </div>
        <div className="font-medium text-ink-800">
          Bạn không tham gia ca này
        </div>
        <Link href="/production" className="btn-ghost mt-4">
          ← Về xưởng sản xuất
        </Link>
      </div>
    );
  }

  const showMoney = canSeeMoney(user);
  const metrics = computeShiftMetrics({
    rawOutputKg: log.rawOutputKg,
    qcPassedKg: log.qcPassedKg,
    reworkKg: log.reworkKg,
    scrapKg: log.scrapKg,
    haccpViolationCount: log.haccpViolationCount,
    totalLaborHours: log.totalLaborHours,
    downtimeHours: log.downtimeHours,
    targetOutputKg: log.targetOutputKg,
    rawMaterialInputKg: log.rawMaterialInputKg,
    stdMaterialNormKg: log.stdMaterialNormKg,
  });

  const visibleScores = log.kpiResults.filter(
    (r) => isWide || r.userId === user.id
  );

  return (
    <>
      <div className="mb-4">
        <Link
          href="/production"
          className="text-sm text-ink-500 hover:text-brand-600"
        >
          ← Xưởng sản xuất
        </Link>
      </div>

      <PageHeader
        title={`${SHIFT_TYPE_LABEL[log.shiftType] ?? log.shiftType} · ${formatDate(log.shiftDate)}`}
        subtitle={`${log.sku.skuCode} — ${log.sku.skuName}`}
        actions={
          <Badge
            tone={
              log.status === "LOCKED"
                ? "green"
                : log.status === "QC_APPROVED"
                  ? "violet"
                  : "amber"
            }
          >
            {SHIFT_STATUS_LABEL[log.status]}
          </Badge>
        }
      />

      {/* ---------------- Đường đi 3 bước ---------------- */}
      <div className="card mb-6 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Step
            n="1"
            title="Sản xuất khai"
            who={log.createdBy.fullName}
            when={formatDateTime(log.createdAt)}
            done
          />
          <Step
            n="2"
            title="KCS xác nhận"
            who={log.qcOfficer?.fullName ?? null}
            when={log.qcApprovedAt ? formatDateTime(log.qcApprovedAt) : null}
            done={log.status !== "DRAFT"}
            active={log.status === "DRAFT"}
          />
          <Step
            n="3"
            title="Ban Giám đốc khoá số"
            who={log.lockedBy?.fullName ?? null}
            when={log.lockedAt ? formatDateTime(log.lockedAt) : null}
            done={log.status === "LOCKED"}
            active={log.status === "QC_APPROVED"}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* ---------------- Số liệu ---------------- */}
          <div className="card p-5">
            <h2 className="section-title mb-3">Số liệu ca</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Sản lượng thô" value={`${log.rawOutputKg} kg`} />
              <Metric
                label="Thành phẩm đạt"
                value={log.status === "DRAFT" ? "chờ KCS" : `${log.qcPassedKg} kg`}
                tone="green"
              />
              <Metric
                label="Hàng làm lại"
                value={log.status === "DRAFT" ? "—" : `${log.reworkKg} kg`}
                tone={log.reworkKg > 0 ? "amber" : undefined}
              />
              <Metric
                label="Phế phẩm"
                value={log.status === "DRAFT" ? "—" : `${log.scrapKg} kg`}
                tone={log.scrapKg > 0 ? "red" : undefined}
              />
              <Metric
                label="Nguyên liệu kho cấp"
                value={`${log.rawMaterialInputKg} kg`}
              />
              <Metric
                label="Định mức nguyên liệu"
                value={
                  log.stdMaterialNormKg > 0
                    ? `${log.stdMaterialNormKg} kg`
                    : "chờ BGĐ chốt chỉ tiêu"
                }
              />
              <Metric label="Tổng giờ công" value={`${log.totalLaborHours} giờ`} />
              <Metric
                label="Vi phạm HACCP"
                value={log.status === "DRAFT" ? "—" : `${log.haccpViolationCount}`}
                tone={log.haccpViolationCount > 0 ? "red" : "green"}
              />
            </div>

            {log.status === "LOCKED" && (
              <div className="mt-4 border-t border-ink-100 pt-4">
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-500 uppercase">
                  Tỷ lệ hệ thống tính ra
                </h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Metric
                    label="Đạt chỉ tiêu"
                    value={pct(metrics.outputAchievementPercent)}
                  />
                  <Metric
                    label="Tỷ lệ thu hồi"
                    value={pct(metrics.yieldPercent)}
                  />
                  <Metric
                    label="Phế + làm lại"
                    value={pct(metrics.defectRatePercent)}
                    tone={
                      (metrics.defectRatePercent ?? 0) > 5 ? "red" : undefined
                    }
                  />
                  <Metric
                    label="Năng suất"
                    value={
                      metrics.kgPerLaborHour === null
                        ? "—"
                        : `${metrics.kgPerLaborHour} kg/giờ công`
                    }
                  />
                </div>
                <p className="mt-2 text-xs text-ink-500">
                  Cân đối khối lượng lệch {metrics.massBalanceDiffKg} kg ·
                  Nguyên liệu {metrics.materialOverrunKg > 0 ? "vượt" : "dưới"}{" "}
                  định mức {Math.abs(metrics.materialOverrunKg)} kg
                </p>
              </div>
            )}

            {log.draftNote && (
              <div className="mt-4 rounded-lg border border-ink-200 bg-ink-50/60 px-3 py-2 text-sm text-ink-600">
                <b>Ghi chú của ca:</b> {log.draftNote}
              </div>
            )}
            {log.qcNote && (
              <div className="mt-2 rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2 text-sm text-violet-800">
                <b>KCS ghi:</b> {log.qcNote}
              </div>
            )}
          </div>

          {/* ---------------- Tổn thất quy ra tiền ---------------- */}
          {showMoney && log.status === "LOCKED" && (
            <div className="card border-amber-200 bg-amber-50/40 p-5">
              <h2 className="section-title mb-1">
                Tổn thất quy ra tiền
                <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                  CHỈ BAN GIÁM ĐỐC XEM
                </span>
              </h2>
              <p className="mb-3 text-xs text-ink-500">
                Công nhân và tổ trưởng không nhìn thấy khối này.
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Metric
                  label="Tổn thất chất lượng"
                  value={money(log.qualityLossVnd)}
                  tone={log.qualityLossVnd > 0 ? "red" : "green"}
                />
                <Metric
                  label="Đơn giá quy đổi"
                  value={money(log.sku.unitPriceVnd) + "/kg"}
                />
                <Metric
                  label="Chênh lệch nguyên liệu"
                  value={money(
                    (log.rawMaterialInputKg - log.stdMaterialNormKg) *
                      log.sku.unitPriceVnd
                  )}
                />
              </div>
              {(log.targetOverrideReason || log.materialOverrideReason) && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  <b>Ban Giám đốc đã sửa khác chuẩn:</b>
                  {log.targetOverrideReason && (
                    <div className="mt-1">
                      Chỉ tiêu (chuẩn SKU {log.sku.targetOutputKg} kg →{" "}
                      {log.targetOutputKg} kg): {log.targetOverrideReason}
                    </div>
                  )}
                  {log.materialOverrideReason && (
                    <div className="mt-1">
                      Nguyên liệu: {log.materialOverrideReason}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ---------------- Cảnh báo ---------------- */}
          {log.audits.length > 0 && (
            <div>
              <h2 className="section-title mb-3">
                Cảnh báo chạy chỉ tiêu ({log.audits.length})
              </h2>
              <div className="space-y-2">
                {log.audits.map((a) => (
                  <div
                    key={a.id}
                    className={`card p-4 ${
                      a.severity === "CRITICAL"
                        ? "border-red-200 bg-red-50/40"
                        : "border-amber-200 bg-amber-50/40"
                    }`}
                  >
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <Badge tone={a.severity === "CRITICAL" ? "red" : "amber"}>
                        {a.severity === "CRITICAL" ? "Nghiêm trọng" : "Cảnh báo"}
                      </Badge>
                      <span className="font-medium text-ink-900">
                        {BEHAVIOR_LABEL[a.behaviorType] ?? a.behaviorType}
                      </span>
                      <Badge tone="slate">
                        {AUDIT_STATUS_LABEL[a.status] ?? a.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-ink-700">{a.auditNote}</p>
                    {a.explanationText && (
                      <div className="mt-2 rounded border border-ink-200 bg-white px-3 py-2 text-sm">
                        <div className="text-[11px] font-semibold text-ink-500">
                          GIẢI TRÌNH — {a.explainedBy?.fullName}
                        </div>
                        <div className="text-ink-700">{a.explanationText}</div>
                      </div>
                    )}
                    {a.ceoReviewNote && (
                      <div className="mt-2 rounded border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
                        <div className="text-[11px] font-semibold text-brand-700">
                          Ý KIẾN BAN GIÁM ĐỐC — {a.reviewedBy?.fullName}
                        </div>
                        <div className="text-ink-700">{a.ceoReviewNote}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <Link
                href="/production/audits"
                className="mt-2 inline-block text-xs text-brand-600 hover:underline"
              >
                Mở cổng xử lý cảnh báo →
              </Link>
            </div>
          )}

          {/* ---- Tính Điểm KPI 6 chỉ tiêu (PHASE 2) ---- */}
          {log.status === "LOCKED" && isWide && (
            <KpiScoreCalculator shiftLogId={log.id} />
          )}

          {/* ---- Hiển Thị Kết Quả KPI 6 chỉ tiêu ---- */}
          {log.kpiScore && (
            <div>
              <h2 className="section-title mb-3 flex items-center gap-1.5">
                <BarChart3 size={17} strokeWidth={2} /> Điểm KPI 6 chỉ tiêu (Phòng SX)
              </h2>
              <KpiScoreDisplay
                scoreId={log.kpiScore.id}
                status={log.kpiScore.status}
                totalScore={log.kpiScore.totalScore}
                bonusMultiplier={log.kpiScore.bonusMultiplier}
                bonusAmount={log.kpiScore.bonusAmount}
                breakdownJson={log.kpiScore.breakdownJson}
                calculatedBy={log.kpiScore.calculatedBy}
                calculatedAt={log.kpiScore.calculatedAt}
                approvedBy={log.kpiScore.approvedBy}
                approvedAt={log.kpiScore.approvedAt}
              />
            </div>
          )}

          {/* ---------------- Điểm KPI Cũ (2 tầng) ---------------- */}
          {visibleScores.length > 0 && (
            <div>
              <h2 className="section-title mb-3">
                Điểm KPI ca — 2 tầng ({Math.round(TIER1_WEIGHT * 100)}% cá nhân +{" "}
                {Math.round(TIER2_WEIGHT * 100)}% toàn xưởng)
              </h2>
              <div className="space-y-2">
                {visibleScores.map((r) => {
                  const bd = r.breakdownJson
                    ? JSON.parse(r.breakdownJson)
                    : null;
                  return (
                    <details key={r.id} className="card p-4">
                      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-ink-900">
                          {r.user.fullName}
                        </span>
                        <span className="flex items-center gap-2">
                          {r.isBonusLocked && (
                            <Badge tone="red">
                              <Lock size={10} strokeWidth={2.5} className="mr-1 inline -mt-0.5" />
                              Khoá thưởng
                            </Badge>
                          )}
                          <Badge tone="slate">
                            Cá nhân {r.tier1Score}
                          </Badge>
                          <Badge tone="slate">
                            Xưởng {r.tier2Score}
                          </Badge>
                          <Badge
                            tone={
                              r.finalWeightedScore >= 100
                                ? "green"
                                : r.finalWeightedScore >= 85
                                  ? "amber"
                                  : "red"
                            }
                          >
                            {r.finalWeightedScore} điểm
                          </Badge>
                        </span>
                      </summary>

                      {bd && (
                        <div className="mt-3 space-y-3 border-t border-ink-100 pt-3">
                          <div className="font-mono text-xs text-ink-500">
                            {bd.formula}
                          </div>
                          <Breakdown
                            title="Tầng 1 — cá nhân / công đoạn"
                            parts={bd.tier1.parts}
                          />
                          <Breakdown
                            title="Tầng 2 — toàn xưởng"
                            parts={bd.tier2.parts}
                          />
                        </div>
                      )}
                    </details>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ---------------- Cột thao tác ---------------- */}
        <div className="space-y-6">
          <ShiftActions
            shift={{
              id: log.id,
              status: log.status,
              rawOutputKg: log.rawOutputKg,
              rawMaterialInputKg: log.rawMaterialInputKg,
              qcPassedKg: log.qcPassedKg,
              reworkKg: log.reworkKg,
              scrapKg: log.scrapKg,
              haccpViolationCount: log.haccpViolationCount,
              createdById: log.createdById,
              skuStandardTargetKg: log.sku.targetOutputKg,
              skuLossRate: log.sku.stdMaterialLossRate,
              skuCode: log.sku.skuCode,
            }}
            participants={log.participants.map((p) => ({
              userId: p.userId,
              name: p.user.fullName,
              stage: p.stage,
              personalDefectKg: p.personalDefectKg,
              violationCount: p.violationCount,
            }))}
            viewer={{
              id: user.id,
              role: user.role,
              productionRole: user.productionRole ?? null,
            }}
          />

          <div className="card p-5">
            <h3 className="section-title mb-3">
              Người làm ca ({log.participants.length})
            </h3>
            <ul className="space-y-2">
              {log.participants.map((p) => (
                <li
                  key={p.id}
                  className="rounded-lg border border-ink-200 px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink-800">
                      {p.user.fullName}
                    </span>
                    <span className="text-xs text-ink-500">
                      {p.hoursWorked}/{p.scheduledHours} giờ
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-ink-500">
                    {STAGE_LABEL[p.stage] ?? p.stage}
                    {p.user.productionRole
                      ? ` · ${PRODUCTION_ROLE_LABEL[p.user.productionRole]}`
                      : ""}
                  </div>
                  {(p.personalDefectKg > 0 || p.violationCount > 0) && (
                    <div className="mt-1 text-xs text-amber-700">
                      {p.personalDefectKg > 0 &&
                        `Lỗi công đoạn ${p.personalDefectKg} kg`}
                      {p.personalDefectKg > 0 && p.violationCount > 0 && " · "}
                      {p.violationCount > 0 && `${p.violationCount} vi phạm`}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ mảnh nhỏ */

function Step({
  n,
  title,
  who,
  when,
  done,
  active,
}: {
  n: string;
  title: string;
  who: string | null;
  when: string | null;
  done?: boolean;
  active?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        active
          ? "border-brand-300 bg-brand-50"
          : done
            ? "border-emerald-200 bg-emerald-50/50"
            : "border-ink-200"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
            done
              ? "bg-emerald-500 text-white"
              : active
                ? "bg-brand-600 text-white"
                : "bg-ink-200 text-ink-600"
          }`}
        >
          {done ? <Check size={13} strokeWidth={3} /> : n}
        </span>
        <span className="text-sm font-medium text-ink-800">{title}</span>
      </div>
      <div className="mt-1 pl-8 text-xs text-ink-500">
        {who ? `${who}` : "chưa xử lý"}
        {when && <div>{when}</div>}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "green" | "red" | "amber";
}) {
  const color =
    tone === "green"
      ? "text-emerald-700"
      : tone === "red"
        ? "text-red-700"
        : tone === "amber"
          ? "text-amber-700"
          : "text-ink-900";
  return (
    <div className="rounded-lg border border-ink-200 px-3 py-2">
      <div className="text-[10px] font-semibold tracking-wide text-ink-500 uppercase">
        {label}
      </div>
      <div className={`mt-0.5 font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function Breakdown({
  title,
  parts,
}: {
  title: string;
  parts: {
    label: string;
    weight: number;
    componentScore: number;
    note: string;
  }[];
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold text-ink-600">{title}</div>
      <div className="space-y-2">
        {parts.map((p) => (
          <div key={p.label}>
            <div className="flex items-center justify-between text-xs">
              <span className="text-ink-700">
                {p.label}{" "}
                <span className="text-ink-400">({p.weight}%)</span>
              </span>
              <span className="font-medium text-ink-900">
                {p.componentScore}
              </span>
            </div>
            <div className="mt-1">
              <ProgressBar
                value={(p.componentScore / 150) * 100}
                tone={
                  p.componentScore >= 100
                    ? "green"
                    : p.componentScore >= 70
                      ? "amber"
                      : "red"
                }
              />
            </div>
            <div className="mt-0.5 text-[11px] text-ink-500">{p.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function pct(n: number | null) {
  return n === null ? "—" : `${n}%`;
}

function money(n: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(n)) + " ₫";
}
