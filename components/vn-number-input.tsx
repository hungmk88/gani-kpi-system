"use client";

import { useEffect, useState } from "react";
import { formatVnNumber, parseVnNumber } from "@/lib/vn-number";

/**
 * Ô NHẬP SỐ KIỂU VIỆT — thay cho <input type="number">: gõ "135.000.000" hay
 * "7,5" đều đúng (type=number trên trình duyệt tiếng Việt hiểu sai dấu chấm,
 * và cuộn chuột đổi số ngoài ý muốn). Rời ô thì tự định dạng lại có dấu chấm
 * hàng nghìn. Ô trống trả null — KHÔNG tự thành 0.
 *
 * `onValue` nhận số đã đọc (null = trống), `invalid` báo chuỗi gõ không phải số.
 */
export default function VnNumberInput({
  value,
  onValue,
  min,
  className = "input",
  ...rest
}: {
  value: number | null;
  onValue: (n: number | null, invalid: boolean) => void;
  min?: number;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "min">) {
  const [text, setText] = useState(value === null ? "" : formatVnNumber(value));

  const isBad = (t: string, n: number | null) =>
    (t.trim() !== "" && n === null) || (n !== null && min !== undefined && n < min);

  // Giá trị đổi từ bên ngoài (tải lại, đặt lại) thì cập nhật chữ hiển thị.
  // value = null trong lúc chữ đang gõ sai (vd "-5" khi min=0) là do chính ô
  // này báo lên — giữ nguyên chữ để người dùng thấy ô đỏ và sửa, không xoá.
  useEffect(() => {
    const current = parseVnNumber(text);
    if (value === null && isBad(text, current)) return;
    if (current !== value) setText(value === null ? "" : formatVnNumber(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const parsed = parseVnNumber(text);
  const bad = isBad(text, parsed);

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      aria-invalid={bad || undefined}
      className={`${className} tabular ${bad ? "border-red-600 focus:border-red-600 focus:ring-red-600/25" : ""}`}
      value={text}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const n = parseVnNumber(t);
        const invalid = isBad(t, n);
        onValue(invalid ? null : n, invalid);
      }}
      onBlur={(e) => {
        if (parsed !== null && !bad) setText(formatVnNumber(parsed));
        rest.onBlur?.(e);
      }}
    />
  );
}
