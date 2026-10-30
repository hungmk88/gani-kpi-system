"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * HỘP XÁC NHẬN DÙNG CHUNG — thay cho confirm()/prompt() của trình duyệt.
 *
 * Vì sao không dùng confirm()/prompt():
 *  - Không nói được HẬU QUẢ (khoá bao nhiêu dòng, mất bao nhiêu tiền) — người
 *    bấm "OK" theo phản xạ.
 *  - prompt() hiện mật khẩu bằng chữ thường, không kiểm tra gì.
 *  - Trình duyệt trong Zalo/Telegram có thể chặn hẳn các hộp này.
 *
 * Dùng cho mọi thao tác không đảo ngược được: khoá tài khoản, chốt kỳ KPI,
 * khoá ca sản xuất, sửa chuẩn SKU... Có thể bắt buộc ghi lý do (vào nhật ký)
 * hoặc bắt gõ lại một chữ để xác nhận thao tác cực nặng.
 */
export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = "Xác nhận",
  cancelLabel = "Huỷ",
  tone = "primary",
  reason,
  typeToConfirm,
  busy = false,
  confirmDisabled = false,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  /** Nội dung: hậu quả của thao tác, tóm tắt số liệu… */
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  /** Bắt buộc ghi lý do; `minLength` tính sau khi bỏ khoảng trắng hai đầu */
  reason?: { label: string; placeholder?: string; minLength: number };
  /** Bắt gõ đúng chuỗi này mới bật nút xác nhận */
  typeToConfirm?: string;
  busy?: boolean;
  /** Điều kiện riêng của nội dung (vd mật khẩu chưa đủ luật) */
  confirmDisabled?: boolean;
  /** Lỗi trả về từ máy chủ — hiện ngay trong hộp, không đóng hộp */
  error?: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const reasonId = useId();
  const typeId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [reasonText, setReasonText] = useState("");
  const [typed, setTyped] = useState("");

  // Mở lại thì xoá chữ đã gõ lần trước
  useEffect(() => {
    if (open) {
      setReasonText("");
      setTyped("");
    }
  }, [open]);

  // onClose thường là arrow function viết inline ở component cha → mỗi lần cha
  // render lại là một hàm mới. Nếu effect bên dưới phụ thuộc onClose/busy thì
  // nó chạy lại sau MỖI lần cha render và kéo focus về phần tử đầu tiên — bấm
  // "Hiện"/"Tạo ngẫu nhiên" trong hộp đổi mật khẩu là focus nhảy mất. Giữ bản
  // mới nhất trong ref để effect chỉ chạy khi hộp mở/đóng.
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
  });

  // Esc để đóng, Tab không chạy ra ngoài hộp, focus vào phần tử đầu tiên;
  // đóng hộp thì trả focus về chỗ cũ (nút đã mở hộp) cho người dùng bàn phím.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
    const first = focusables()[0];
    first?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busyRef.current) {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const a = list[0];
      const z = list[list.length - 1];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      } else if (!panel?.contains(document.activeElement)) {
        // Focus đã lọt ra ngoài (vd nút vừa bị disable khi busy) → kéo về hộp
        e.preventDefault();
        a.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Phần tử cũ có thể đã bị gỡ khỏi DOM (vd dòng vừa xoá) → bỏ qua
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  if (!open) return null;

  const reasonOk = !reason || reasonText.trim().length >= reason.minLength;
  const typedOk = !typeToConfirm || typed.trim() === typeToConfirm;
  const canConfirm = reasonOk && typedOk && !busy && !confirmDisabled;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-xl"
      >
        <h2 id={titleId} className="mb-2 text-lg font-bold text-ink-900">
          {title}
        </h2>
        {children && <div className="mb-4 space-y-2 text-sm text-ink-700">{children}</div>}

        {reason && (
          <div className="mb-3">
            <label htmlFor={reasonId} className="mb-1 block text-sm font-medium text-ink-700">
              {reason.label}
            </label>
            <textarea
              id={reasonId}
              className="input min-h-20"
              placeholder={reason.placeholder}
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
            />
            <div className="mt-1 text-xs text-ink-500">
              {reasonText.trim().length}/{reason.minLength} ký tự tối thiểu · ghi vào
              nhật ký hệ thống
            </div>
          </div>
        )}

        {typeToConfirm && (
          <div className="mb-3">
            <label htmlFor={typeId} className="mb-1 block text-sm font-medium text-ink-700">
              Gõ <b className="font-mono">{typeToConfirm}</b> để xác nhận
            </label>
            <input
              id={typeId}
              className="input"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
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

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="btn-ghost h-11 sm:h-auto" disabled={busy} onClick={onClose}>
            {cancelLabel}
          </button>
          <button
            className={`${tone === "danger" ? "btn-danger" : "btn-primary"} h-11 sm:h-auto`}
            disabled={!canConfirm}
            onClick={() => onConfirm(reasonText.trim())}
          >
            {busy ? "Đang xử lý..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
