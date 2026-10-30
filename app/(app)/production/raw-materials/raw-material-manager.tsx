"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui";
import VnNumberInput from "@/components/vn-number-input";
import { toast } from "@/components/toast";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
// Đơn vị NVL do người dùng đặt (kg, lít, bao…) nên dùng fmtNum + đơn vị, không fmtKg
import { fmtDateTime, fmtNum } from "@/lib/format";

type Transaction = {
  id: string;
  type: string;
  quantityKg: number;
  balanceAfterKg: number;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
};

type Material = {
  id: string;
  code: string;
  name: string;
  unit: string;
  currentStockKg: number;
  isActive: boolean;
  transactions: Transaction[];
};

const TX_TYPE_LABEL: Record<string, string> = {
  STOCK_IN: "Nhập kho",
  SHIFT_DEDUCTION: "Trừ theo ca",
  ADJUSTMENT: "Chỉnh tay",
  SHIFT_REVERSAL: "Hoàn kho (mở lại ca)",
};

export default function RawMaterialManager({
  materials,
  canEdit,
}: {
  materials: Material[];
  canEdit: boolean;
}) {
  const router = useRouter();
  // Nhãn gắn với ô nhập (htmlFor) — bấm nhãn vào ô, trình đọc màn hình đọc đúng tên
  const fid = useId();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [txForm, setTxForm] = useState<string | null>(null);

  const [f, setF] = useState({
    code: "",
    name: "",
    unit: "kg",
    initialStockKg: 0 as number | null,
  });
  const [badStock, setBadStock] = useState(false);

  const [tf, setTf] = useState({
    action: "STOCK_IN" as "STOCK_IN" | "ADJUSTMENT",
    quantityKg: null as number | null,
    note: "",
  });
  const [badQty, setBadQty] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchJson(
        "/api/production/raw-materials",
        jsonInit("POST", {
          ...f,
          code: f.code.toUpperCase(),
          initialStockKg: f.initialStockKg ?? 0,
        })
      );
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setAdding(false);
      toast(`Đã tạo mã NVL ${f.code.toUpperCase()}.`);
      setF({ code: "", name: "", unit: "kg", initialStockKg: 0 });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(id: string, isActive: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/production/raw-materials/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || "Không đổi được trạng thái nguyên vật liệu.");
        return;
      }
      router.refresh();
    } catch {
      setError("Không kết nối được máy chủ, thử lại sau.");
    } finally {
      setBusy(false);
    }
  }

  async function submitTransaction(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchJson(
        `/api/production/raw-materials/${id}`,
        jsonInit("POST", {
          action: tf.action,
          quantityKg: tf.quantityKg ?? 0,
          note: tf.note || undefined,
        })
      );
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setTxForm(null);
      toast(tf.action === "STOCK_IN" ? "Đã ghi nhập kho." : "Đã ghi chỉnh tay tồn kho.");
      setTf({ action: "STOCK_IN", quantityKg: null, note: "" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {canEdit && (
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm text-ink-500 tabular-nums">
            {fmtNum(materials.length)} mã NVL
          </div>
          <button
            className="btn-primary btn-sm"
            onClick={() => setAdding(!adding)}
          >
            {adding ? (
              "Đóng"
            ) : (
              <>
                <Plus size={16} aria-hidden /> Thêm mã NVL
              </>
            )}
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {adding && (
        <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-4">
          <div>
            <label className="label" htmlFor={`${fid}-code`}>Mã NVL</label>
            <input
              id={`${fid}-code`}
              className="input uppercase"
              value={f.code}
              onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })}
              placeholder="UC-GA"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor={`${fid}-name`}>Tên NVL</label>
            <input
              id={`${fid}-name`}
              className="input"
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              placeholder="Ức gà phi lê"
            />
          </div>
          <div>
            <label className="label" htmlFor={`${fid}-unit`}>Đơn vị</label>
            <input
              id={`${fid}-unit`}
              className="input"
              value={f.unit}
              onChange={(e) => setF({ ...f, unit: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="rm-initial">
              Tồn kho khởi tạo ({f.unit || "đơn vị"})
            </label>
            <VnNumberInput
              id="rm-initial"
              min={0}
              value={f.initialStockKg}
              onValue={(n, bad) => {
                setF({ ...f, initialStockKg: n });
                setBadStock(bad);
              }}
            />
          </div>
          <div className="sm:col-span-4">
            <button
              className="btn-primary"
              disabled={busy || badStock || !f.code || !f.name}
              onClick={create}
            >
              {busy ? "Đang lưu..." : "Tạo mã NVL"}
            </button>
          </div>
        </div>
      )}

      {materials.length === 0 ? (
        <div className="card p-8 text-center text-ink-500">
          Chưa có mã NVL nào. Tạo mã rồi gán vào SKU ở trang Danh mục sản phẩm
          để bắt đầu tự trừ kho khi khoá ca.
        </div>
      ) : (
        <div className="space-y-3">
          {materials.map((m) => (
            <div
              key={m.id}
              className={`card overflow-hidden ${m.isActive ? "" : "opacity-50"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-ink-500">
                      {m.code}
                    </span>
                    <span className="font-medium text-ink-900">{m.name}</span>
                    {!m.isActive && <Badge tone="slate">Ngưng</Badge>}
                  </div>
                  <div className="mt-1 text-2xl font-bold text-ink-900 tabular-nums">
                    {fmtNum(m.currentStockKg)}{" "}
                    <span className="text-sm font-normal text-ink-500">
                      {m.unit}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="text-xs text-brand-700 hover:underline"
                    onClick={() => setExpanded(expanded === m.id ? null : m.id)}
                  >
                    {expanded === m.id ? "Ẩn lịch sử" : "Xem lịch sử"}
                  </button>
                  {canEdit && (
                    <>
                      <button
                        className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"
                        onClick={() => {
                          setTxForm(txForm === m.id ? null : m.id);
                          setTf({ action: "STOCK_IN", quantityKg: null, note: "" });
                        }}
                      >
                        {txForm === m.id ? (
                          "Đóng"
                        ) : (
                          <>
                            <Plus size={16} aria-hidden /> Nhập kho / Chỉnh tay
                          </>
                        )}
                      </button>
                      <button
                        className={`text-xs hover:underline ${
                          m.isActive ? "text-red-700" : "text-brand-700"
                        }`}
                        disabled={busy}
                        onClick={() => toggleActive(m.id, !m.isActive)}
                      >
                        {m.isActive ? "Ngưng dùng" : "Dùng lại"}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {txForm === m.id && (
                <div className="grid gap-3 border-t border-ink-100 bg-ink-50 p-4 sm:grid-cols-4">
                  <div>
                    <label className="label" htmlFor={`${fid}-tx-${m.id}-kind`}>Loại</label>
                    <select
                      id={`${fid}-tx-${m.id}-kind`}
                      className="input"
                      value={tf.action}
                      onChange={(e) =>
                        setTf({ ...tf, action: e.target.value as "STOCK_IN" | "ADJUSTMENT" })
                      }
                    >
                      <option value="STOCK_IN">Nhập kho (+)</option>
                      <option value="ADJUSTMENT">Chỉnh tay (kiểm kê lệch sổ)</option>
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor={`${fid}-tx-${m.id}-qty`}>
                      Số lượng ({m.unit}){tf.action === "ADJUSTMENT" && " — âm để trừ"}
                    </label>
                    {/* Nhập kho chỉ nhận số dương; chỉnh tay cho phép âm để trừ */}
                    <VnNumberInput
                      id={`${fid}-tx-${m.id}-qty`}
                      min={tf.action === "STOCK_IN" ? 0 : undefined}
                      value={tf.quantityKg}
                      onValue={(n, bad) => {
                        setTf({ ...tf, quantityKg: n });
                        setBadQty(bad);
                      }}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label" htmlFor={`${fid}-tx-${m.id}-note`}>
                      Ghi chú{tf.action === "ADJUSTMENT" && " (bắt buộc)"}
                    </label>
                    <input
                      id={`${fid}-tx-${m.id}-note`}
                      className="input"
                      value={tf.note}
                      onChange={(e) => setTf({ ...tf, note: e.target.value })}
                      placeholder="VD: kiểm kê thực tế ngày 10/09, lệch sổ do..."
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <button
                      className="btn-primary"
                      disabled={
                        busy ||
                        badQty ||
                        !tf.quantityKg ||
                        (tf.action === "STOCK_IN" && tf.quantityKg < 0) ||
                        (tf.action === "ADJUSTMENT" && !tf.note.trim())
                      }
                      onClick={() => submitTransaction(m.id)}
                    >
                      {busy ? "Đang lưu..." : "Ghi giao dịch"}
                    </button>
                  </div>
                </div>
              )}

              {expanded === m.id && (
                <div className="border-t border-ink-100">
                  {m.transactions.length === 0 ? (
                    <p className="p-4 text-sm text-ink-500">Chưa có giao dịch nào.</p>
                  ) : (
                    // Bảng trải hết bề ngang thẻ — không lồng thêm một khung viền
                    <div className="overflow-x-auto">
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>Lúc</th>
                            <th>Loại</th>
                            <th className="text-right">Số lượng</th>
                            <th className="text-right">Số dư sau</th>
                            <th>Ghi chú</th>
                            <th>Người ghi</th>
                          </tr>
                        </thead>
                        <tbody>
                          {m.transactions.map((t) => (
                            <tr key={t.id}>
                              <td className="whitespace-nowrap text-xs text-ink-500">
                                {fmtDateTime(t.createdAt)}
                              </td>
                              <td className="text-xs">
                                {TX_TYPE_LABEL[t.type] ?? t.type}
                              </td>
                              {/* Xuất kho theo ca là luồng bình thường — không tô đỏ */}
                              <td
                                className={`text-right font-medium tabular-nums ${
                                  t.quantityKg < 0 ? "text-ink-700" : "text-leaf-700"
                                }`}
                              >
                                {t.quantityKg > 0 ? "+" : ""}
                                {fmtNum(t.quantityKg)} {m.unit}
                              </td>
                              <td className="text-right text-ink-600 tabular-nums">
                                {fmtNum(t.balanceAfterKg)} {m.unit}
                              </td>
                              <td className="max-w-xs truncate text-xs text-ink-500">
                                {t.note ?? "—"}
                              </td>
                              <td className="text-xs text-ink-500">
                                {t.createdByName ?? "hệ thống"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
