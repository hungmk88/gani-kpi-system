"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, LockOpen, Check, CircleCheck, ShieldAlert } from "lucide-react";
import { STAGE_LABEL } from "@/lib/production/constants";
import {
  computeQualityLoss,
  computeStdMaterialNorm,
} from "@/lib/production/kpi-engine";
import ConfirmDialog from "@/components/confirm-dialog";

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
};

type Participant = {
  userId: string;
  name: string;
  stage: string;
  personalDefectKg: number;
  violationCount: number;
};

/** Lệch cân đối quá ngưỡng này thì hệ thống bắt bất thường — phải xác nhận */
const BIG_GAP_KG = 5;
const OVERRIDE_MIN_REASON = 10;

/** 374,5 kg — số kiểu Việt Nam, tối đa 2 chữ số thập phân */
const fmtNum = (n: number) =>
  new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n);
const fmtKg = (n: number) => fmtNum(n) + " kg";
const fmtVnd = (n: number) =>
  new Intl.NumberFormat("vi-VN").format(Math.round(n)) + " ₫";

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

      {shift.status === "DRAFT" &&
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
            onCall={call}
          />
        ) : isCeo ? (
          <CeoQcOverride
            shift={shift}
            participants={participants}
            busy={busy}
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
                setMessage(
                  `Đã khoá số. Điểm toàn xưởng ${d.tier2Score}, chấm cho ${d.scored} người.` +
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
  onCall,
  override,
}: {
  shift: Shift;
  participants: Participant[];
  busy: boolean;
  onCall: (p: unknown) => Promise<unknown>;
  /** BGĐ vượt quyền KCS: bắt buộc lý do, lý do thành dòng đầu của qcNote */
  override?: { prefix: string };
}) {
  const [qcPassedKg, setQcPassedKg] = useState("");
  const [reworkKg, setReworkKg] = useState("0");
  const [scrapKg, setScrapKg] = useState("0");
  const [haccp, setHaccp] = useState("0");
  const [qcNote, setQcNote] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  // Ô lỗi cá nhân để trống (placeholder "0") — trước đây điền sẵn "0" nên
  // placeholder không bao giờ hiện và người nhập không biết ô nào là ô nào.
  const [defects, setDefects] = useState<Record<string, { d: string; v: string }>>(
    Object.fromEntries(participants.map((p) => [p.userId, { d: "", v: "" }]))
  );
  // Lưu đúng con số lệch đã được xác nhận — sửa số khác thì phải xác nhận lại
  const [ackedDiff, setAckedDiff] = useState<number | null>(null);

  const accounted =
    (Number(qcPassedKg) || 0) + (Number(reworkKg) || 0) + (Number(scrapKg) || 0);
  const diff = Math.round((shift.rawOutputKg - accounted) * 100) / 100;
  // Chỉ cảnh báo lệch khi đã gõ số đạt — form còn trống mà báo đỏ "lệch N kg"
  // là doạ người dùng vô cớ.
  const entered = qcPassedKg.trim() !== "";
  const bigGap = entered && Math.abs(diff) > BIG_GAP_KG;
  const gapAcked = !bigGap || ackedDiff === diff;

  const reasonLen = overrideReason.trim().length;
  const reasonOk = !override || reasonLen >= OVERRIDE_MIN_REASON;

  const canSubmit = !busy && entered && gapAcked && reasonOk;
  const blockedHint = !entered
    ? "Nhập số kg Đạt QC để bật nút xác nhận."
    : !gapAcked
      ? `Tick ô xác nhận số lệch ${fmtKg(diff)} ở trên để bật nút.`
      : !reasonOk
        ? `Ghi lý do vượt quyền — còn thiếu ${OVERRIDE_MIN_REASON - reasonLen} ký tự.`
        : null;

  function setDefect(userId: string, key: "d" | "v", value: string) {
    setDefects({
      ...defects,
      [userId]: { ...(defects[userId] ?? { d: "", v: "" }), [key]: value },
    });
  }

  function submit() {
    const note = qcNote.trim();
    // Vượt quyền: lý do gửi ở trường riêng; máy chủ tự ghép vào dòng đầu ghi
    // chú KCS ("[BGĐ vượt quyền KCS] <lý do>") và ghi vào nhật ký.
    return onCall({
      action: "QC_APPROVE",
      qcPassedKg: Number(qcPassedKg),
      reworkKg: Number(reworkKg) || 0,
      scrapKg: Number(scrapKg) || 0,
      haccpViolationCount: Number(haccp) || 0,
      qcNote: note || undefined,
      ceoOverrideReason: override
        ? overrideReason.replace(/\s+/g, " ").trim()
        : undefined,
      participantDefects: participants.map((p) => ({
        userId: p.userId,
        personalDefectKg: Number(defects[p.userId]?.d) || 0,
        violationCount: Number(defects[p.userId]?.v) || 0,
      })),
    });
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
        Sản xuất khai sản lượng thô <b>{fmtKg(shift.rawOutputKg)}</b>. Phân loại cho
        đủ số đó.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">Đạt QC (kg)</label>
          <input
            type="number"
            step="any"
            className="input"
            value={qcPassedKg}
            onChange={(e) => setQcPassedKg(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Làm lại (kg)</label>
          <input
            type="number"
            step="any"
            className="input"
            value={reworkKg}
            onChange={(e) => setReworkKg(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Phế phẩm (kg)</label>
          <input
            type="number"
            step="any"
            className="input"
            value={scrapKg}
            onChange={(e) => setScrapKg(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Vi phạm HACCP</label>
          <input
            type="number"
            className="input"
            value={haccp}
            onChange={(e) => setHaccp(e.target.value)}
          />
        </div>
      </div>

      {entered && (
        <div
          className={`rounded-md px-3 py-2 text-xs tabular-nums ${
            bigGap
              ? "border border-red-200 bg-red-50 text-red-800"
              : "bg-ink-50 text-ink-600"
          }`}
        >
          Tổng phân loại {fmtKg(accounted)} · lệch {fmtKg(diff)} so với sản lượng thô
          {bigGap &&
            ` — lệch quá ${BIG_GAP_KG} kg sẽ bị hệ thống bắt là bất thường cân đối.`}
          {bigGap && (
            <label className="mt-2 flex items-start gap-2 font-medium">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={ackedDiff === diff}
                onChange={(e) => setAckedDiff(e.target.checked ? diff : null)}
              />
              Tôi xác nhận số lệch này là đúng
            </label>
          )}
        </div>
      )}

      <details open className="rounded-md bg-ink-50 p-3">
        <summary className="cursor-pointer text-sm font-medium text-ink-700">
          Ghi lỗi theo từng công đoạn ({participants.length} người)
        </summary>
        <p className="mt-2 mb-2 text-xs text-ink-500">
          Đây là thứ duy nhất phân biệt được người làm tốt và người làm ẩu trong
          cùng một ca. Bỏ trống thì cả ca chấm như nhau.
        </p>
        <div className="mb-1 grid grid-cols-[1.6fr_1fr_1fr] gap-2 text-xs font-medium text-ink-500">
          <div>Người · công đoạn</div>
          <div>Lỗi cá nhân (kg)</div>
          <div>Vi phạm</div>
        </div>
        <div className="space-y-2">
          {participants.map((p) => (
            <div
              key={p.userId}
              className="grid grid-cols-[1.6fr_1fr_1fr] items-center gap-2"
            >
              <div className="min-w-0 text-xs">
                <div className="truncate font-medium text-ink-800">{p.name}</div>
                <div className="text-ink-500">
                  {STAGE_LABEL[p.stage] ?? p.stage}
                </div>
              </div>
              <input
                type="number"
                step="any"
                className="input py-1 text-xs"
                placeholder="0"
                aria-label={`Lỗi cá nhân (kg) — ${p.name}`}
                value={defects[p.userId]?.d ?? ""}
                onChange={(e) => setDefect(p.userId, "d", e.target.value)}
              />
              <input
                type="number"
                className="input py-1 text-xs"
                placeholder="0"
                aria-label={`Vi phạm — ${p.name}`}
                value={defects[p.userId]?.v ?? ""}
                onChange={(e) => setDefect(p.userId, "v", e.target.value)}
              />
            </div>
          ))}
        </div>
      </details>

      <div>
        <label className="label">Ghi chú của KCS</label>
        <input
          className="input"
          value={qcNote}
          onChange={(e) => setQcNote(e.target.value)}
          placeholder="Ví dụ: viên bị nứt do nhiệt hấp cao"
        />
      </div>

      <button
        className={`${override ? "btn-danger" : "btn-primary"} inline-flex w-full items-center justify-center gap-1.5`}
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
            <Check size={15} strokeWidth={2.5} /> Xác nhận & chuyển Ban Giám đốc
          </>
        )}
      </button>
      {blockedHint && !busy && (
        <p className="text-xs text-ink-500">{blockedHint}</p>
      )}
    </div>
  );
}

/* ------------------------------------- BƯỚC 2 (ngoại lệ): BGĐ vượt quyền KCS */

function CeoQcOverride({
  shift,
  participants,
  busy,
  onCall,
  prefix,
}: {
  shift: Shift;
  participants: Participant[];
  busy: boolean;
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
  const [target, setTarget] = useState(String(shift.skuStandardTargetKg));
  const [nvl, setNvl] = useState(String(shift.rawMaterialInputKg));
  const [targetReason, setTargetReason] = useState("");
  const [nvlReason, setNvlReason] = useState("");
  const [ceoNote, setCeoNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const targetChanged =
    Math.abs(Number(target) - shift.skuStandardTargetKg) > 0.01;
  const nvlChanged = Math.abs(Number(nvl) - shift.rawMaterialInputKg) > 0.01;

  // Cùng công thức máy chủ dùng khi khoá (kpi-engine) — số trong hộp xác
  // nhận khớp với số sẽ ghi vào ca.
  const stdNorm = computeStdMaterialNorm(Number(target) || 0, shift.skuLossRate);
  const projectedLoss =
    shift.unitPriceVnd === null
      ? null
      : computeQualityLoss(
          {
            scrapKg: shift.scrapKg,
            reworkKg: shift.reworkKg,
            rawMaterialInputKg: Number(nvl) || 0,
            stdMaterialNormKg: stdNorm,
          },
          shift.unitPriceVnd
        );

  const canSubmit =
    Number(target) > 0 &&
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
        <b>{fmtKg(shift.skuStandardTargetKg)}</b>, hao hụt{" "}
        <b>{fmtNum(shift.skuLossRate)}%</b>. Kho khai cấp{" "}
        <b>{fmtKg(shift.rawMaterialInputKg)}</b>.
      </div>

      <div>
        <label className="label">Chỉ tiêu sản lượng ca (kg)</label>
        <input
          type="number"
          step="any"
          className={`input ${targetChanged ? "border-amber-300" : ""}`}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
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
        <label className="label">Nguyên liệu thực cấp (kg)</label>
        <input
          type="number"
          step="any"
          className={`input ${nvlChanged ? "border-amber-300" : ""}`}
          value={nvl}
          onChange={(e) => setNvl(e.target.value)}
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
        Định mức nguyên liệu hệ thống tự tính: <b>{fmtKg(stdNorm)}</b>
        {Number(nvl) > 0 && (
          <>
            {" · "}
            {Number(nvl) > stdNorm ? (
              <span className="text-red-700">
                vượt {fmtKg(Math.round((Number(nvl) - stdNorm) * 100) / 100)}
              </span>
            ) : (
              <span className="text-leaf-700">
                dưới {fmtKg(Math.round((stdNorm - Number(nvl)) * 100) / 100)}
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

      <button
        className="btn-primary inline-flex w-full items-center justify-center gap-1.5"
        disabled={busy || !canSubmit}
        onClick={() => setConfirmOpen(true)}
      >
        <Lock size={15} strokeWidth={2} /> Duyệt & khoá số liệu
      </button>
      <p className="text-xs text-ink-500">
        Khoá xong hệ thống mới chấm điểm và quét chống chạy chỉ tiêu.
      </p>

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
            targetOutputKg: Number(target),
            rawMaterialInputKg: Number(nvl),
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
            {fmtKg(Number(target) || 0)}
            {targetChanged && (
              <span className="ml-1 text-xs font-normal text-amber-800">
                (chuẩn {fmtKg(shift.skuStandardTargetKg)})
              </span>
            )}
          </dd>
          <dt className="text-ink-500">Nguyên liệu cấp vào</dt>
          <dd className="font-semibold text-ink-900">
            {fmtKg(Number(nvl) || 0)}
            {nvlChanged && (
              <span className="ml-1 text-xs font-normal text-amber-800">
                (kho khai {fmtKg(shift.rawMaterialInputKg)})
              </span>
            )}
          </dd>
          <dt className="text-ink-500">Định mức NVL</dt>
          <dd className="text-ink-900">{fmtKg(stdNorm)}</dd>
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
            {participantsCount.toLocaleString("vi-VN")} người
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
          if (d) setOpen(false);
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
