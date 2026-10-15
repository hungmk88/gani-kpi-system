"use client";

import { Printer, Download } from "lucide-react";

/**
 * Thanh điều khiển của trang báo cáo KPI sản xuất. Chỉ hiện trên màn hình, tự ẩn khi in.
 *
 * Cùng cách làm với /reports/kpi/[periodId]: không dùng thư viện dựng PDF nào,
 * hộp thoại in của trình duyệt cho ra file PDF chuẩn, chữ tiếng Việt sắc nét.
 */
export default function PrintToolbar({
  period,
  days,
}: {
  period: string;
  days: number;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-ink-200 bg-ink-50 p-3 print:hidden">
      <button
        className="btn-primary"
        onClick={() => window.print()}
      >
        <Printer size={16} strokeWidth={2} /> In / Lưu thành PDF
      </button>
      <a
        className="btn-ghost"
        href={`/api/kpi/dashboard/export?period=${period}&days=${days}`}
      >
        <Download size={16} strokeWidth={2} /> Tải Excel
      </a>
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
