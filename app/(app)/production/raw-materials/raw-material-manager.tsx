"use client";

import { useState } from "react";
import { formatVnDateTime } from "@/lib/vn-time";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui";

/** Số kiểu Việt Nam, tối đa 2 chữ số thập phân: 374,5 */
const fmtNum = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });

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
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [txForm, setTxForm] = useState<string | null>(null);

  const [f, setF] = useState({
    code: "",
    name: "",
    unit: "kg",
    initialStockKg: 0,
  });

  const [tf, setTf] = useState({
    action: "STOCK_IN" as "STOCK_IN" | "ADJUSTMENT",
    quantityKg: 0,
    note: "",
  });

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/production/raw-materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, code: f.code.toUpperCase() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message);
        return;
      }
      setAdding(false);
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
      const res = await fetch(`/api/production/raw-materials/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: tf.action,
          quantityKg: Number(tf.quantityKg),
          note: tf.note || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message);
        return;
      }
      setTxForm(null);
      setTf({ action: "STOCK_IN", quantityKg: 0, note: "" });
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
            <label className="label">Mã NVL</label>
            <input
              className="input uppercase"
              value={f.code}
              onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })}
              placeholder="UC-GA"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Tên NVL</label>
            <input
              className="input"
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              placeholder="Ức gà phi lê"
            />
          </div>
          <div>
            <label className="label">Đơn vị</label>
            <input
              className="input"
              value={f.unit}
              onChange={(e) => setF({ ...f, unit: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Tồn kho khởi tạo</label>
            <input
              type="number"
              step="any"
              className="input"
              value={f.initialStockKg}
              onChange={(e) =>
                setF({ ...f, initialStockKg: Number(e.target.value) })
              }
            />
          </div>
          <div className="sm:col-span-4">
            <button
              className="btn-primary"
              disabled={busy || !f.code || !f.name}
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
                          setTf({ action: "STOCK_IN", quantityKg: 0, note: "" });
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
                    <label className="label">Loại</label>
                    <select
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
                    <label className="label">
                      Số lượng ({m.unit}){tf.action === "ADJUSTMENT" && " — âm để trừ"}
                    </label>
                    <input
                      type="number"
                      step="any"
                      className="input"
                      value={tf.quantityKg}
                      onChange={(e) =>
                        setTf({ ...tf, quantityKg: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label">
                      Ghi chú{tf.action === "ADJUSTMENT" && " (bắt buộc)"}
                    </label>
                    <input
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
                        tf.quantityKg === 0 ||
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
                                {formatVnDateTime(t.createdAt)}
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
