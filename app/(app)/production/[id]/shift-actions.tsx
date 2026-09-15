"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, LockOpen, Check } from "lucide-react";
import { STAGE_LABEL } from "@/lib/production/constants";

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
};

type Participant = {
  userId: string;
  name: string;
  stage: string;
  personalDefectKg: number;
  violationCount: number;
};

export default function ShiftActions({
  shift,
  participants,
  viewer,
}: {
  shift: Shift;
  participants: Participant[];
  viewer: { id: string; role: string; productionRole: string | null };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const isCeo = viewer.role === "CEO";
  const isQc = viewer.productionRole === "QC_OFFICER" || isCeo;
  const selfApprove = shift.createdById === viewer.id && !isCeo;

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
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {message && (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </div>
      )}

      {shift.status === "DRAFT" &&
        (isQc ? (
          selfApprove ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Bạn là người khai ca này nên không được tự xác nhận phẩm chất. Phải
              là một KCS khác vào duyệt — đó là lý do có bước 2.
            </div>
          ) : (
            <QcForm shift={shift} participants={participants} busy={busy} onCall={call} />
          )
        ) : (
          <div className="text-sm text-ink-500">
            Đang chờ KCS vào xác nhận phẩm chất. Bạn không có vai trò KCS.
          </div>
        ))}

      {shift.status === "QC_APPROVED" &&
        (isCeo ? (
          <CeoLockForm
            shift={shift}
            busy={busy}
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
          <div className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <Lock size={14} strokeWidth={2} /> Ca đã khoá số và chấm điểm xong.
          </div>
          {isCeo && (
            <ReopenForm busy={busy} onCall={call} />
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
}: {
  shift: Shift;
  participants: Participant[];
  busy: boolean;
  onCall: (p: unknown) => Promise<unknown>;
}) {
  const [qcPassedKg, setQcPassedKg] = useState("");
  const [reworkKg, setReworkKg] = useState("0");
  const [scrapKg, setScrapKg] = useState("0");
  const [haccp, setHaccp] = useState("0");
  const [qcNote, setQcNote] = useState("");
  const [defects, setDefects] = useState<Record<string, { d: string; v: string }>>(
    Object.fromEntries(participants.map((p) => [p.userId, { d: "0", v: "0" }]))
  );

  const accounted =
    (Number(qcPassedKg) || 0) + (Number(reworkKg) || 0) + (Number(scrapKg) || 0);
  const diff = Math.round((shift.rawOutputKg - accounted) * 100) / 100;
  const bigGap = Math.abs(diff) > 5;

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-500">
        Sản xuất khai sản lượng thô <b>{shift.rawOutputKg} kg</b>. Phân loại cho
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

      <div
        className={`rounded-lg border px-3 py-2 text-xs ${
          bigGap
            ? "border-red-200 bg-red-50 text-red-800"
            : "border-ink-200 bg-ink-50 text-ink-600"
        }`}
      >
        Tổng phân loại {accounted} kg · lệch {diff} kg so với sản lượng thô
        {bigGap && " — lệch quá 5 kg sẽ bị hệ thống bắt là bất thường cân đối."}
      </div>

      <details className="rounded-lg border border-ink-200 p-2">
        <summary className="cursor-pointer text-xs font-medium text-ink-700">
          Ghi lỗi theo từng công đoạn ({participants.length} người)
        </summary>
        <p className="mt-2 mb-2 text-[11px] text-ink-500">
          Đây là thứ duy nhất phân biệt được người làm tốt và người làm ẩu trong
          cùng một ca. Bỏ trống thì cả ca chấm như nhau.
        </p>
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
                placeholder="Lỗi kg"
                value={defects[p.userId]?.d ?? "0"}
                onChange={(e) =>
                  setDefects({
                    ...defects,
                    [p.userId]: {
                      ...(defects[p.userId] ?? { d: "0", v: "0" }),
                      d: e.target.value,
                    },
                  })
                }
              />
              <input
                type="number"
                className="input py-1 text-xs"
                placeholder="Vi phạm"
                value={defects[p.userId]?.v ?? "0"}
                onChange={(e) =>
                  setDefects({
                    ...defects,
                    [p.userId]: {
                      ...(defects[p.userId] ?? { d: "0", v: "0" }),
                      v: e.target.value,
                    },
                  })
                }
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
        className="btn-primary inline-flex w-full items-center justify-center gap-1.5"
        disabled={busy || qcPassedKg === ""}
        onClick={() =>
          onCall({
            action: "QC_APPROVE",
            qcPassedKg: Number(qcPassedKg),
            reworkKg: Number(reworkKg) || 0,
            scrapKg: Number(scrapKg) || 0,
            haccpViolationCount: Number(haccp) || 0,
            qcNote: qcNote || undefined,
            participantDefects: participants.map((p) => ({
              userId: p.userId,
              personalDefectKg: Number(defects[p.userId]?.d) || 0,
              violationCount: Number(defects[p.userId]?.v) || 0,
            })),
          })
        }
      >
        {busy ? (
          "Đang lưu..."
        ) : (
          <>
            <Check size={15} strokeWidth={2.5} /> Xác nhận & chuyển Ban Giám đốc
          </>
        )}
      </button>
    </div>
  );
}

/* ---------------------------------------------- BƯỚC 3: BAN GIÁM ĐỐC KHOÁ */

function CeoLockForm({
  shift,
  busy,
  onCall,
}: {
  shift: Shift;
  busy: boolean;
  onCall: (p: unknown) => Promise<unknown>;
}) {
  const [target, setTarget] = useState(String(shift.skuStandardTargetKg));
  const [nvl, setNvl] = useState(String(shift.rawMaterialInputKg));
  const [targetReason, setTargetReason] = useState("");
  const [nvlReason, setNvlReason] = useState("");
  const [ceoNote, setCeoNote] = useState("");

  const targetChanged =
    Math.abs(Number(target) - shift.skuStandardTargetKg) > 0.01;
  const nvlChanged = Math.abs(Number(nvl) - shift.rawMaterialInputKg) > 0.01;

  const stdNorm =
    Math.round(Number(target) * (1 + shift.skuLossRate / 100) * 100) / 100;

  const canSubmit =
    Number(target) > 0 &&
    (!targetChanged || targetReason.trim().length > 0) &&
    (!nvlChanged || nvlReason.trim().length > 0);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-ink-200 bg-ink-50/60 px-3 py-2 text-xs text-ink-600">
        Chuẩn của mã <b>{shift.skuCode}</b>: sản lượng{" "}
        <b>{shift.skuStandardTargetKg} kg</b>, hao hụt{" "}
        <b>{shift.skuLossRate}%</b>. Kho khai cấp{" "}
        <b>{shift.rawMaterialInputKg} kg</b>.
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
            <p className="mb-1 text-[11px] text-amber-700">
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
            <p className="mb-1 text-[11px] text-amber-700">
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

      <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-900">
        Định mức nguyên liệu hệ thống tự tính: <b>{stdNorm} kg</b>
        {Number(nvl) > 0 && (
          <>
            {" · "}
            {Number(nvl) > stdNorm ? (
              <span className="text-red-700">
                vượt {Math.round((Number(nvl) - stdNorm) * 100) / 100} kg
              </span>
            ) : (
              <span className="text-emerald-700">
                dưới {Math.round((stdNorm - Number(nvl)) * 100) / 100} kg
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
        onClick={() =>
          onCall({
            action: "CEO_LOCK",
            targetOutputKg: Number(target),
            rawMaterialInputKg: Number(nvl),
            targetOverrideReason: targetChanged ? targetReason : undefined,
            materialOverrideReason: nvlChanged ? nvlReason : undefined,
            ceoNote: ceoNote || undefined,
          })
        }
      >
        {busy ? (
          "Đang khoá..."
        ) : (
          <>
            <Lock size={15} strokeWidth={2} /> Duyệt & khoá số liệu
          </>
        )}
      </button>
      <p className="text-[11px] text-ink-500">
        Khoá xong hệ thống mới chấm điểm và quét chống chạy chỉ tiêu.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------ MỞ LẠI CA */

function ReopenForm({
  busy,
  onCall,
}: {
  busy: boolean;
  onCall: (p: unknown) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!open) {
    return (
      <button
        className="btn-ghost btn-sm inline-flex w-full items-center justify-center gap-1.5"
        onClick={() => setOpen(true)}
      >
        <LockOpen size={14} strokeWidth={2} /> Mở lại ca này
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-amber-700">
        Mở lại sẽ <b>xoá toàn bộ điểm đã chấm</b> của ca này và đưa về bước chờ
        khoá. Mọi thứ vào nhật ký.
      </p>
      <input
        className="input"
        placeholder="Lý do mở lại (tối thiểu 10 ký tự)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          className="btn-danger btn-sm flex-1"
          disabled={busy || reason.trim().length < 10}
          onClick={() => onCall({ action: "REOPEN", reason })}
        >
          Xác nhận mở lại
        </button>
        <button className="btn-ghost btn-sm" onClick={() => setOpen(false)}>
          Huỷ
        </button>
      </div>
    </div>
  );
}
