"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Lock,
  LockOpen,
  Check,
  CircleCheck,
  Pencil,
  ShieldAlert,
  Undo2,
} from "lucide-react";
import { STAGE_LABEL } from "@/lib/production/constants";
import {
  MASS_GAP_MIN_REASON,
  MASS_GAP_REASON_KG,
  SHIFT_RETURN_MIN_REASON,
  massGapKg,
  needsMassGapReason,
} from "@/lib/production/shift-flow";
import { fmtKg, fmtNum, fmtPct, fmtVnd } from "@/lib/format";
import {
  computeQualityLoss,
  computeStdMaterialNorm,
} from "@/lib/production/kpi-engine";
import ConfirmDialog from "@/components/confirm-dialog";
import StickyActions from "@/components/sticky-actions";
import VnNumberInput from "@/components/vn-number-input";
import { toast } from "@/components/toast";

type Shift = {
  id: string;
  status: string;
  rawOutputKg: number;
  rawMaterialInputKg: number;
  qcPassedKg: number;
  reworkKg: number;
  scrapKg: number;
  haccpViolationCount: number;
  createdById: string;
  skuStandardTargetKg: number;
  skuLossRate: number;
  skuCode: string;
  /** Người làm bước 2 (KCS hoặc BGĐ vượt quyền) */
  qcOfficerId: string | null;
  /** Bước 2 do BGĐ vượt quyền KCS */
  qcOverridden: boolean;
  /** Đơn giá quy đổi — chỉ có khi người xem được xem tiền, còn lại null */
  unitPriceVnd: number | null;
  /** KCS đã trả ca về sản xuất sửa (ca vẫn DRAFT) — người trả + lý do */
  returned: { by: string; reason: string } | null;
};

type Participant = {
  userId: string;
  name: string;
  stage: string;
  personalDefectKg: number;
  violationCount: number;
};

const OVERRIDE_MIN_REASON = 10;

export default function ShiftActions({
  shift,
  participants,
  viewer,
  ceoQcOverridePrefix,
}: {
  shift: Shift;
  participants: Participant[];
  viewer: { id: string; role: string; productionRole: string | null };
  /** Tiền tố qcNote khi BGĐ vượt quyền KCS — lấy từ production-service */
  ceoQcOverridePrefix: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const isCeo = viewer.role === "CEO";
  const isQcOfficer = viewer.productionRole === "QC_OFFICER";
  // TÁCH BẠCH TRÁCH NHIỆM: Ban Giám đốc KHÔNG phải KCS. Muốn làm thay bước 2
  // thì phải vượt quyền có ghi lý do (máy chủ kiểm tra lại). Người khai ca
  // không tự xác nhận ca của mình — kể cả BGĐ.
  const isCreator = shift.createdById === viewer.id;

  async function call(payload: unknown) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/production/shifts/${shift.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Thao tác thất bại.");
        return null;
      }
      router.refresh();
      return data;
    } catch {
      setError("Mất kết nối tới máy chủ.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <h3 className="section-title mb-3">Thao tác</h3>

      {error && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="mb-3 flex items-start gap-1.5 text-sm text-leaf-700">
          <CircleCheck size={16} strokeWidth={2} className="mt-0.5 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {/* Ca bị KCS trả về: việc nằm ở phía người khai, không ai xác nhận
          được cho tới khi gửi lại. */}
      {shift.status === "DRAFT" &&
        shift.returned &&
        (isCreator ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-700">
              KCS đã trả ca này về cho bạn sửa. Sửa số liệu theo lý do ở trên rồi
              gửi lại — ca sẽ quay về chờ KCS xác nhận.
            </p>
            <Link
              href={`/production/${shift.id}/edit`}
              className="btn-primary inline-flex w-full items-center justify-center gap-1.5"
            >
              <Pencil size={15} strokeWidth={2} aria-hidden /> Sửa và gửi lại KCS
            </Link>
          </div>
        ) : (
          <div className="text-sm text-ink-500">
            Ca đã được trả về cho người khai sửa. Khi họ gửi lại, ca quay về chờ
            KCS xác nhận.
          </div>
        ))}

      {shift.status === "DRAFT" &&
        !shift.returned &&
        (isCreator && (isQcOfficer || isCeo) ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Bạn là người khai ca này nên không được tự xác nhận phẩm chất. Phải
            là một KCS khác vào duyệt — đó là lý do có bước 2.
          </div>
        ) : isQcOfficer ? (
          <QcForm
            shift={shift}
            participants={participants}
            busy={busy}
            error={error}
            onCall={call}
          />
        ) : isCeo ? (
          <CeoQcOverride
            shift={shift}
            participants={participants}
            busy={busy}
            error={error}
            onCall={call}
            prefix={ceoQcOverridePrefix}
          />
        ) : (
          <div className="text-sm text-ink-500">
            Đang chờ KCS vào xác nhận phẩm chất. Bạn không có vai trò KCS.
          </div>
        ))}

      {shift.status === "QC_APPROVED" &&
        (isCeo ? (
          <CeoLockForm
            shift={shift}
            participantsCount={participants.length}
            selfOverridden={shift.qcOverridden && shift.qcOfficerId === viewer.id}
            busy={busy}
            error={error}
            onCall={async (p) => {
              const d = await call(p);
              if (d) {
                toast("Đã khoá số và chấm điểm ca.");
                setMessage(
                  `Đã khoá số. Điểm toàn xưởng ${fmtNum(d.tier2Score)}, chấm cho ${fmtNum(d.scored)} người.` +
                    (d.findings?.length
                      ? ` Phát hiện ${d.findings.length} cảnh báo — thưởng đang tạm khoá.`
                      : "")
                );
              }
              return d;
            }}
          />
        ) : (
          <div className="text-sm text-ink-500">
            KCS đã xác nhận. Đang chờ Ban Giám đốc chốt chỉ tiêu và khoá số.
          </div>
        ))}

      {shift.status === "LOCKED" && (
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-leaf-700">
            <Lock size={16} strokeWidth={2} /> Ca đã khoá số và chấm điểm xong.
          </div>
          {isCeo && (
            <ReopenForm
              busy={busy}
              error={error}
              participantsCount={participants.length}
              onCall={call}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ BƯỚC 2: KCS */

function QcForm({
  shift,
  participants,
  busy,
  error,
  onCall,
  override,
}: {
  shift: Shift;
  participants: Participant[];
  busy: boolean;
  error: string | null;
  onCall: (p: unknown) => Promise<unknown>;
  /** BGĐ vượt quyền KCS: bắt buộc lý do, lý do thành dòng đầu của qcNote */
  override?: { prefix: string };
}) {
  const [qcPassedKg, setQcPassedKg] = useState<number | null>(null);
  const [reworkKg, setReworkKg] = useState<number | null>(0);
  const [scrapKg, setScrapKg] = useState<number | null>(0);
  const [haccp, setHaccp] = useState<number | null>(0);
  // Ô nào đang gõ sai (chữ, số âm) — chặn gửi thay vì lặng lẽ coi là 0
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const [qcNote, setQcNote] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [gapReason, setGapReason] = useState("");
  const [returnOpen, setReturnOpen] = useState(false);
  // Ô lỗi cá nhân để trống (placeholder "0") — trước đây điền sẵn "0" nên
  // placeholder không bao giờ hiện và người nhập không biết ô nào là ô nào.
  const [defects, setDefects] = useState<
    Record<string, { d: number | null; v: number | null }>
  >(Object.fromEntries(participants.map((p) => [p.userId, { d: null, v: null }])));

  const mark = (key: string) => (bad: boolean) =>
    setInvalid((m) => (m[key] === bad ? m : { ...m, [key]: bad }));
  const anyInvalid = Object.values(invalid).some(Boolean);

  // Chỉ tính và báo lệch khi đã gõ số Đạt QC — form còn trống mà báo đỏ
  // "lệch N kg" là doạ người dùng vô cớ.
  const entered = qcPassedKg !== null;
  const parts = {
    qcPassedKg: qcPassedKg ?? 0,
    reworkKg: reworkKg ?? 0,
    scrapKg: scrapKg ?? 0,
  };
  const accounted = parts.qcPassedKg + parts.reworkKg + parts.scrapKg;
  const diff = massGapKg(shift.rawOutputKg, parts);
  const bigGap = entered && needsMassGapReason(diff);
  // Lệch lớn: ghi lý do (máy chủ cũng chặn) — thay ô tick "tôi xác nhận" cũ
  // vốn không để lại dấu vết gì.
  const gapReasonLen = gapReason.replace(/\s+/g, " ").trim().length;
  const gapOk = !bigGap || gapReasonLen >= MASS_GAP_MIN_REASON;

  const reasonLen = overrideReason.trim().length;
  const reasonOk = !override || reasonLen >= OVERRIDE_MIN_REASON;

  const canSubmit = !busy && entered && !anyInvalid && gapOk && reasonOk;
  const blockedHint = !entered
    ? "Nhập số kg Đạt QC để bật nút xác nhận."
    : anyInvalid
      ? "Có ô số chưa hợp lệ (đang tô đỏ) — sửa lại để bật nút."
      : !gapOk
        ? `Ghi lý do lệch ${fmtKg(Math.abs(diff), { unit: "kg" })} — còn thiếu ${MASS_GAP_MIN_REASON - gapReasonLen} ký tự.`
        : !reasonOk
          ? `Ghi lý do vượt quyền — còn thiếu ${OVERRIDE_MIN_REASON - reasonLen} ký tự.`
          : null;

  function setDefect(userId: string, key: "d" | "v", value: number | null) {
    setDefects((cur) => ({
      ...cur,
      [userId]: { ...(cur[userId] ?? { d: null, v: null }), [key]: value },
    }));
  }

  async function submit() {
    const note = qcNote.trim();
    // Vượt quyền: lý do gửi ở trường riêng; máy chủ tự ghép vào dòng đầu ghi
    // chú KCS ("[BGĐ vượt quyền KCS] <lý do>") và ghi vào nhật ký.
    const d = await onCall({
      action: "QC_APPROVE",
      qcPassedKg: parts.qcPassedKg,
      reworkKg: parts.reworkKg,
      scrapKg: parts.scrapKg,
      haccpViolationCount: haccp ?? 0,
      qcNote: note || undefined,
      ceoOverrideReason: override
        ? overrideReason.replace(/\s+/g, " ").trim()
        : undefined,
      massBalanceReason: bigGap ? gapReason.replace(/\s+/g, " ").trim() : undefined,
      participantDefects: participants.map((p) => ({
        userId: p.userId,
        personalDefectKg: defects[p.userId]?.d ?? 0,
        violationCount: defects[p.userId]?.v ?? 0,
      })),
    });
    if (d) toast("Đã xác nhận KCS — ca chuyển Ban Giám đốc khoá số.");
  }

  return (
    <div className="space-y-3">
      {override && (
        <div>
          <label className="label" htmlFor="qc-override-reason">
            Lý do vượt quyền KCS
          </label>
          <input
            id="qc-override-reason"
            className="input"
            placeholder="Ví dụ: KCS ca đêm nghỉ ốm, hàng phải xuất sáng nay"
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
          />
          <div className="mt-1 text-xs text-ink-500">
            {reasonLen}/{OVERRIDE_MIN_REASON} ký tự tối thiểu · ghi vào ghi chú
            KCS và nhật ký hệ thống
          </div>
        </div>
      )}

      <p className="text-xs text-ink-500">
        Sản xuất khai sản lượng thô{" "}
        <b>{fmtKg(shift.rawOutputKg, { unit: "kg" })}</b>. Phân loại cho đủ số đó.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="qc-passed">
            Đạt QC (kg)
          </label>
          <VnNumberInput
            id="qc-passed"
            min={0}
            value={qcPassedKg}
            placeholder="vd 1.000"
            onValue={(n, bad) => {
              setQcPassedKg(n);
              mark("passed")(bad);
            }}
          />
        </div>
        <div>
          <label className="label" htmlFor="qc-rework">
            Làm lại (kg)
          </label>
          <VnNumberInput
            id="qc-rework"
            min={0}
            value={reworkKg}
            placeholder="0"
            onValue={(n, bad) => {
              setReworkKg(n);
              mark("rework")(bad);
            }}
          />
        </div>
        <div>
          <label className="label" htmlFor="qc-scrap">
            Phế phẩm (kg)
          </label>
          <VnNumberInput
            id="qc-scrap"
            min={0}
            value={scrapKg}
            placeholder="0"
            onValue={(n, bad) => {
              setScrapKg(n);
              mark("scrap")(bad);
            }}
          />
        </div>
        <div>
          <label className="label" htmlFor="qc-haccp">
            Vi phạm HACCP (vụ)
          </label>
          <VnNumberInput
            id="qc-haccp"
            min={0}
            value={haccp}
            placeholder="0"
            onValue={(n, bad) => {
              setHaccp(n === null ? null : Math.round(n));
              mark("haccp")(bad);
            }}
          />
        </div>
      </div>

      {entered && (
        <div
          className={`rounded-md px-3 py-2 text-xs tabular-nums ${
            bigGap
              ? "border border-amber-200 bg-amber-50 text-amber-900"
              : "bg-ink-50 text-ink-600"
          }`}
          aria-live="polite"
        >
          Tổng phân loại {fmtKg(accounted, { unit: "kg" })} ·{" "}
          {diff === 0
            ? "khớp sản lượng thô"
            : `${diff > 0 ? "thiếu" : "thừa"} ${fmtKg(Math.abs(diff), { unit: "kg" })} so với sản lượng thô`}
          {bigGap && (
            <>
              {" "}
              — lệch quá {MASS_GAP_REASON_KG} kg, hệ thống sẽ bắt là bất thường
              cân đối khi khoá số.
              <label className="mt-2 block font-medium" htmlFor="qc-gap-reason">
                Lý do lệch (bắt buộc)
              </label>
              <input
                id="qc-gap-reason"
                className="input mt-1"
                placeholder="Ví dụ: cân sót lô 2, hàng rơi vãi khi chuyển kho lạnh"
                value={gapReason}
                onChange={(e) => setGapReason(e.target.value)}
              />
              <div className="mt-1 font-normal text-amber-800">
                {gapReasonLen}/{MASS_GAP_MIN_REASON} ký tự tối thiểu · ghi vào ghi
                chú KCS và nhật ký
              </div>
            </>
          )}
        </div>
      )}

      <details open className="rounded-md bg-ink-50 p-3">
        <summary className="cursor-pointer text-sm font-medium text-ink-700">
          Ghi lỗi theo từng công đoạn ({participants.length} người)
        </summary>
        <p className="mt-2 mb-2 text-xs text-ink-500">
          Đây là thứ duy nhất phân biệt được người làm tốt và người làm ẩu trong
          cùng một ca. Bỏ trống là không lỗi — cả ca chấm như nhau.
        </p>
        <table className="w-full table-fixed border-separate border-spacing-x-0 border-spacing-y-1.5 text-xs">
          <colgroup>
            <col className="w-[44%]" />
            <col className="w-[30%]" />
            <col className="w-[26%]" />
          </colgroup>
          <thead>
            <tr className="text-left text-ink-500">
              <th scope="col" className="pb-0.5 font-medium">
                Người · công đoạn
              </th>
              <th scope="col" className="px-1 pb-0.5 font-medium">
                Lỗi công đoạn (kg)
              </th>
              <th scope="col" className="pb-0.5 font-medium">
                Vi phạm nội quy (lần)
              </th>
            </tr>
          </thead>
          <tbody>
            {participants.map((p) => (
              <tr key={p.userId}>
                <th scope="row" className="pr-2 text-left font-normal">
                  <div className="truncate font-medium text-ink-800">{p.name}</div>
                  <div className="text-ink-500">{STAGE_LABEL[p.stage] ?? p.stage}</div>
                </th>
                <td className="px-1">
                  <VnNumberInput
                    className="input py-1 text-xs"
                    min={0}
                    placeholder="0"
                    aria-label={`Lỗi công đoạn (kg) — ${p.name}`}
                    value={defects[p.userId]?.d ?? null}
                    onValue={(n, bad) => {
                      setDefect(p.userId, "d", n);
                      mark(`d:${p.userId}`)(bad);
                    }}
                  />
                </td>
                <td>
                  <VnNumberInput
                    className="input py-1 text-xs"
                    min={0}
                            placeholder="0"
                    aria-label={`Vi phạm nội quy (lần) — ${p.name}`}
                    value={defects[p.userId]?.v ?? null}
                    onValue={(n, bad) => {
                      setDefect(p.userId, "v", n === null ? null : Math.round(n));
                      mark(`v:${p.userId}`)(bad);
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <div>
        <label className="label" htmlFor="qc-note">
          Ghi chú của KCS
        </label>
        <input
          id="qc-note"
          className="input"
          value={qcNote}
          onChange={(e) => setQcNote(e.target.value)}
          placeholder="Ví dụ: viên bị nứt do nhiệt hấp cao"
        />
      </div>

      {blockedHint && !busy && (
        <p className="text-xs text-ink-500">{blockedHint}</p>
      )}

      <StickyActions>
        {/* Số khai sai từ gốc (thô, người, mã) thì KCS không nên "xác nhận
            cho qua" — trả về để người khai sửa, có ghi lý do. */}
        <button
          className="btn-ghost inline-flex items-center justify-center gap-1.5"
          disabled={busy}
          onClick={() => setReturnOpen(true)}
        >
          <Undo2 size={15} strokeWidth={2} aria-hidden /> Trả về sản xuất
        </button>
        <button
          className={`${override ? "btn-danger" : "btn-primary"} inline-flex items-center justify-center gap-1.5`}
          disabled={!canSubmit}
          onClick={submit}
        >
          {busy ? (
            "Đang lưu..."
          ) : override ? (
            <>
              <ShieldAlert size={15} strokeWidth={2} /> Vượt quyền KCS & chuyển
              khoá số
            </>
          ) : (
            <>
              <Check size={15} strokeWidth={2.5} /> Xác nhận & chuyển BGĐ
            </>
          )}
        </button>
      </StickyActions>

      <ConfirmDialog
        open={returnOpen}
        title="Trả ca về sản xuất để sửa?"
        confirmLabel="Trả về sản xuất"
        reason={{
          label: "Cần sửa gì",
          placeholder: "Ví dụ: sản lượng thô khai 1.030 kg nhưng phiếu cân ghi 1.300 kg",
          minLength: SHIFT_RETURN_MIN_REASON,
        }}
        busy={busy}
        error={returnOpen ? error : null}
        onClose={() => setReturnOpen(false)}
        onConfirm={async (reason) => {
          const d = await onCall({ action: "RETURN", reason });
          if (d) {
            setReturnOpen(false);
            toast("Đã trả ca về sản xuất — người khai nhận thông báo.");
          }
        }}
      >
        <p>
          Ca quay lại người khai để sửa số liệu (sản lượng thô, người làm ca, mã
          sản phẩm…) rồi gửi lại. Số KCS bạn đang nhập ở form sẽ không được lưu.
        </p>
      </ConfirmDialog>
    </div>
  );
}

/* ------------------------------------- BƯỚC 2 (ngoại lệ): BGĐ vượt quyền KCS */

function CeoQcOverride({
  shift,
  participants,
  busy,
  error,
  onCall,
  prefix,
}: {
  shift: Shift;
  participants: Participant[];
  busy: boolean;
  error: string | null;
  onCall: (p: unknown) => Promise<unknown>;
  prefix: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-3">
      <div className="text-sm text-ink-500">
        Đang chờ KCS vào xác nhận phẩm chất. Bước 2 là việc của KCS — Ban Giám
        đốc chỉ làm thay khi thật cần, và phải ghi lý do vào nhật ký.
      </div>
      {open ? (
        <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-start gap-1.5 text-xs text-amber-800">
            <ShieldAlert size={14} strokeWidth={2} className="mt-0.5 shrink-0" />
            <span>
              Bạn đang <b>vượt quyền KCS</b>. Lý do ghi vào ghi chú KCS và nhật
              ký; ca sẽ hiện rõ là bước 2 do Ban Giám đốc làm thay.
            </span>
          </div>
          <QcForm
            shift={shift}
            participants={participants}
            busy={busy}
            error={error}
            onCall={onCall}
            override={{ prefix }}
          />
          <button
            className="btn-ghost btn-sm w-full"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Huỷ, để KCS làm
          </button>
        </div>
      ) : (
        <button
          className="btn-ghost btn-sm inline-flex w-full items-center justify-center gap-1.5"
          onClick={() => setOpen(true)}
        >
          <ShieldAlert size={14} strokeWidth={2} /> Vượt quyền KCS (ghi lý do)
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------- BƯỚC 3: BAN GIÁM ĐỐC KHOÁ */

function CeoLockForm({
  shift,
  participantsCount,
  selfOverridden,
  busy,
  error,
  onCall,
}: {
  shift: Shift;
  participantsCount: number;
  /** Chính người đang xem đã vượt quyền KCS ở bước 2 */
  selfOverridden: boolean;
  busy: boolean;
  error: string | null;
  onCall: (p: unknown) => Promise<unknown>;
}) {
  const [target, setTarget] = useState<number | null>(shift.skuStandardTargetKg);
  const [nvl, setNvl] = useState<number | null>(shift.rawMaterialInputKg);
  const [badInput, setBadInput] = useState({ target: false, nvl: false });
  const [targetReason, setTargetReason] = useState("");
  const [nvlReason, setNvlReason] = useState("");
  const [ceoNote, setCeoNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const targetKg = target ?? 0;
  const nvlKg = nvl ?? 0;
  const targetChanged = Math.abs(targetKg - shift.skuStandardTargetKg) > 0.01;
  const nvlChanged = Math.abs(nvlKg - shift.rawMaterialInputKg) > 0.01;

  // Cùng công thức máy chủ dùng khi khoá (kpi-engine) — số trong hộp xác
  // nhận khớp với số sẽ ghi vào ca.
  const stdNorm = computeStdMaterialNorm(targetKg, shift.skuLossRate);
  const projectedLoss =
    shift.unitPriceVnd === null
      ? null
      : computeQualityLoss(
          {
            scrapKg: shift.scrapKg,
            reworkKg: shift.reworkKg,
            rawMaterialInputKg: nvlKg,
            stdMaterialNormKg: stdNorm,
          },
          shift.unitPriceVnd
        );

  const canSubmit =
    targetKg > 0 &&
    nvl !== null &&
    !badInput.target &&
    !badInput.nvl &&
    (!targetChanged || targetReason.trim().length > 0) &&
    (!nvlChanged || nvlReason.trim().length > 0);

  const selfOverrideWarning = selfOverridden && (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      Bạn đã <b>vượt quyền KCS</b> ở bước 2 của ca này. Khoá tiếp thì cả bước 2
      và bước 3 do một người — hệ thống ghi rõ điều này cùng lý do vượt quyền
      vào nhật ký. Nếu có thành viên Ban Giám đốc khác, nên để người đó khoá.
    </div>
  );

  return (
    <div className="space-y-3">
      {selfOverrideWarning}

      <div className="rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-600 tabular-nums">
        Chuẩn của mã <b className="font-mono">{shift.skuCode}</b>: sản lượng{" "}
        <b>{fmtKg(shift.skuStandardTargetKg, { unit: "kg" })}</b>, hao hụt{" "}
        <b>{fmtPct(shift.skuLossRate, { digits: 2 })}</b>. Kho khai cấp{" "}
        <b>{fmtKg(shift.rawMaterialInputKg, { unit: "kg" })}</b>.
      </div>

      <div>
        <label className="label" htmlFor="lock-target">
          Chỉ tiêu sản lượng ca (kg)
        </label>
        <VnNumberInput
          id="lock-target"
          min={0}
          className={`input ${targetChanged ? "border-amber-300" : ""}`}
          value={target}
          onValue={(n, bad) => {
            setTarget(n);
            setBadInput((b) => ({ ...b, target: bad }));
          }}
        />
        {targetChanged && (
          <div className="mt-2">
            <p className="mb-1 text-xs text-amber-800">
              Khác chuẩn SKU — bắt buộc ghi lý do. Đặt chỉ tiêu sau khi đã biết
              kết quả là chỗ dễ bị nghi ngờ nhất, nên phải có dấu vết.
            </p>
            <input
              className="input"
              placeholder="Vì sao đặt khác chuẩn?"
              value={targetReason}
              onChange={(e) => setTargetReason(e.target.value)}
            />
          </div>
        )}
      </div>

      <div>
        <label className="label" htmlFor="lock-nvl">
          Nguyên liệu thực cấp (kg)
        </label>
        <VnNumberInput
          id="lock-nvl"
          min={0}
          className={`input ${nvlChanged ? "border-amber-300" : ""}`}
          value={nvl}
          onValue={(n, bad) => {
            setNvl(n);
            setBadInput((b) => ({ ...b, nvl: bad }));
          }}
        />
        {nvlChanged && (
          <div className="mt-2">
            <p className="mb-1 text-xs text-amber-800">
              Khác số kho đã khai — bắt buộc ghi lý do.
            </p>
            <input
              className="input"
              placeholder="Vì sao đính chính số kho?"
              value={nvlReason}
              onChange={(e) => setNvlReason(e.target.value)}
            />
          </div>
        )}
      </div>

      <div className="rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-700 tabular-nums">
        Định mức nguyên liệu hệ thống tự tính:{" "}
        <b>{fmtKg(stdNorm, { unit: "kg" })}</b>
        {nvlKg > 0 && (
          <>
            {" · "}
            {nvlKg > stdNorm ? (
              <span className="text-red-700">
                vượt {fmtKg(nvlKg - stdNorm, { unit: "kg" })}
              </span>
            ) : (
              <span className="text-leaf-700">
                dưới {fmtKg(stdNorm - nvlKg, { unit: "kg" })}
              </span>
            )}
          </>
        )}
      </div>

      <div>
        <label className="label">Ghi chú của Ban Giám đốc</label>
        <input
          className="input"
          value={ceoNote}
          onChange={(e) => setCeoNote(e.target.value)}
        />
      </div>

      <p className="text-xs text-ink-500">
        Khoá xong hệ thống mới chấm điểm và quét chống chạy chỉ tiêu.
      </p>
      <StickyActions>
        <button
          className="btn-primary inline-flex items-center justify-center gap-1.5"
          disabled={busy || !canSubmit}
          onClick={() => setConfirmOpen(true)}
        >
          <Lock size={15} strokeWidth={2} /> Duyệt & khoá số liệu
        </button>
      </StickyActions>

      {/* Khoá là thao tác không đảo ngược được (mở lại phải ghi lý do, xoá
          điểm, hoàn kho) — trước đây một chạm là khoá. Giờ phải xem lại số
          và hậu quả trước khi bấm. */}
      <ConfirmDialog
        open={confirmOpen}
        title="Khoá số liệu ca này?"
        tone="danger"
        confirmLabel="Khoá số & chấm điểm"
        busy={busy}
        error={confirmOpen ? error : null}
        onClose={() => setConfirmOpen(false)}
        onConfirm={async () => {
          const d = await onCall({
            action: "CEO_LOCK",
            targetOutputKg: targetKg,
            rawMaterialInputKg: nvlKg,
            targetOverrideReason: targetChanged ? targetReason : undefined,
            materialOverrideReason: nvlChanged ? nvlReason : undefined,
            ceoNote: ceoNote || undefined,
          });
          if (d) setConfirmOpen(false);
        }}
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 tabular-nums">
          <dt className="text-ink-500">Chỉ tiêu sản lượng</dt>
          <dd className="font-semibold text-ink-900">
            {fmtKg(targetKg, { unit: "kg" })}
            {targetChanged && (
              <span className="ml-1 text-xs font-normal text-amber-800">
                (chuẩn {fmtKg(shift.skuStandardTargetKg, { unit: "kg" })})
              </span>
            )}
          </dd>
          <dt className="text-ink-500">Nguyên liệu cấp vào</dt>
          <dd className="font-semibold text-ink-900">
            {fmtKg(nvlKg, { unit: "kg" })}
            {nvlChanged && (
              <span className="ml-1 text-xs font-normal text-amber-800">
                (kho khai {fmtKg(shift.rawMaterialInputKg, { unit: "kg" })})
              </span>
            )}
          </dd>
          <dt className="text-ink-500">Định mức NVL</dt>
          <dd className="text-ink-900">{fmtKg(stdNorm, { unit: "kg" })}</dd>
          {projectedLoss && (
            <>
              <dt className="text-ink-500">Tổn thất chất lượng (dự tính)</dt>
              <dd
                className={`font-semibold ${projectedLoss.qualityLossVnd > 0 ? "text-red-700" : "text-ink-900"}`}
              >
                {fmtVnd(projectedLoss.qualityLossVnd)}
              </dd>
            </>
          )}
          <dt className="text-ink-500">Chấm điểm cho</dt>
          <dd className="font-semibold text-ink-900">
            {fmtNum(participantsCount)} người
          </dd>
        </dl>
        <p>
          Khoá xong: chấm điểm từng người, quét chống chạy chỉ tiêu và trừ kho
          NVL theo định mức. Muốn sửa phải mở lại ca có ghi lý do.
        </p>
        {selfOverrideWarning}
      </ConfirmDialog>
    </div>
  );
}

/* ------------------------------------------------------------ MỞ LẠI CA */

function ReopenForm({
  busy,
  error,
  participantsCount,
  onCall,
}: {
  busy: boolean;
  error: string | null;
  participantsCount: number;
  onCall: (p: unknown) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="btn-ghost btn-sm inline-flex w-full items-center justify-center gap-1.5"
        disabled={busy}
        onClick={() => setOpen(true)}
      >
        <LockOpen size={14} strokeWidth={2} /> Mở lại ca này
      </button>
      <ConfirmDialog
        open={open}
        title="Mở lại ca đã khoá?"
        tone="danger"
        confirmLabel="Xác nhận mở lại"
        reason={{
          label: "Lý do mở lại",
          placeholder: "Ví dụ: KCS cân nhầm lô phế, cần nhập lại số liệu",
          minLength: 10,
        }}
        busy={busy}
        error={open ? error : null}
        onClose={() => setOpen(false)}
        onConfirm={async (reason) => {
          const d = await onCall({ action: "REOPEN", reason });
          if (d) {
            setOpen(false);
            toast("Đã mở lại ca — điểm đã xoá, kho NVL đã hoàn.");
          }
        }}
      >
        <p>
          Mở lại sẽ <b>xoá toàn bộ điểm đã chấm</b> của {participantsCount}{" "}
          người trong ca, hoàn lại kho NVL đã trừ và đưa ca về bước chờ khoá.
          Mọi thứ vào nhật ký.
        </p>
      </ConfirmDialog>
    </>
  );
}
