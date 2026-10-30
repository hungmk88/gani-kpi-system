"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, X } from "lucide-react";
import ConfirmDialog from "@/components/confirm-dialog";
import { toast } from "@/components/toast";
import { Avatar, ScoreBadge } from "@/components/ui";
import { fmtNum, fmtPct, fmtScore } from "@/lib/format";
import { formatVnDate } from "@/lib/vn-time";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import type { GateState } from "@/lib/services/dashboard-service";
import type {
  KpiPayslip,
  QuickApproval,
  TeamMember,
} from "@/lib/services/dashboard-extras";

/**
 * CÁC KHỐI "GANI VIVID" CỦA TRANG CHỦ.
 *
 * Luật màu giữ nguyên hệ GANI: gradient chỉ ở MỘT khối "hôm nay" của trang;
 * trong các thẻ trắng, chỉ ngoại lệ (đỏ = trễ / trừ điểm, vàng = cần để ý)
 * mới có nền màu — trạng thái bình thường là chữ + chấm.
 */

/* ==================================================================== */
/* 1. KHỐI "HÔM NAY"                                                     */
/* ==================================================================== */

export type HeroAction = { href: string; label: string };

export function TodayHero({
  greeting,
  dateLine,
  gate,
  overdue,
  dueToday,
  approvals,
  actions,
  nowMs,
}: {
  nowMs: number;
  greeting: string;
  dateLine: string;
  gate: GateState | null;
  overdue: number;
  dueToday: number;
  approvals: number;
  actions: HeroAction[];
}) {
  const leg = gate?.openLeg ?? null;
  // Cửa KPI của chính mình còn dưới 3 ngày → vàng (ngoại lệ), còn lại trắng
  const urgent =
    !!leg &&
    gate!.isMyTurn &&
    new Date(leg.deadline).getTime() - nowMs < 72 * 3_600_000;

  return (
    <section className="vivid mb-6 p-5 sm:p-7" aria-label="Hôm nay">
      <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-stretch">
        <div className="flex min-w-0 flex-col">
          {gate && (
            <span className="glass mb-4 inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-xs font-medium">
              <span
                className={`h-2 w-2 rounded-full ${urgent ? "bg-amber-400" : "bg-leaf-500"}`}
                aria-hidden
              />
              Kỳ KPI {gate.periodName}
              {leg ? ` · ${leg.label}` : ""}
            </span>
          )}
          <h1 className="text-[26px] leading-tight font-bold tracking-tight sm:text-[32px]">
            {greeting}
          </h1>
          <p className="mt-1.5 text-sm text-white/80">{dateLine}</p>

          {/* Ngoại lệ hôm nay — chỉ việc trễ có nền đỏ */}
          <div className="mt-5 flex flex-wrap gap-2">
            {overdue > 0 && (
              <Link
                href="/tasks?filter=overdue"
                className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700"
              >
                {fmtNum(overdue)} việc trễ hạn <ChevronRight size={14} />
              </Link>
            )}
            {dueToday > 0 && (
              <Link
                href="/tasks"
                className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium hover:bg-white/15"
              >
                {fmtNum(dueToday)} việc tới hạn hôm nay
              </Link>
            )}
            {approvals > 0 && (
              <a
                href="#duyet-nhanh"
                className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium hover:bg-white/15"
              >
                {fmtNum(approvals)} đơn chờ bạn duyệt
              </a>
            )}
            {overdue === 0 && dueToday === 0 && approvals === 0 && (
              <span className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-white/90">
                <Check size={14} /> Không có việc trễ hay tới hạn hôm nay
              </span>
            )}
          </div>

          {actions.length > 0 && (
            <div className="mt-auto flex flex-wrap gap-2 pt-6">
              {actions.map((a, i) => (
                <Link
                  key={a.href + a.label}
                  href={a.href}
                  className={
                    i === 0
                      ? "inline-flex min-h-11 items-center rounded-[10px] bg-white px-4 text-sm font-semibold text-brand-800 shadow-sm hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
                      : "glass inline-flex min-h-11 items-center px-4 text-sm font-semibold hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
                  }
                >
                  {a.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Nhịp kỳ KPI: còn bao lâu tới hạn của cửa đang mở */}
        {gate && (
          <div
            className="glass flex flex-col p-5"
            role="group"
            aria-label={`Nhịp kỳ KPI ${gate.periodName}`}
          >
            <div className="text-xs font-medium text-white/75">
              {leg
                ? gate.isMyTurn
                  ? "Hạn của bạn"
                  : `Hạn "${leg.label}"`
                : `Kỳ ${gate.periodName}`}
            </div>
            {leg ? (
              <>
                <div className="mt-1 text-[34px] leading-tight font-bold tabular-nums">
                  {gate.remaining && gate.remaining !== "đã đóng"
                    ? gate.remaining
                    : "hôm nay"}
                </div>
                <div className="mt-0.5 text-sm text-white/80">
                  đóng lúc 23:59 · {dayMonth(leg.deadline)}
                </div>
              </>
            ) : (
              <div className="mt-1 text-xl font-semibold">
                {gate.periodStatus === "FINALIZED"
                  ? "Đã chốt xong"
                  : "Chờ Ban Giám đốc chốt"}
              </div>
            )}
            <ol className="mt-auto grid grid-cols-3 gap-1.5 pt-5">
              {gate.legs.map((l) => (
                <li key={l.key}>
                  <div
                    className={`h-1.5 rounded-full ${
                      l.state === "now"
                        ? urgent
                          ? "bg-amber-400"
                          : "bg-white"
                        : l.state === "done"
                          ? "bg-white/45"
                          : "bg-white/15"
                    }`}
                  />
                  <div
                    className={`mt-1.5 text-xs leading-tight ${
                      l.state === "now"
                        ? "font-semibold text-white"
                        : "text-white/70"
                    }`}
                  >
                    {l.label}
                    <span className="block font-normal tabular-nums">
                      {dayMonth(l.deadline)}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}

/* ==================================================================== */
/* 2. DUYỆT NHANH                                                        */
/* ==================================================================== */

export function QuickApprovals({
  items,
  total,
}: {
  items: QuickApproval[];
  total: number;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<QuickApproval | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(
    null,
  );
  const [dialogError, setDialogError] = useState<string | null>(null);

  if (items.length === 0) return null;

  async function act(item: QuickApproval, approve: boolean, reason?: string) {
    setBusyId(item.id);
    setError(null);
    setDialogError(null);
    const url =
      item.kind === "LEAVE"
        ? `/api/leave-requests/${item.id}`
        : `/api/requests/${item.id}`;
    const body =
      item.kind === "LEAVE"
        ? { action: approve ? "APPROVE" : "REJECT", note: reason }
        : { action: approve ? "ACCEPT" : "REJECT", rejectReason: reason };
    try {
      const res = await fetchJson(url, jsonInit("PATCH", body));
      if (!res.ok) {
        const message = res.message || "Không xử lý được.";
        if (reason !== undefined) setDialogError(message);
        else setError({ id: item.id, message });
        return;
      }
      setRejecting(null);
      toast(
        item.kind === "LEAVE"
          ? `${approve ? "Đã duyệt" : "Đã từ chối"} đơn nghỉ của ${item.who}.`
          : `${approve ? "Đã tiếp nhận" : "Đã từ chối"} yêu cầu "${item.title}".`,
      );
      router.refresh();
    } catch {
      const message = "Mất kết nối tới máy chủ. Kiểm tra mạng rồi thử lại.";
      if (reason !== undefined) setDialogError(message);
      else setError({ id: item.id, message });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div id="duyet-nhanh" className="card scroll-mt-20 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="section-title">Duyệt nhanh</h2>
        <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
          {fmtNum(total)} chờ bạn
        </span>
      </div>
      <ul className="space-y-2.5">
        {items.map((it) => (
          <li
            key={it.kind + it.id}
            className="rounded-[12px] border border-ink-200/80 bg-ink-50/60 p-3"
          >
            <div className="flex items-start gap-3">
              <Avatar name={it.who} size={34} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-ink-900">
                    {it.who}
                  </span>
                  <span className="text-xs text-ink-500">
                    {it.kind === "LEAVE" ? "Nghỉ phép" : "Yêu cầu liên phòng"}
                  </span>
                  {it.urgent && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                      Gấp
                    </span>
                  )}
                </div>
                {it.kind === "REQUEST" && (
                  <div className="mt-0.5 line-clamp-2 text-sm text-ink-700">
                    {it.title}
                  </div>
                )}
                <div className="mt-0.5 text-xs text-ink-500 tabular-nums">
                  {it.detail}
                </div>
              </div>
            </div>
            {error?.id === it.id && (
              <div role="alert" className="mt-2 text-xs text-red-700">
                {error.message}
              </div>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                className="btn-primary btn-sm"
                disabled={busyId !== null}
                onClick={() => act(it, true)}
              >
                <Check size={14} />{" "}
                {it.kind === "LEAVE" ? "Duyệt" : "Tiếp nhận"}
              </button>
              <button
                className="btn-ghost btn-sm"
                disabled={busyId !== null}
                onClick={() => {
                  setDialogError(null);
                  setRejecting(it);
                }}
              >
                <X size={14} /> Từ chối
              </button>
            </div>
          </li>
        ))}
      </ul>
      {total > items.length && (
        <div className="mt-3 flex gap-4 text-xs font-medium">
          <Link
            href="/leave-requests"
            className="text-brand-700 hover:underline"
          >
            Tất cả đơn nghỉ →
          </Link>
          <Link href="/requests" className="text-brand-700 hover:underline">
            Tất cả yêu cầu →
          </Link>
        </div>
      )}

      <ConfirmDialog
        open={rejecting !== null}
        busy={busyId !== null}
        tone="danger"
        title={
          rejecting?.kind === "LEAVE"
            ? `Từ chối đơn nghỉ của ${rejecting.who}?`
            : `Từ chối yêu cầu của ${rejecting?.who ?? ""}?`
        }
        confirmLabel="Từ chối"
        reason={{
          label: "Lý do (người gửi sẽ nhận được)",
          placeholder:
            "Vd: trùng lịch giao hàng cuối tháng, đề nghị dời sang tuần sau",
          minLength: 5,
        }}
        error={dialogError}
        onClose={() => setRejecting(null)}
        onConfirm={(reason) => rejecting && act(rejecting, false, reason)}
      >
        {rejecting && (
          <p>
            {rejecting.kind === "REQUEST" ? `"${rejecting.title}" · ` : ""}
            {rejecting.detail}
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}

/* ==================================================================== */
/* 3. PHÒNG CỦA TÔI                                                      */
/* ==================================================================== */

const TEAM_LIMIT = 8;

export function MyTeamPanel({
  team,
}: {
  team: {
    departmentName: string;
    members: TeamMember[];
    present: number;
    detailed: boolean;
  };
}) {
  const shown = team.members.slice(0, TEAM_LIMIT);
  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="section-title truncate">Phòng {team.departmentName}</h2>
        <span className="shrink-0 rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-semibold text-ink-700 tabular-nums">
          {team.present}/{team.members.length} có mặt
        </span>
      </div>
      <ul className="divide-y divide-ink-100">
        {shown.map((m) => (
          <li
            key={m.id}
            className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
          >
            <Avatar name={m.name} size={34} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink-900">
                {m.name}
                {m.isMe && (
                  <span className="ml-1 font-normal text-ink-500">· bạn</span>
                )}
              </div>
              {m.jobTitle && (
                <div className="truncate text-xs text-ink-500">
                  {m.jobTitle}
                </div>
              )}
            </div>
            <TeamStatus m={m} />
          </li>
        ))}
      </ul>
      {team.members.length > shown.length && (
        <div className="mt-2 text-xs text-ink-500">
          … và {team.members.length - shown.length} người khác
        </div>
      )}
      {team.detailed && (
        <Link
          href="/tasks"
          className="mt-3 inline-block text-xs font-medium text-brand-700 hover:underline"
        >
          Xem việc của phòng →
        </Link>
      )}
    </div>
  );
}

function TeamStatus({ m }: { m: TeamMember }) {
  if (m.status === "OVERDUE") {
    return (
      <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
        {m.label}
      </span>
    );
  }
  if (m.status === "BLOCKED") {
    return (
      <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
        {m.label}
      </span>
    );
  }
  if (m.status === "LEAVE") {
    return (
      <span className="shrink-0 rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-700">
        {m.label}
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-600">
      <span
        className={`h-1.5 w-1.5 rounded-full ${m.status === "WORKING" ? "bg-leaf-500" : "bg-ink-300"}`}
        aria-hidden
      />
      {m.label}
    </span>
  );
}

/* ==================================================================== */
/* 4. PHIẾU ĐIỂM KPI                                                     */
/* ==================================================================== */

export function KpiPayslipCard({
  periodName,
  payslip,
  scoreState,
  draftCount,
  selfReviewDeadline,
}: {
  periodName: string;
  payslip: KpiPayslip;
  scoreState: "UNSCORED" | "PROVISIONAL" | "FINAL";
  draftCount: number;
  selfReviewDeadline: Date;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-start justify-between gap-2 p-4 pb-3">
        <div>
          <h2 className="section-title">Phiếu điểm KPI</h2>
          <div className="text-xs text-ink-500">{periodName}</div>
        </div>
        <ScoreBadge score={payslip.total} state={scoreState} />
      </div>

      {draftCount > 0 && (
        <div className="mx-4 mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Còn <b>{draftCount}</b> chỉ tiêu chưa tự khai — hạn 23:59 ngày{" "}
          {dayMonth(selfReviewDeadline)}.
        </div>
      )}

      <div className="px-4">
        <div className="mb-1 text-xs font-semibold text-leaf-700">
          Phần cộng
        </div>
        <ul className="divide-y divide-dashed divide-ink-200">
          {payslip.earned.map((l) => (
            <li
              key={l.id}
              className="flex items-start justify-between gap-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-ink-800">{l.name}</div>
                <div className="text-xs text-ink-500 tabular-nums">
                  trọng số {fmtNum(l.weight)}% ·{" "}
                  {l.achievement === null
                    ? "chưa có số"
                    : `đạt ${fmtPct(l.achievement)}`}
                  {l.capped && ` · chạm trần ${fmtNum(l.cap)}%`}
                </div>
              </div>
              <span className="shrink-0 font-mono text-sm text-ink-800 tabular-nums">
                {l.achievement === null ? "—" : fmtScore(l.score)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-1 flex justify-between rounded-md bg-leaf-50 px-3 py-2 text-sm font-semibold text-leaf-800">
          <span>Tổng phần cộng</span>
          <span className="font-mono tabular-nums">
            {fmtScore(payslip.earnedTotal)}
          </span>
        </div>

        {payslip.deductions.length > 0 && (
          <>
            <div className="mt-3 mb-1 text-xs font-semibold text-red-700">
              Phần trừ
            </div>
            <ul className="divide-y divide-dashed divide-ink-200">
              {payslip.deductions.map((l) => (
                <li
                  key={l.id}
                  className="flex items-start justify-between gap-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-ink-800">
                      {l.name}
                    </div>
                    <div className="text-xs text-ink-500">
                      Ngưỡng ≤{fmtNum(l.gatekeeper!.thresholdPercent)}% · trừ{" "}
                      {fmtNum(l.gatekeeper!.penaltyPoints)} điểm
                      {l.gatekeeper!.outcome === "PASS" && (
                        <span className="text-leaf-700"> · Đạt ngưỡng</span>
                      )}
                      {l.gatekeeper!.outcome === "NO_DATA" && " · chưa có số"}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 font-mono text-sm tabular-nums ${
                      l.score < 0
                        ? "font-semibold text-red-700"
                        : "text-ink-500"
                    }`}
                  >
                    {l.score < 0 ? `−${fmtScore(-l.score)}` : "0,00"}
                  </span>
                </li>
              ))}
            </ul>
            <div
              className={`mt-1 flex justify-between rounded-md px-3 py-2 text-sm font-semibold ${
                payslip.deductionTotal < 0
                  ? "bg-red-50 text-red-700"
                  : "bg-ink-50 text-ink-600"
              }`}
            >
              <span>Tổng phần trừ</span>
              <span className="font-mono tabular-nums">
                {payslip.deductionTotal < 0
                  ? `−${fmtScore(-payslip.deductionTotal)}`
                  : "0,00"}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between bg-brand-800 px-4 py-3 text-white">
        <span className="text-sm font-semibold">
          Tổng điểm
          <span className="ml-1.5 text-xs font-normal text-white/75">
            {scoreState === "FINAL"
              ? "chính thức"
              : scoreState === "PROVISIONAL"
                ? "tạm tính"
                : // Chưa ai tự khai: chỉ là điểm DỰ KIẾN theo số hệ thống
                  "dự kiến theo số hệ thống"}
          </span>
        </span>
        <span className="font-mono text-xl font-bold tabular-nums">
          {fmtScore(payslip.total)}
        </span>
      </div>
      <Link
        href="/kpi"
        className="block border-t border-ink-100 px-4 py-2.5 text-center text-xs font-medium text-brand-700 hover:bg-brand-50"
      >
        Mở bảng KPI đầy đủ →
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------ tiện ích */

/** "02/11" theo giờ VN — đúng cả ở máy chủ (UTC) lẫn trình duyệt */
function dayMonth(d: Date) {
  return formatVnDate(d).slice(0, 5);
}
