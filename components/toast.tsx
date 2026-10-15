"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";

/**
 * THÔNG BÁO NHANH (toast) — xác nhận thao tác đã xong mà không chặn màn hình.
 * Gọi `toast("Đã lưu")` ở bất kỳ client component nào; <Toaster/> nằm sẵn
 * trong khung ứng dụng. Lỗi cần người dùng đọc kỹ thì vẫn hiện tại chỗ (ngay
 * dưới nút / trong hộp xác nhận), không dùng toast.
 */
type Tone = "success" | "error";
type Item = { id: number; text: string; tone: Tone };

const EVENT = "gani:toast";
let seq = 0;

export function toast(text: string, tone: Tone = "success") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<Item>(EVENT, { detail: { id: ++seq, text, tone } }));
}

export function Toaster() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    function onToast(e: Event) {
      const item = (e as CustomEvent<Item>).detail;
      setItems((list) => [...list.slice(-2), item]);
      window.setTimeout(() => setItems((list) => list.filter((i) => i.id !== item.id)), 4000);
    }
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 top-4 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:top-6 sm:items-end print:hidden"
    >
      {items.map((i) => (
        <div
          key={i.id}
          role={i.tone === "error" ? "alert" : "status"}
          className="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg bg-ink-900 px-4 py-3 text-sm text-white shadow-lg"
        >
          {i.tone === "success" ? (
            <CheckCircle2 size={18} className="mt-px shrink-0 text-leaf-500" />
          ) : (
            <AlertTriangle size={18} className="mt-px shrink-0 text-amber-400" />
          )}
          <span className="flex-1">{i.text}</span>
          <button
            aria-label="Đóng"
            className="-mr-1 shrink-0 text-ink-300 hover:text-white"
            onClick={() => setItems((list) => list.filter((x) => x.id !== i.id))}
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
