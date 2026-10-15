"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui";
import ConfirmDialog from "@/components/confirm-dialog";
import VnNumberInput from "@/components/vn-number-input";
import { toast } from "@/components/toast";
import { fmtKg, fmtNum, fmtPct, fmtVnd } from "@/lib/format";

type Sku = {
  id: string;
  skuCode: string;
  skuName: string;
  targetOutputKg: number;
  stdMaterialLossRate: number;
  stdKgPerLaborHour: number;
  /** null = người xem không có quyền xem tiền */
  unitPriceVnd: number | null;
  isActive: boolean;
  shiftCount: number;
  rawMaterialId: string | null;
  rawMaterialName: string | null;
};

type RawMaterialOption = { id: string; code: string; name: string };

export default function SkuManager({
  skus,
  canEdit,
  showMoney,
  rawMaterials,
}: {
  skus: Sku[];
  canEdit: boolean;
  showMoney: boolean;
  rawMaterials: RawMaterialOption[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Bản nháp của dòng đang sửa — chỉ gửi khi bấm Lưu (trước đây gửi ngay khi
  // rời ô / đổi lựa chọn, bấm Huỷ ở prompt thì ô vẫn hiện số mới như đã lưu).
  const [draft, setDraft] = useState<{ targetOutputKg: number | null; rawMaterialId: string }>({
    targetOutputKg: null,
    rawMaterialId: "",
  });
  const [confirm, setConfirm] = useState<
    | { kind: "save"; sku: Sku }
    | { kind: "toggle"; sku: Sku }
    | null
  >(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  function startEdit(sku: Sku) {
    setDraft({
      targetOutputKg: sku.targetOutputKg,
      rawMaterialId: sku.rawMaterialId ?? "",
    });
    setEditing(sku.id);
  }

  const EMPTY_FORM = {
    skuCode: "",
    skuName: "",
    targetOutputKg: 500 as number | null,
    stdMaterialLossRate: 8 as number | null,
    stdKgPerLaborHour: 0,
    unitPriceVnd: 0 as number | null,
  };
  const [f, setF] = useState(EMPTY_FORM);
  // Ô số đang gõ sai (chữ, số âm) — chặn tạo mã
  const [badNum, setBadNum] = useState<Record<string, boolean>>({});
  const formInvalid = Object.values(badNum).some(Boolean);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/production/skus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...f,
          skuCode: f.skuCode.toUpperCase(),
          targetOutputKg: f.targetOutputKg ?? 0,
          stdMaterialLossRate: f.stdMaterialLossRate ?? 0,
          unitPriceVnd: Math.round(f.unitPriceVnd ?? 0),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message);
        return;
      }
      setAdding(false);
      toast(`Đã tạo mã ${f.skuCode.toUpperCase()}.`);
      setF(EMPTY_FORM);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  /** Trả về thông báo lỗi, null = thành công. */
  async function patch(
    id: string,
    payload: Record<string, unknown>
  ): Promise<string | null> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/production/skus?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return data.message || "Không lưu được.";
      setEditing(null);
      toast("Đã lưu mã sản phẩm.");
      router.refresh();
      return null;
    } catch {
      return "Mất kết nối tới máy chủ. Kiểm tra mạng rồi thử lại.";
    } finally {
      setBusy(false);
    }
  }

  async function runConfirm(reason: string) {
    if (!confirm) return;
    const sku = confirm.sku;
    let payload: Record<string, unknown>;
    if (confirm.kind === "toggle") {
      payload = { isActive: !sku.isActive };
    } else {
      payload = {};
      const t = draft.targetOutputKg ?? 0;
      if (t !== sku.targetOutputKg) {
        payload.targetOutputKg = t;
        payload.reason = reason;
      }
      if ((draft.rawMaterialId || null) !== sku.rawMaterialId) {
        payload.rawMaterialId = draft.rawMaterialId || null;
      }
    }
    const err = await patch(sku.id, payload);
    if (err) {
      setDialogError(err);
      return;
    }
    setConfirm(null);
  }

  const editingSku = skus.find((x) => x.id === editing) ?? null;
  const draftTarget = draft.targetOutputKg ?? 0;
  const draftValid = draft.targetOutputKg !== null && draftTarget > 0;
  const targetChanged = !!editingSku && draftValid && draftTarget !== editingSku.targetOutputKg;
  const materialChanged =
    !!editingSku && (draft.rawMaterialId || null) !== editingSku.rawMaterialId;

  const norm = (target: number, loss: number) =>
    Math.round(target * (1 + loss / 100) * 100) / 100;

  return (
    <>
      {canEdit && (
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm text-ink-500 tabular-nums">
            {fmtNum(skus.length)} mã sản phẩm
          </div>
          <button
            className="btn-primary btn-sm"
            onClick={() => setAdding(!adding)}
          >
            {adding ? (
              "Đóng"
            ) : (
              <>
                <Plus size={16} aria-hidden /> Thêm mã sản phẩm
              </>
            )}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        busy={busy}
        error={dialogError}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirm}
        tone={confirm?.kind === "toggle" && confirm.sku.isActive ? "danger" : "primary"}
        title={
          !confirm
            ? ""
            : confirm.kind === "toggle"
              ? `${confirm.sku.isActive ? "Ngưng" : "Dùng lại"} mã ${confirm.sku.skuCode}?`
              : `Lưu chuẩn mới cho ${confirm.sku.skuCode}?`
        }
        confirmLabel={
          confirm?.kind === "toggle"
            ? confirm.sku.isActive
              ? "Ngưng mã này"
              : "Dùng lại"
            : "Lưu chuẩn"
        }
        reason={
          confirm?.kind === "save" && targetChanged
            ? {
                label: "Lý do đổi sản lượng chuẩn",
                placeholder: "Ví dụ: thay máy hút chân không mới, công suất 60 kg/giờ",
                minLength: 10,
              }
            : undefined
        }
      >
        {confirm?.kind === "toggle" &&
          (confirm.sku.isActive ? (
            <p>
              Mã ngưng dùng sẽ không chọn được khi khai ca mới. Các ca đã khai
              giữ nguyên số liệu.
            </p>
          ) : (
            <p>Mã này sẽ chọn lại được khi khai ca.</p>
          ))}
        {confirm?.kind === "save" && (
          <ul className="space-y-1">
            {targetChanged && (
              <li>
                Sản lượng chuẩn: <b>{fmtKg(confirm.sku.targetOutputKg, { unit: "kg" })}</b> →{" "}
                <b>{fmtKg(draftTarget, { unit: "kg" })}</b> mỗi ca. Đây là thước đo chấm điểm cho cả
                xưởng — các ca khai từ nay dùng chuẩn mới.
              </li>
            )}
            {materialChanged && (
              <li>
                Nguyên liệu trừ kho:{" "}
                <b>{confirm.sku.rawMaterialName ?? "chưa gán"}</b> →{" "}
                <b>
                  {rawMaterials.find((m) => m.id === draft.rawMaterialId)?.name ??
                    "không trừ kho"}
                </b>
              </li>
            )}
          </ul>
        )}
      </ConfirmDialog>

      {error && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {adding && (
        <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-3">
          <div>
            <label className="label">Mã SKU</label>
            <input
              className="input uppercase"
              value={f.skuCode}
              onChange={(e) =>
                setF({ ...f, skuCode: e.target.value.toUpperCase() })
              }
              placeholder="CHA-UC-GA-500G"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Tên sản phẩm</label>
            <input
              className="input"
              value={f.skuName}
              onChange={(e) => setF({ ...f, skuName: e.target.value })}
              placeholder="Chả ức gà viên 500g"
            />
          </div>
          <div>
            <label className="label" htmlFor="sku-target">
              Sản lượng chuẩn (kg/ca)
            </label>
            <VnNumberInput
              id="sku-target"
              min={0}
              value={f.targetOutputKg}
              onValue={(n, bad) => {
                setF({ ...f, targetOutputKg: n });
                setBadNum((m) => ({ ...m, target: bad }));
              }}
            />
            <p className="mt-1 text-xs text-ink-500">
              Trần của xưởng HCM01 là 500 kg/ca (nút thắt máy hút chân không 50
              kg/giờ × 10 giờ).
            </p>
          </div>
          <div>
            <label className="label" htmlFor="sku-loss">
              Hao hụt định mức (%)
            </label>
            <VnNumberInput
              id="sku-loss"
              min={0}
              value={f.stdMaterialLossRate}
              onValue={(n, bad) => {
                setF({ ...f, stdMaterialLossRate: n });
                setBadNum((m) => ({ ...m, loss: bad }));
              }}
            />
            <p className="mt-1 text-xs text-ink-500">
              Định mức NVL ={" "}
              {fmtKg(norm(f.targetOutputKg ?? 0, f.stdMaterialLossRate ?? 0), { unit: "kg" })}
            </p>
          </div>
          {showMoney && (
          <div>
            <label className="label" htmlFor="sku-price">
              Đơn giá quy đổi (₫/kg)
            </label>
            <VnNumberInput
              id="sku-price"
              min={0}
              value={f.unitPriceVnd}
              onValue={(n, bad) => {
                setF({ ...f, unitPriceVnd: n === null ? null : Math.round(n) });
                setBadNum((m) => ({ ...m, price: bad }));
              }}
            />
            <p className="mt-1 text-xs text-ink-500">
              Dùng để quy tổn thất ra tiền. Chỉ BGĐ xem được số đó.
            </p>
          </div>
          )}
          <div className="sm:col-span-3">
            <button
              className="btn-primary"
              disabled={
                busy ||
                formInvalid ||
                !f.skuCode ||
                !f.skuName ||
                (f.targetOutputKg ?? 0) <= 0
              }
              onClick={create}
            >
              {busy ? "Đang lưu..." : "Tạo mã sản phẩm"}
            </button>
          </div>
        </div>
      )}

      {skus.length === 0 ? (
        <div className="card p-8 text-center text-ink-500">
          Chưa có mã sản phẩm nào. Phải có ít nhất một mã mới khai ca được.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="tbl tbl-stack">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Tên sản phẩm</th>
                <th className="text-right">Sản lượng chuẩn</th>
                <th className="text-right">Hao hụt ĐM</th>
                <th className="text-right">Định mức NVL</th>
                <th>NVL chính (kho)</th>
                {showMoney && <th className="text-right">Đơn giá</th>}
                <th className="text-right">Số ca</th>
                <th>Trạng thái</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {skus.map((s) => (
                <tr key={s.id} className={s.isActive ? "" : "opacity-50"}>
                  <td className="font-mono text-xs text-ink-600">{s.skuCode}</td>
                  <td data-label="Tên sản phẩm" className="font-medium text-ink-800">{s.skuName}</td>
                  <td data-label="Sản lượng chuẩn" className="text-right text-ink-700 tabular-nums">
                    {editing === s.id ? (
                      <VnNumberInput
                        min={0}
                        aria-label={`Sản lượng chuẩn của ${s.skuCode} (kg/ca)`}
                        className={`input w-28 py-1 text-right text-xs ${
                          draftValid ? "" : "border-red-300"
                        }`}
                        value={draft.targetOutputKg}
                        onValue={(n) => setDraft({ ...draft, targetOutputKg: n })}
                      />
                    ) : (
                      fmtKg(s.targetOutputKg)
                    )}
                  </td>
                  <td data-label="Hao hụt ĐM" className="text-right text-ink-700 tabular-nums">
                    {fmtPct(s.stdMaterialLossRate, { digits: 2 })}
                  </td>
                  <td data-label="Định mức NVL" className="text-right font-medium text-ink-900 tabular-nums">
                    {fmtKg(norm(s.targetOutputKg, s.stdMaterialLossRate))}
                  </td>
                  <td data-label="NVL chính (kho)">
                    {editing === s.id ? (
                      <select
                        className="input py-1 text-xs"
                        aria-label={`Nguyên liệu chính của ${s.skuCode}`}
                        value={draft.rawMaterialId}
                        onChange={(e) =>
                          setDraft({ ...draft, rawMaterialId: e.target.value })
                        }
                      >
                        <option value="">— Chưa gán, không trừ kho —</option>
                        {rawMaterials.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.code} — {m.name}
                          </option>
                        ))}
                      </select>
                    ) : s.rawMaterialName ? (
                      <span className="text-xs text-ink-600">
                        {s.rawMaterialName}
                      </span>
                    ) : (
                      <span className="text-xs text-ink-500">
                        chưa gán — không trừ kho
                      </span>
                    )}
                  </td>
                  {showMoney && (
                    <td data-label="Đơn giá" className="text-right text-ink-600 tabular-nums">
                      {fmtVnd(s.unitPriceVnd)}
                    </td>
                  )}
                  <td data-label="Số ca" className="text-right text-ink-600 tabular-nums">
                    {fmtNum(s.shiftCount)}
                  </td>
                  <td data-label="Trạng thái">
                    {s.isActive ? (
                      <Badge tone="green">Đang dùng</Badge>
                    ) : (
                      <Badge tone="slate">Ngưng</Badge>
                    )}
                  </td>
                  {canEdit && (
                    <td data-label="" className="whitespace-nowrap">
                      {editing === s.id ? (
                        <>
                          <button
                            className="btn-primary btn-sm"
                            disabled={busy || !draftValid || (!targetChanged && !materialChanged)}
                            onClick={() => {
                              setDialogError(null);
                              setConfirm({ kind: "save", sku: s });
                            }}
                          >
                            Lưu
                          </button>
                          <button
                            className="btn-ghost btn-sm ml-2"
                            onClick={() => setEditing(null)}
                          >
                            Huỷ
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="text-xs text-brand-700 hover:underline"
                            onClick={() => startEdit(s)}
                          >
                            Sửa chuẩn
                          </button>
                          <button
                            className={`ml-3 text-xs hover:underline ${
                              s.isActive ? "text-red-700" : "text-brand-700"
                            }`}
                            disabled={busy}
                            onClick={() => {
                              setDialogError(null);
                              setConfirm({ kind: "toggle", sku: s });
                            }}
                          >
                            {s.isActive ? "Ngưng" : "Dùng lại"}
                          </button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
