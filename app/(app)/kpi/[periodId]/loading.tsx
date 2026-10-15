import { Skeleton } from "@/components/ui";

/**
 * Bảng KPI một kỳ: lịch chốt 3 bước, thanh công cụ, bộ lọc, rồi danh sách
 * nhân sự (mỗi người một thẻ gập) — khung giữ đúng bố cục để không nhảy.
 */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-label="Đang tải">
      <span className="sr-only">Đang tải…</span>
      <Skeleton className="mb-4 h-4 w-16" />
      <Skeleton className="mb-2 h-7 w-64" />
      <Skeleton className="mb-6 h-4 w-80 max-w-full" />
      <div className="card mb-6 p-4">
        <Skeleton className="mb-3 h-4 w-28" />
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      </div>
      <div className="card mb-4 flex flex-wrap gap-2 p-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-40" />
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-24 rounded-full" />
        ))}
      </div>
      <div className="space-y-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="card flex items-center justify-between gap-4 px-4 py-4">
            <div className="flex-1">
              <Skeleton className="mb-2 h-4 w-48" />
              <Skeleton className="h-3 w-72 max-w-full" />
            </div>
            <Skeleton className="h-6 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}
