"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";

type Sku = {
  id: string;
  skuCode: string;
  skuName: string;
  targetOutputKg: number;
  stdMaterialLossRate: number;
  stdKgPerLaborHour: number;
  unitPriceVnd: number;
  isActive: boolean;
  shiftCount: number;
  rawMaterialId: string | null;
  rawMaterialName: string | null;
};

type RawMaterialOption = { id: string; code: string; name: string };

export default function SkuManager({
  skus,
  canEdit,
  rawMaterials,
}: {
  skus: Sku[];
  canEdit: boolean;
  rawMaterials: RawMaterialOption[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const [f, setF] = useState({
    skuCode: "",
    skuName: "",
    targetOutputKg: 500,
    stdMaterialLossRate: 8,
    stdKgPerLaborHour: 0,
    unitPriceVnd: 0,
  });

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/production/skus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, skuCode: f.skuCode.toUpperCase() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message);
        return;
      }
      setAdding(false);
      setF({
        skuCode: "",
        skuName: "",
        targetOutputKg: 500,
        stdMaterialLossRate: 8,
        stdKgPerLaborHour: 0,
        unitPriceVnd: 0,
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/production/skus?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message);
        return;
      }
      setEditing(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const norm = (target: number, loss: number) =>
    Math.round(target * (1 + loss / 100) * 100) / 100;

  return (
    <>
      {canEdit && (
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm text-ink-500">{skus.length} mã sản phẩm</div>
          <button
            className="btn-primary btn-sm"
            onClick={() => setAdding(!adding)}
          >
            {adding ? "Đóng" : "+ Thêm mã sản phẩm"}
          </button>
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
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
            <label className="label">Sản lượng chuẩn (kg/ca)</label>
            <input
              type="number"
              step="any"
              className="input"
              value={f.targetOutputKg}
              onChange={(e) =>
                setF({ ...f, targetOutputKg: Number(e.target.value) })
              }
            />
            <p className="mt-1 text-[11px] text-ink-500">
              Trần của xưởng HCM01 là 500 kg/ca (nút thắt máy hút chân không 50
              kg/giờ × 10 giờ).
            </p>
          </div>
          <div>
            <label className="label">Hao hụt định mức (%)</label>
            <input
              type="number"
              step="any"
              className="input"
              value={f.stdMaterialLossRate}
              onChange={(e) =>
                setF({ ...f, stdMaterialLossRate: Number(e.target.value) })
              }
            />
            <p className="mt-1 text-[11px] text-ink-500">
              Định mức NVL = {norm(f.targetOutputKg, f.stdMaterialLossRate)} kg
            </p>
          </div>
          <div>
            <label className="label">Đơn giá quy đổi (₫/kg)</label>
            <input
              type="number"
              step="any"
              className="input"
              value={f.unitPriceVnd}
              onChange={(e) =>
                setF({ ...f, unitPriceVnd: Number(e.target.value) })
              }
            />
            <p className="mt-1 text-[11px] text-ink-500">
              Dùng để quy tổn thất ra tiền. Chỉ BGĐ xem được số đó.
            </p>
          </div>
          <div className="sm:col-span-3">
            <button
              className="btn-primary"
              disabled={busy || !f.skuCode || !f.skuName || f.targetOutputKg <= 0}
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
          <table className="tbl">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Tên sản phẩm</th>
                <th className="text-right">Sản lượng chuẩn</th>
                <th className="text-right">Hao hụt ĐM</th>
                <th className="text-right">Định mức NVL</th>
                <th>NVL chính (kho)</th>
                <th className="text-right">Đơn giá</th>
                <th className="text-right">Số ca</th>
                <th>Trạng thái</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {skus.map((s) => (
                <tr key={s.id} className={s.isActive ? "" : "opacity-50"}>
                  <td className="font-mono text-xs text-ink-600">{s.skuCode}</td>
                  <td className="font-medium text-ink-800">{s.skuName}</td>
                  <td className="text-right text-ink-700">
                    {editing === s.id ? (
                      <input
                        type="number"
                        step="any"
                        className="input w-24 py-1 text-right text-xs"
                        defaultValue={s.targetOutputKg}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (v !== s.targetOutputKg) {
                            const reason = prompt(
                              `Đổi sản lượng chuẩn của ${s.skuCode} từ ${s.targetOutputKg} sang ${v} kg.\n\nĐây là thước đo chấm điểm cho cả xưởng — ghi lý do:`
                            );
                            if (reason) {
                              patch(s.id, { targetOutputKg: v, reason });
                            }
                          }
                        }}
                      />
                    ) : (
                      `${s.targetOutputKg} kg`
                    )}
                  </td>
                  <td className="text-right text-ink-700">
                    {s.stdMaterialLossRate}%
                  </td>
                  <td className="text-right font-medium text-ink-900">
                    {norm(s.targetOutputKg, s.stdMaterialLossRate)} kg
                  </td>
                  <td>
                    {editing === s.id ? (
                      <select
                        className="input py-1 text-xs"
                        defaultValue={s.rawMaterialId ?? ""}
                        onChange={(e) =>
                          patch(s.id, { rawMaterialId: e.target.value || null })
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
                      <span className="text-xs text-ink-400">
                        chưa gán — không trừ kho
                      </span>
                    )}
                  </td>
                  <td className="text-right text-ink-600">
                    {new Intl.NumberFormat("vi-VN").format(s.unitPriceVnd)} ₫
                  </td>
                  <td className="text-right text-ink-600">{s.shiftCount}</td>
                  <td>
                    {s.isActive ? (
                      <Badge tone="green">Đang dùng</Badge>
                    ) : (
                      <Badge tone="slate">Ngưng</Badge>
                    )}
                  </td>
                  {canEdit && (
                    <td className="whitespace-nowrap">
                      <button
                        className="text-xs text-brand-600 hover:underline"
                        onClick={() =>
                          setEditing(editing === s.id ? null : s.id)
                        }
                      >
                        {editing === s.id ? "Xong" : "Sửa chuẩn"}
                      </button>
                      <button
                        className={`ml-3 text-xs hover:underline ${
                          s.isActive ? "text-red-600" : "text-emerald-600"
                        }`}
                        disabled={busy}
                        onClick={() => patch(s.id, { isActive: !s.isActive })}
                      >
                        {s.isActive ? "Ngưng" : "Dùng lại"}
                      </button>
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
