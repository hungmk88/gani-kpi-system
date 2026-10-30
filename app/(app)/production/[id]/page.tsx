import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock, Check, Pencil, Undo2 } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  CEO_QC_OVERRIDE_PREFIX,
  canOpenAuditPortal,
  canSeeMoney,
  extractCeoQcOverrideReason,
  canResubmitReturnedShift,
  redactAuditForViewer,
  withProductionRole,
} from "@/lib/services/production-service";
import { computeShiftMetrics } from "@/lib/production/kpi-engine";
import {
  AUDIT_STATUS_LABEL,
  BEHAVIOR_LABEL,
  PRODUCTION_ROLE_LABEL,
  SHIFT_TYPE_LABEL,
  STAGE_LABEL,
  TIER1_WEIGHT,
  TIER2_WEIGHT,
} from "@/lib/production/constants";
import {
  SHIFT_STAGE_LABEL,
  extractShiftReturn,
  isShiftReturned,
  shiftStage,
} from "@/lib/production/shift-flow";
import {
  fmtDate,
  fmtDateTime,
  fmtKg,
  fmtNum,
  fmtPct,
  fmtVnd,
} from "@/lib/format";
import { Badge, PageHeader, ProgressBar, fmtScore } from "@/components/ui";
import ShiftActions from "./shift-actions";

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
  // Người khai đã nghỉ thì tổ trưởng / quản đốc nhận thay việc sửa ca trả về
  const canResubmit = canResubmitReturnedShift(user, log.createdBy);
  // ...nên phải mở được ca đó dù không làm, không khai
  const takingOver = canResubmit && isShiftReturned(log);

  if (!isWide && !isParticipant && log.createdById !== user.id && !takingOver) {
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

  // Bước 2 do BGĐ vượt quyền KCS (lý do nằm ở dòng đầu qcNote)
  const qcOverridden = extractCeoQcOverrideReason(log.qcNote) !== null;
  // KCS trả ca về sản xuất sửa: ca vẫn DRAFT, người trả + lý do nằm trong qcNote
  const stage = shiftStage(log);
  const returnInfo = stage === "RETURNED" ? extractShiftReturn(log.qcNote) : null;

  const visibleScores = log.kpiResults.filter(
    (r) => isWide || r.userId === user.id
  );
  // Cùng một luật với API chi tiết ca: người làm ca thấy CÓ cảnh báo (vì sao
  // thưởng khoá) + giải trình của chính mình; nội dung cho cấp quản lý xưởng.
  const audits = log.audits.map((a) => redactAuditForViewer(a, user));
  const showAuditPortalLink = canOpenAuditPortal(user);

  return (
    <>
      <div className="mb-4">
        <Link
          href="/production"
          className="text-sm text-ink-500 hover:text-brand-700"
        >
          ← Xưởng sản xuất
        </Link>
      </div>

      <PageHeader
        title={`${SHIFT_TYPE_LABEL[log.shiftType] ?? log.shiftType} · ${fmtDate(log.shiftDate)}`}
        subtitle={`${log.sku.skuCode} — ${log.sku.skuName}`}
        actions={
          <Badge
            tone={
              stage === "LOCKED"
                ? "green"
                : stage === "QC_APPROVED"
                  ? "brand"
                  : stage === "RETURNED"
                    ? "amber"
                    : "slate"
            }
          >
            {SHIFT_STAGE_LABEL[stage]}
          </Badge>
        }
      />

      {/* ---------------- Đường đi 3 bước ----------------
          Ba thẻ đứng riêng (không lồng trong một thẻ lớn) */}
      <div className="mb-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <Step
            n="1"
            title={returnInfo ? "Sản xuất sửa lại" : "Sản xuất khai"}
            who={log.createdBy.fullName}
            when={returnInfo ? "đang chờ sửa và gửi lại" : fmtDateTime(log.createdAt)}
            done={!returnInfo}
            active={!!returnInfo}
          />
          <Step
            n="2"
            title="KCS xác nhận"
            who={
              returnInfo
                ? `${returnInfo.by} · đã trả về sản xuất`
                : log.qcOfficer
                  ? log.qcOfficer.fullName +
                    (qcOverridden ? " · BGĐ vượt quyền KCS" : "")
                  : null
            }
            when={log.qcApprovedAt ? fmtDateTime(log.qcApprovedAt) : null}
            done={log.status !== "DRAFT"}
            active={stage === "DRAFT"}
          />
          <Step
            n="3"
            title="Ban Giám đốc khoá số"
            who={log.lockedBy?.fullName ?? null}
            when={log.lockedAt ? fmtDateTime(log.lockedAt) : null}
            done={log.status === "LOCKED"}
            active={log.status === "QC_APPROVED"}
          />
        </div>
      </div>

      {/* Ca bị KCS trả về: nói rõ cần sửa gì ngay trên đầu — đây là việc
          đang chờ, không phải một dòng ghi chú lẫn trong số liệu. */}
      {returnInfo && (
        <div
          role="status"
          className="mb-6 flex flex-wrap items-start gap-3 rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <Undo2 size={18} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">
              {returnInfo.by} trả ca về sản xuất để sửa
            </div>
            <div className="mt-0.5 whitespace-pre-line">{returnInfo.reason}</div>
          </div>
          {canResubmit && (
            <Link
              href={`/production/${log.id}/edit`}
              className="btn-primary btn-sm inline-flex items-center gap-1.5"
            >
              <Pencil size={14} aria-hidden /> Sửa và gửi lại
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* ---------------- Số liệu ---------------- */}
          <div className="card p-5">
            <h2 className="section-title mb-3">Số liệu ca</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {/* Ca còn ở bước 1: các ô KCS chưa điền là chữ xám trung tính,
                  không tô xanh như thể đã đạt. */}
              <Metric label="Sản lượng thô" value={fmtKg(log.rawOutputKg)} />
              <Metric
                label="Thành phẩm đạt"
                value={log.status === "DRAFT" ? "chờ KCS" : fmtKg(log.qcPassedKg)}
                tone={log.status === "DRAFT" ? "muted" : undefined}
              />
              <Metric
                label="Hàng làm lại"
                value={log.status === "DRAFT" ? "—" : fmtKg(log.reworkKg)}
                tone={
                  log.status === "DRAFT"
                    ? "muted"
                    : log.reworkKg > 0
                      ? "amber"
                      : undefined
                }
              />
              <Metric
                label="Phế phẩm"
                value={log.status === "DRAFT" ? "—" : fmtKg(log.scrapKg)}
                tone={
                  log.status === "DRAFT"
                    ? "muted"
                    : log.scrapKg > 0
                      ? "red"
                      : undefined
                }
              />
              <Metric
                label="Nguyên liệu kho cấp"
                value={fmtKg(log.rawMaterialInputKg)}
              />
              <Metric
                label="Định mức nguyên liệu"
                value={
                  log.stdMaterialNormKg > 0
                    ? fmtKg(log.stdMaterialNormKg)
                    : "chờ BGĐ chốt chỉ tiêu"
                }
                tone={log.stdMaterialNormKg > 0 ? undefined : "muted"}
              />
              <Metric label="Tổng giờ công" value={`${fmtNum(log.totalLaborHours)} giờ`} />
              <Metric
                label="Vi phạm HACCP"
                value={log.status === "DRAFT" ? "—" : fmtNum(log.haccpViolationCount)}
                tone={
                  log.status === "DRAFT"
                    ? "muted"
                    : log.haccpViolationCount > 0
                      ? "red"
                      : undefined
                }
              />
            </div>

            {log.status === "LOCKED" && (
              <div className="mt-4 border-t border-ink-100 pt-4">
                <h3 className="mb-2 text-sm font-semibold text-ink-700">
                  Tỷ lệ hệ thống tính ra
                </h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Metric
                    label="Đạt chỉ tiêu"
                    value={fmtPct(metrics.outputAchievementPercent)}
                  />
                  <Metric
                    label="Tỷ lệ thu hồi"
                    value={fmtPct(metrics.yieldPercent)}
                  />
                  <Metric
                    label="Phế + làm lại"
                    value={fmtPct(metrics.defectRatePercent)}
                    tone={
                      (metrics.defectRatePercent ?? 0) > 5 ? "red" : undefined
                    }
                  />
                  <Metric
                    label="Năng suất"
                    value={
                      metrics.kgPerLaborHour === null
                        ? "—"
                        : `${fmtNum(metrics.kgPerLaborHour)} kg/giờ công`
                    }
                  />
                </div>
                <p className="mt-2 text-xs text-ink-500 tabular-nums">
                  Cân đối khối lượng lệch {fmtKg(metrics.massBalanceDiffKg)} ·
                  Nguyên liệu {metrics.materialOverrunKg > 0 ? "vượt" : "dưới"}{" "}
                  định mức {fmtKg(Math.abs(metrics.materialOverrunKg))}
                </p>
              </div>
            )}

            {log.draftNote && (
              <div className="mt-4 rounded-md bg-ink-50 px-3 py-2 text-sm text-ink-600">
                <b>Ghi chú của ca:</b> {log.draftNote}
              </div>
            )}
            {log.qcNote && !returnInfo && (
              <div className="mt-2 whitespace-pre-line rounded-md bg-ink-50 px-3 py-2 text-sm text-ink-700">
                <b>KCS ghi:</b> {log.qcNote}
              </div>
            )}
          </div>

          {/* ---------------- Tổn thất quy ra tiền ---------------- */}
          {showMoney && log.status === "LOCKED" && (
            <div className="card p-5">
              <h2 className="section-title mb-1">
                Tổn thất quy ra tiền
                <span className="ml-2 rounded bg-ink-100 px-1.5 py-0.5 align-middle text-xs font-medium text-ink-700">
                  Chỉ Ban Giám đốc xem
                </span>
              </h2>
              <p className="mb-3 text-xs text-ink-500">
                Công nhân và tổ trưởng không nhìn thấy khối này.
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Metric
                  label="Tổn thất chất lượng"
                  value={fmtVnd(log.qualityLossVnd)}
                  tone={log.qualityLossVnd > 0 ? "red" : undefined}
                />
                <Metric
                  label="Đơn giá quy đổi"
                  value={fmtVnd(log.sku.unitPriceVnd) + "/kg"}
                />
                <Metric
                  label="Chênh lệch nguyên liệu"
                  value={fmtVnd(
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
                      Chỉ tiêu (chuẩn SKU {fmtKg(log.sku.targetOutputKg)} →{" "}
                      {fmtKg(log.targetOutputKg)}): {log.targetOverrideReason}
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
          {audits.length > 0 && (
            <div>
              <h2 className="section-title mb-3">
                Cảnh báo chạy chỉ tiêu ({audits.length})
              </h2>
              <div className="space-y-2">
                {audits.map((a) => (
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
                    {a.detailed ? (
                      <p className="text-sm text-ink-700">{a.auditNote}</p>
                    ) : (
                      <p className="text-sm text-ink-600">
                        Hệ thống phát hiện dấu hiệu bất thường ở ca này — thưởng
                        ca tạm khoá cho tới khi quản đốc giải trình và Ban Giám
                        đốc xem xét.
                      </p>
                    )}
                    {a.explanationText && (
                      <div className="mt-2 rounded-md bg-white px-3 py-2 text-sm">
                        <div className="text-xs font-semibold text-ink-500">
                          Giải trình — {a.explainedBy?.fullName}
                        </div>
                        <div className="text-ink-700">{a.explanationText}</div>
                      </div>
                    )}
                    {a.ceoReviewNote && (
                      <div className="mt-2 rounded-md bg-white px-3 py-2 text-sm">
                        <div className="text-xs font-semibold text-brand-700">
                          Ý kiến Ban Giám đốc — {a.reviewedBy?.fullName}
                        </div>
                        <div className="text-ink-700">{a.ceoReviewNote}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {/* Chỉ hiện cho người trang cảnh báo cho vào — không thì bấm
                  vào lại bị đẩy về trang xưởng */}
              {showAuditPortalLink && (
                <Link
                  href="/production/audits"
                  className="mt-2 inline-block text-sm text-brand-700 hover:underline"
                >
                  Mở cổng xử lý cảnh báo →
                </Link>
              )}
            </div>
          )}

          {/* ---------------- Điểm KPI ca (2 tầng) ---------------- */}
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
                            Cá nhân {fmtScore(r.tier1Score)}
                          </Badge>
                          <Badge tone="slate">
                            Xưởng {fmtScore(r.tier2Score)}
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
                            {fmtScore(r.finalWeightedScore)} điểm
                          </Badge>
                        </span>
                      </summary>

                      {bd && (
                        <div className="mt-3 space-y-3 border-t border-ink-100 pt-3">
                          <div className="text-xs text-ink-500 tabular-nums">
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

        {/* ---------------- Cột thao tác ----------------
            Trên điện thoại cột này nằm SAU toàn bộ số liệu — KCS / BGĐ phải
            cuộn hết trang mới thấy nút. `contents` cho thẻ thao tác thành phần
            tử của lưới ngoài để `order-first` đưa nó lên đầu; từ lg trở lên
            cột hiển thị bình thường bên phải. */}
        <div className="contents lg:block lg:space-y-6">
          <div className="order-first lg:order-none">
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
                qcOfficerId: log.qcOfficerId,
                qcOverridden,
                returned: returnInfo,
                canResubmit,
                // Chỉ người được xem tiền mới nhận đơn giá (để ước tổn thất
                // trong hộp xác nhận khoá); người khác nhận null.
                unitPriceVnd: showMoney ? log.sku.unitPriceVnd : null,
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
              ceoQcOverridePrefix={CEO_QC_OVERRIDE_PREFIX}
            />
          </div>

          <div className="card p-5">
            <h3 className="section-title mb-3">
              Người làm ca ({log.participants.length})
            </h3>
            <ul className="divide-y divide-ink-100">
              {log.participants.map((p) => (
                <li key={p.id} className="py-2 text-sm first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink-800">
                      {p.user.fullName}
                    </span>
                    <span className="text-xs text-ink-500 tabular-nums">
                      {fmtNum(p.hoursWorked)}/{fmtNum(p.scheduledHours)} giờ
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-ink-500">
                    {STAGE_LABEL[p.stage] ?? p.stage}
                    {p.user.productionRole
                      ? ` · ${PRODUCTION_ROLE_LABEL[p.user.productionRole]}`
                      : ""}
                  </div>
                  {(p.personalDefectKg > 0 || p.violationCount > 0) && (
                    <div className="mt-1 text-xs text-amber-800">
                      {p.personalDefectKg > 0 &&
                        `Lỗi công đoạn ${fmtKg(p.personalDefectKg)}`}
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
      className={`card p-3 ${active ? "border-brand-500 ring-1 ring-brand-500" : ""}`}
      aria-current={active ? "step" : undefined}
    >
      <div className="flex items-center gap-2">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
            done
              ? "bg-leaf-600 text-white"
              : active
                ? "bg-brand-600 text-white"
                : "bg-ink-100 text-ink-600"
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
  /** muted = ô chưa có số (chờ bước sau) — chữ xám, không đậm */
  tone?: "red" | "amber" | "muted";
}) {
  const color =
    tone === "red"
      ? "font-semibold text-red-700"
      : tone === "amber"
        ? "font-semibold text-amber-800"
        : tone === "muted"
          ? "font-normal text-ink-500"
          : "font-semibold text-ink-900";
  return (
    <div className="rounded-md bg-ink-50 px-3 py-2">
      <div className="text-xs text-ink-500">{label}</div>
      <div className={`mt-0.5 tabular-nums ${color}`}>{value}</div>
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
                <span className="text-ink-500">({fmtPct(p.weight)})</span>
              </span>
              <span className="font-medium text-ink-900 tabular-nums">
                {fmtScore(p.componentScore)}
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
            <div className="mt-0.5 text-xs text-ink-500">{p.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
