"use client";

import { fetchJson } from "@/lib/fetch-json";
import { useRef, useState } from "react";
import { vnDateKey } from "@/lib/vn-time";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import {
  PRODUCTION_ROLE_LABEL,
  PRODUCTION_STAGES,
  SHIFT_TYPES,
  SHIFT_TYPE_LABEL,
  STAGE_LABEL,
} from "@/lib/production/constants";
import { fmtKg, fmtNum, fmtPct } from "@/lib/format";
import VnNumberInput from "@/components/vn-number-input";
import StickyActions from "@/components/sticky-actions";
import { toast } from "@/components/toast";

/** Giờ công một người một ca — cùng trần với máy chủ (draft-schema) */
const MAX_HOURS_PER_PERSON = 24;

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
  /** Khoá ổn định cho React — ô số giữ chữ đang gõ, xoá dòng giữa không làm lệch */
  key: number;
  userId: string;
  stage: string;
  hoursWorked: number | null;
  scheduledHours: number | null;
};

/** Giá trị có sẵn khi sửa ca bị KCS trả về */
export type ShiftDraftInitial = {
  shiftId: string;
  shiftDate: string;
  shiftType: string;
  skuId: string;
  rawOutputKg: number;
  rawMaterialInputKg: number;
  downtimeHours: number;
  draftNote: string;
  rows: { userId: string; stage: string; hoursWorked: number; scheduledHours: number }[];
};

// Khoá dòng đánh số trong từng form (không dùng bộ đếm toàn cục: máy chủ và
// trình duyệt phải ra cùng id ô khi hydrate).
const newRow = (key: number, r: Partial<Omit<Row, "key">> = {}): Row => ({
  key,
  userId: "",
  stage: "DONG_GOI",
  hoursWorked: 10,
  scheduledHours: 10,
  ...r,
});

export default function ShiftDraftForm({
  skus,
  staff,
  initial,
}: {
  skus: Sku[];
  staff: Person[];
  /** Có = chế độ sửa ca bị trả về (PUT), không có = khai ca mới (POST) */
  initial?: ShiftDraftInitial;
}) {
  const router = useRouter();
  const editing = !!initial;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Chỉ hiện lỗi từng ô sau lần bấm gửi đầu tiên — form mới mở không đỏ lòm
  const [tried, setTried] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const [shiftDate, setShiftDate] = useState(initial?.shiftDate ?? today());
  const [shiftType, setShiftType] = useState<string>(initial?.shiftType ?? "CA_1");
  // Không chọn sẵn mã đầu danh sách: chọn nhầm mã là sai cả chuẩn sản lượng
  // lẫn định mức NVL của ca — bắt người khai chọn có chủ đích.
  const [skuId, setSkuId] = useState(
    initial && skus.some((s) => s.id === initial.skuId) ? initial.skuId : ""
  );
  const [rawOutputKg, setRawOutputKg] = useState<number | null>(initial?.rawOutputKg ?? null);
  const [rawMaterialInputKg, setRawMaterialInputKg] = useState<number | null>(
    initial?.rawMaterialInputKg ?? null
  );
  const [downtimeHours, setDowntimeHours] = useState<number | null>(
    initial?.downtimeHours ?? 0
  );
  const [draftNote, setDraftNote] = useState(initial?.draftNote ?? "");
  const [rows, setRows] = useState<Row[]>(() =>
    initial && initial.rows.length > 0
      ? initial.rows.map((r, i) => newRow(i + 1, r))
      : [newRow(1)]
  );
  const nextKey = useRef(Math.max(1, initial?.rows.length ?? 0) + 1);
  // Ô số nào đang gõ sai (chữ, số âm) — theo id ô
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const mark = (id: string, bad: boolean) =>
    setInvalid((m) => (m[id] === bad ? m : { ...m, [id]: bad }));

  const sku = skus.find((s) => s.id === skuId);

  // Dòng thực sự gửi lên: đã chọn người. Dòng trống (chưa chọn người) bỏ qua.
  const filledRows = rows.filter((r) => r.userId);
  const validRows = filledRows.filter((r) => (r.hoursWorked ?? 0) > 0);
  // Chỉ cộng giờ của các dòng thực sự gửi lên — nếu cộng cả dòng trống thì
  // tổng giờ lệch với danh sách người và server từ chối.
  const totalLaborHours = validRows.reduce((s, r) => s + (r.hoursWorked ?? 0), 0);

  // Định mức NVL chuẩn tính theo chuẩn của SKU — cho người khai thấy trước
  // để biết mình đang dùng nhiều hay ít hơn định mức.
  const stdNorm = sku
    ? Math.round(sku.targetOutputKg * (1 + sku.stdMaterialLossRate / 100) * 100) /
      100
    : 0;
  const nvl = rawMaterialInputKg ?? 0;
  const overrun = nvl > 0 ? Math.round((nvl - stdNorm) * 100) / 100 : 0;

  const dupUser =
    new Set(filledRows.map((r) => r.userId)).size !== filledRows.length;
  const missingHours = filledRows.length - validRows.length;
  const overHours = filledRows.some(
    (r) =>
      (r.hoursWorked ?? 0) > MAX_HOURS_PER_PERSON ||
      (r.scheduledHours ?? 0) > MAX_HOURS_PER_PERSON
  );
  const anyInvalid = Object.values(invalid).some(Boolean);

  // Lỗi theo từng ô — hiện ngay dưới ô đó sau lần bấm gửi đầu tiên
  const fieldErr = {
    shiftDate: !shiftDate ? "Chọn ngày sản xuất." : null,
    sku: !skuId ? "Chọn mã sản phẩm của ca." : null,
    rawOutput:
      invalid.rawOutput
        ? "Sản lượng thô phải là số không âm."
        : (rawOutputKg ?? 0) <= 0
          ? "Nhập sản lượng thô (lớn hơn 0)."
          : null,
    rows:
      validRows.length === 0
        ? "Khai ít nhất một người làm ca: chọn người và nhập giờ làm."
        : dupUser
          ? "Có người bị khai hai lần trong cùng một ca."
          : missingHours > 0
            ? `Có ${missingHours} người chưa nhập giờ làm (phải lớn hơn 0).`
            : overHours
              ? `Giờ làm / giờ đăng ký của một người tối đa ${MAX_HOURS_PER_PERSON} giờ.`
              : null,
    numbers: anyInvalid ? "Có ô số chưa hợp lệ (đang tô đỏ) — sửa lại trước khi gửi." : null,
  };
  const firstErr = Object.values(fieldErr).find(Boolean) ?? null;

  async function submit() {
    if (firstErr) {
      setTried(true);
      // Đưa người dùng tới ô lỗi đầu tiên thay vì để họ dò cả form
      requestAnimationFrame(() => {
        formRef.current
          ?.querySelector<HTMLElement>("[data-field-error]")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetchJson<{ shift?: { id: string } }>(
        editing ? `/api/production/shifts/${initial!.shiftId}` : "/api/production/shifts",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // Gửi nguyên "YYYY-MM-DD" — server quy về 00:00 giờ VN của ngày ca.
            shiftDate,
            shiftType,
            skuId,
            rawOutputKg: rawOutputKg ?? 0,
            totalLaborHours,
            downtimeHours: downtimeHours ?? 0,
            rawMaterialInputKg: rawMaterialInputKg ?? 0,
            draftNote: draftNote.trim() || undefined,
            participants: validRows.map((r) => ({
              userId: r.userId,
              stage: r.stage,
              hoursWorked: r.hoursWorked ?? 0,
              scheduledHours: r.scheduledHours ?? 0,
            })),
          }),
        }
      );
      if (!res.ok) {
        setError(res.message ?? "Không lưu được ca.");
        return;
      }
      toast(
        editing
          ? "Đã gửi lại ca — KCS nhận thông báo xác nhận lại."
          : "Đã khai ca — KCS nhận thông báo vào xác nhận."
      );
      router.push(`/production/${editing ? initial!.shiftId : res.data.shift!.id}`);
      router.refresh();
    } catch {
      setError("Mất kết nối tới máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={formRef} className="max-w-3xl space-y-4">
      {/* ---------------- Thông tin ca ---------------- */}
      <div className="card p-5">
        <h3 className="section-title mb-3">1. Ca nào, làm mã gì</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="draft-date">
              Ngày sản xuất
            </label>
            <input
              id="draft-date"
              type="date"
              className="input"
              value={shiftDate}
              onChange={(e) => setShiftDate(e.target.value)}
            />
            <FieldError show={tried} msg={fieldErr.shiftDate} />
          </div>
          <div>
            <label className="label" htmlFor="draft-shift">
              Ca
            </label>
            <select
              id="draft-shift"
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
            <label className="label" htmlFor="draft-sku">
              Mã sản phẩm
            </label>
            <select
              id="draft-sku"
              className={`input ${tried && fieldErr.sku ? "border-red-600" : ""}`}
              value={skuId}
              aria-invalid={(tried && !!fieldErr.sku) || undefined}
              onChange={(e) => setSkuId(e.target.value)}
            >
              <option value="">— Chọn mã sản phẩm —</option>
              {skus.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.skuCode} — {s.skuName}
                </option>
              ))}
            </select>
            <FieldError show={tried} msg={fieldErr.sku} />
          </div>
        </div>

        {sku && (
          <div className="mt-3 rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-600 tabular-nums">
            Chuẩn của mã này: sản lượng{" "}
            <b>{fmtKg(sku.targetOutputKg, { unit: "kg" })}/ca</b>, hao hụt định mức{" "}
            <b>{fmtPct(sku.stdMaterialLossRate, { digits: 2 })}</b> → định mức nguyên
            liệu <b>{fmtKg(stdNorm, { unit: "kg" })}</b>.
          </div>
        )}
      </div>

      {/* ---------------- Số liệu sản xuất ---------------- */}
      <div className="card p-5">
        <h3 className="section-title mb-3">2. Số liệu sản xuất khai</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="draft-raw">
              Sản lượng thô (kg)
            </label>
            <VnNumberInput
              id="draft-raw"
              min={0}
              value={rawOutputKg}
              placeholder="vd 1.030"
              onValue={(n, bad) => {
                setRawOutputKg(n);
                mark("rawOutput", bad);
              }}
            />
            <FieldError show={tried} msg={fieldErr.rawOutput} />
            <p className="mt-1 text-xs text-ink-500">
              Toàn bộ hàng ra khỏi chuyền, chưa phân loại đạt hay hỏng.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="draft-nvl">
              Nguyên liệu kho cấp (kg)
            </label>
            <VnNumberInput
              id="draft-nvl"
              min={0}
              value={rawMaterialInputKg}
              placeholder="vd 1.120"
              onValue={(n, bad) => {
                setRawMaterialInputKg(n);
                mark("nvl", bad);
              }}
            />
            {nvl > 0 && stdNorm > 0 && (
              <p
                className={`mt-1 text-xs ${
                  overrun > 0 ? "text-amber-800" : "text-ink-500"
                }`}
              >
                {overrun > 0
                  ? `Vượt định mức ${fmtKg(overrun, { unit: "kg" })}`
                  : `Dưới định mức ${fmtKg(Math.abs(overrun), { unit: "kg" })}`}
              </p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="draft-downtime">
              Giờ dừng máy (giờ)
            </label>
            <VnNumberInput
              id="draft-downtime"
              min={0}
              value={downtimeHours}
              placeholder="0"
              onValue={(n, bad) => {
                setDowntimeHours(n);
                mark("downtime", bad);
              }}
            />
            <p className="mt-1 text-xs text-ink-500">
              Tổng thời gian chuyền phải dừng (hỏng máy, chờ nguyên liệu).
            </p>
          </div>
        </div>

        <div className="mt-4">
          <label className="label" htmlFor="draft-note">
            Ghi chú của ca (tuỳ chọn)
          </label>
          <input
            id="draft-note"
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
            Tổng giờ công:{" "}
            <b className="text-ink-800 tabular-nums">{fmtNum(totalLaborHours)} giờ</b>
          </span>
        </div>

        <p className="mb-3 text-xs text-ink-500">
          Không khai người thì hệ thống không biết chấm điểm cho ai. Giờ công còn
          dùng làm mẫu số khi tính tỷ lệ lỗi công đoạn — làm 10 giờ mà lỗi 2 kg
          khác hẳn làm 2 giờ mà lỗi 2 kg.
        </p>

        {/* Tiêu đề cột trên màn rộng; điện thoại thì mỗi ô có nhãn riêng */}
        <div className="mb-1 hidden gap-2 px-2 text-xs font-medium text-ink-500 sm:grid sm:grid-cols-[2fr_1.3fr_0.9fr_0.9fr_auto]">
          <div>Người làm</div>
          <div>Công đoạn</div>
          <div>Giờ làm thực tế</div>
          <div title="Giờ công đăng ký — dùng để tính chuyên cần">Giờ đăng ký (ĐK)</div>
          <div className="w-9" aria-hidden />
        </div>

        <div className="space-y-2">
          {rows.map((r, i) => (
            <div
              key={r.key}
              className="grid grid-cols-2 gap-2 rounded-md bg-ink-50 p-2 sm:grid-cols-[2fr_1.3fr_0.9fr_0.9fr_auto] sm:items-center"
            >
              <div className="col-span-2 sm:col-span-1">
                <label className="mb-0.5 block text-xs text-ink-500 sm:sr-only" htmlFor={`row-user-${r.key}`}>
                  Người làm
                </label>
                <select
                  id={`row-user-${r.key}`}
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
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="mb-0.5 block text-xs text-ink-500 sm:sr-only" htmlFor={`row-stage-${r.key}`}>
                  Công đoạn
                </label>
                <select
                  id={`row-stage-${r.key}`}
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
              </div>
              <div>
                <label className="mb-0.5 block text-xs text-ink-500 sm:sr-only" htmlFor={`row-hours-${r.key}`}>
                  Giờ làm thực tế (giờ)
                </label>
                <VnNumberInput
                  id={`row-hours-${r.key}`}
                  min={0}
                  value={r.hoursWorked}
                  placeholder="giờ"
                  onValue={(n, bad) => {
                    update(i, { hoursWorked: n });
                    mark(`h:${r.key}`, bad);
                  }}
                />
              </div>
              <div>
                <label className="mb-0.5 block text-xs text-ink-500 sm:sr-only" htmlFor={`row-sched-${r.key}`}>
                  Giờ đăng ký (giờ)
                </label>
                <VnNumberInput
                  id={`row-sched-${r.key}`}
                  min={0}
                  value={r.scheduledHours}
                  placeholder="giờ"
                  title="Giờ công đăng ký — dùng để tính chuyên cần"
                  onValue={(n, bad) => {
                    update(i, { scheduledHours: n });
                    mark(`s:${r.key}`, bad);
                  }}
                />
              </div>
              <button
                className="btn-ghost btn-sm col-span-2 inline-flex items-center justify-center gap-1 sm:col-span-1 sm:h-9 sm:w-9 sm:px-0"
                onClick={() => {
                  setRows(rows.filter((_, x) => x !== i));
                  // Ô của dòng đã xoá không còn tính là lỗi
                  setInvalid((m) => {
                    const rest = { ...m };
                    delete rest[`h:${r.key}`];
                    delete rest[`s:${r.key}`];
                    return rest;
                  });
                }}
                disabled={rows.length === 1}
                aria-label={`Bỏ dòng ${i + 1}`}
                title="Bỏ dòng này"
              >
                <Trash2 size={15} aria-hidden />
                <span className="sm:hidden">Bỏ dòng</span>
              </button>
            </div>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            className="btn-ghost btn-sm"
            onClick={() => setRows([...rows, newRow(nextKey.current++)])}
          >
            <Plus size={16} aria-hidden /> Thêm người
          </button>
          <span className="text-xs text-ink-500">
            Giờ làm thực tế so với giờ đăng ký (ĐK) ra điểm chuyên cần.
          </span>
        </div>

        <FieldError show={tried || dupUser} msg={fieldErr.rows} />
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {tried && firstErr && (
        <p className="text-sm text-red-700" role="alert">
          Chưa gửi được: {fieldErr.numbers ?? firstErr}
        </p>
      )}

      <StickyActions>
        <button className="btn-ghost" disabled={busy} onClick={() => router.back()}>
          Huỷ
        </button>
        <button className="btn-primary" disabled={busy} onClick={submit}>
          {busy ? "Đang lưu..." : editing ? "Gửi lại cho KCS" : "Gửi cho KCS xác nhận"}
        </button>
      </StickyActions>
    </div>
  );

  function update(i: number, patch: Partial<Row>) {
    setRows((cur) => cur.map((r, x) => (x === i ? { ...r, ...patch } : r)));
  }
}

/** Lỗi ngay dưới ô — chỉ hiện khi đã bấm gửi (hoặc lỗi hiển nhiên như trùng người) */
function FieldError({ show, msg }: { show: boolean; msg: string | null }) {
  if (!show || !msg) return null;
  return (
    <p data-field-error className="mt-1 text-xs text-red-700">
      {msg}
    </p>
  );
}

/** Hôm nay theo lịch VN — không theo múi giờ của trình duyệt. */
function today() {
  return vnDateKey(new Date());
}
