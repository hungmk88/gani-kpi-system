"use client";

import { useMemo, useState } from "react";
import { vnDateKey } from "@/lib/vn-time";
import { useRouter } from "next/navigation";
import {
  PRODUCTION_ROLE_LABEL,
  PRODUCTION_STAGES,
  SHIFT_TYPES,
  SHIFT_TYPE_LABEL,
  STAGE_LABEL,
} from "@/lib/production/constants";

type Sku = {
  id: string;
  skuCode: string;
  skuName: string;
  targetOutputKg: number;
  stdMaterialLossRate: number;
};

type Person = {
  id: string;
  name: string;
  role: string | null;
  jobTitle: string;
};

type Row = {
  userId: string;
  stage: string;
  hoursWorked: string;
  scheduledHours: string;
};

export default function ShiftDraftForm({
  skus,
  staff,
}: {
  skus: Sku[];
  staff: Person[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [shiftDate, setShiftDate] = useState(today());
  const [shiftType, setShiftType] = useState<string>("CA_1");
  const [skuId, setSkuId] = useState(skus[0]?.id ?? "");
  const [rawOutputKg, setRawOutputKg] = useState("");
  const [rawMaterialInputKg, setRawMaterialInputKg] = useState("");
  const [downtimeHours, setDowntimeHours] = useState("0");
  const [draftNote, setDraftNote] = useState("");
  const [rows, setRows] = useState<Row[]>([
    { userId: "", stage: "DONG_GOI", hoursWorked: "10", scheduledHours: "10" },
  ]);

  const sku = skus.find((s) => s.id === skuId);

  // Chỉ cộng giờ của các dòng thực sự gửi lên (đã chọn người, giờ > 0) — nếu
  // cộng cả dòng trống thì tổng giờ lệch với danh sách người và server từ chối.
  const totalLaborHours = useMemo(
    () =>
      rows
        .filter((r) => r.userId && Number(r.hoursWorked) > 0)
        .reduce((s, r) => s + (Number(r.hoursWorked) || 0), 0),
    [rows]
  );

  // Định mức NVL chuẩn tính theo chuẩn của SKU — cho người khai thấy trước
  // để biết mình đang dùng nhiều hay ít hơn định mức.
  const stdNorm = sku
    ? Math.round(sku.targetOutputKg * (1 + sku.stdMaterialLossRate / 100) * 100) /
      100
    : 0;
  const nvl = Number(rawMaterialInputKg) || 0;
  const overrun = nvl > 0 ? Math.round((nvl - stdNorm) * 100) / 100 : 0;

  const validRows = rows.filter((r) => r.userId && Number(r.hoursWorked) > 0);
  const dupUser =
    new Set(validRows.map((r) => r.userId)).size !== validRows.length;

  const canSubmit =
    !!skuId &&
    Number(rawOutputKg) > 0 &&
    validRows.length > 0 &&
    !dupUser &&
    totalLaborHours > 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/production/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Gửi nguyên "YYYY-MM-DD" — server quy về 00:00 giờ VN của ngày ca.
          shiftDate,
          shiftType,
          skuId,
          rawOutputKg: Number(rawOutputKg),
          totalLaborHours,
          downtimeHours: Number(downtimeHours) || 0,
          rawMaterialInputKg: Number(rawMaterialInputKg) || 0,
          draftNote: draftNote || undefined,
          participants: validRows.map((r) => ({
            userId: r.userId,
            stage: r.stage,
            hoursWorked: Number(r.hoursWorked),
            scheduledHours: Number(r.scheduledHours) || 0,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Không lưu được ca.");
        return;
      }
      router.push(`/production/${data.shift.id}`);
      router.refresh();
    } catch {
      setError("Mất kết nối tới máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      {/* ---------------- Thông tin ca ---------------- */}
      <div className="card p-5">
        <h3 className="section-title mb-3">1. Ca nào, làm mã gì</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label">Ngày sản xuất</label>
            <input
              type="date"
              className="input"
              value={shiftDate}
              onChange={(e) => setShiftDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Ca</label>
            <select
              className="input"
              value={shiftType}
              onChange={(e) => setShiftType(e.target.value)}
            >
              {SHIFT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SHIFT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Mã sản phẩm</label>
            <select
              className="input"
              value={skuId}
              onChange={(e) => setSkuId(e.target.value)}
            >
              {skus.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.skuCode} — {s.skuName}
                </option>
              ))}
            </select>
          </div>
        </div>

        {sku && (
          <div className="mt-3 rounded-lg border border-ink-200 bg-ink-50/60 px-3 py-2 text-xs text-ink-600">
            Chuẩn của mã này: sản lượng <b>{sku.targetOutputKg} kg/ca</b>, hao hụt
            định mức <b>{sku.stdMaterialLossRate}%</b> → định mức nguyên liệu{" "}
            <b>{stdNorm} kg</b>.
          </div>
        )}
      </div>

      {/* ---------------- Số liệu sản xuất ---------------- */}
      <div className="card p-5">
        <h3 className="section-title mb-3">2. Số liệu sản xuất khai</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label">Sản lượng thô (kg)</label>
            <input
              type="number"
              step="any"
              className="input"
              value={rawOutputKg}
              onChange={(e) => setRawOutputKg(e.target.value)}
              placeholder="vd 1030"
            />
            <p className="mt-1 text-[11px] text-ink-500">
              Toàn bộ hàng ra khỏi chuyền, chưa phân loại đạt hay hỏng.
            </p>
          </div>
          <div>
            <label className="label">Nguyên liệu kho cấp (kg)</label>
            <input
              type="number"
              step="any"
              className="input"
              value={rawMaterialInputKg}
              onChange={(e) => setRawMaterialInputKg(e.target.value)}
              placeholder="vd 1120"
            />
            {nvl > 0 && stdNorm > 0 && (
              <p
                className={`mt-1 text-[11px] ${
                  overrun > 0 ? "text-amber-700" : "text-emerald-700"
                }`}
              >
                {overrun > 0
                  ? `Vượt định mức ${overrun} kg`
                  : `Dưới định mức ${Math.abs(overrun)} kg`}
              </p>
            )}
          </div>
          <div>
            <label className="label">Giờ dừng máy</label>
            <input
              type="number"
              step="any"
              className="input"
              value={downtimeHours}
              onChange={(e) => setDowntimeHours(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="label">Ghi chú của ca (tuỳ chọn)</label>
          <input
            className="input"
            placeholder="Ví dụ: lô thịt đông rã nước nhiều hơn thường lệ"
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
          />
        </div>
      </div>

      {/* ---------------- Người làm ca ---------------- */}
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="section-title">3. Ai làm ca này</h3>
          <span className="text-xs text-ink-500">
            Tổng giờ công: <b className="text-ink-800">{totalLaborHours}</b>
          </span>
        </div>

        <p className="mb-3 text-xs text-ink-500">
          Không khai người thì hệ thống không biết chấm điểm cho ai. Giờ công còn
          dùng làm mẫu số khi tính tỷ lệ lỗi công đoạn — làm 10 giờ mà lỗi 2 kg
          khác hẳn làm 2 giờ mà lỗi 2 kg.
        </p>

        <div className="space-y-2">
          {rows.map((r, i) => (
            <div
              key={i}
              className="grid gap-2 rounded-lg border border-ink-200 p-2 sm:grid-cols-[2fr_1.3fr_0.8fr_0.8fr_auto]"
            >
              <select
                className="input"
                value={r.userId}
                onChange={(e) => update(i, { userId: e.target.value })}
              >
                <option value="">— Chọn người —</option>
                {staff.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.role ? ` — ${PRODUCTION_ROLE_LABEL[p.role]}` : ""}
                  </option>
                ))}
              </select>
              <select
                className="input"
                value={r.stage}
                onChange={(e) => update(i, { stage: e.target.value })}
              >
                {PRODUCTION_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABEL[s]}
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="any"
                className="input"
                value={r.hoursWorked}
                onChange={(e) => update(i, { hoursWorked: e.target.value })}
                placeholder="Giờ làm"
                title="Giờ công thực tế"
              />
              <input
                type="number"
                step="any"
                className="input"
                value={r.scheduledHours}
                onChange={(e) => update(i, { scheduledHours: e.target.value })}
                placeholder="Giờ đăng ký"
                title="Giờ công đăng ký — dùng để tính chuyên cần"
              />
              <button
                className="btn-ghost btn-sm"
                onClick={() => setRows(rows.filter((_, x) => x !== i))}
                disabled={rows.length === 1}
              >
                Bỏ
              </button>
            </div>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            className="btn-ghost btn-sm"
            onClick={() =>
              setRows([
                ...rows,
                {
                  userId: "",
                  stage: "DONG_GOI",
                  hoursWorked: "10",
                  scheduledHours: "10",
                },
              ])
            }
          >
            + Thêm người
          </button>
          <span className="text-[11px] text-ink-500">
            Cột thứ 3 là giờ làm thực tế, cột thứ 4 là giờ đăng ký.
          </span>
        </div>

        {dupUser && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Có người bị khai hai lần trong cùng một ca.
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={busy || !canSubmit} onClick={submit}>
          {busy ? "Đang lưu..." : "Gửi cho KCS xác nhận"}
        </button>
        <button className="btn-ghost" onClick={() => router.back()}>
          Huỷ
        </button>
        {!canSubmit && (
          <span className="self-center text-xs text-ink-500">
            {Number(rawOutputKg) <= 0
              ? "Chưa nhập sản lượng thô."
              : validRows.length === 0
                ? "Chưa khai người làm ca."
                : dupUser
                  ? "Có người bị khai trùng."
                  : ""}
          </span>
        )}
      </div>
    </div>
  );

  function update(i: number, patch: Partial<Row>) {
    setRows(rows.map((r, x) => (x === i ? { ...r, ...patch } : r)));
  }
}

/** Hôm nay theo lịch VN — không theo múi giờ của trình duyệt. */
function today() {
  return vnDateKey(new Date());
}
