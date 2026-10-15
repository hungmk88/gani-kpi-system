"use client";

import { Printer } from "lucide-react";

/**
 * Thanh điều khiển của trang báo cáo. Chỉ hiện trên màn hình, tự ẩn khi in.
 *
 * Không dùng thư viện dựng PDF nào: hộp thoại in của trình duyệt cho ra file PDF
 * chuẩn, chữ tiếng Việt sắc nét, chọn được khổ giấy — và không phải cài thêm
 * mấy trăm MB Chromium lên máy.
 */
export default function PrintButton() {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-ink-200 bg-ink-50 p-3 print:hidden">
      <button
        className="btn-primary"
        onClick={() => window.print()}
      >
        <Printer size={16} strokeWidth={2} /> In / Lưu thành PDF
      </button>
      <button className="btn-ghost" onClick={() => window.close()}>
        Đóng tab
      </button>
      <span className="text-xs text-ink-500">
        Trong hộp thoại in, chọn máy in là <b>“Save as PDF”</b> (hoặc “Microsoft
        Print to PDF”) rồi bấm Lưu.
      </span>
    </div>
  );
}
