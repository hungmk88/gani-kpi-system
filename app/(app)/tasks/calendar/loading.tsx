import { Skeleton } from "@/components/ui";

/** Lịch: thanh tháng rồi lưới 7 cột (điện thoại: danh sách theo ngày) */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-label="Đang tải">
      <span className="sr-only">Đang tải…</span>
      <Skeleton className="mb-2 h-7 w-48" />
      <Skeleton className="mb-6 h-4 w-64 max-w-full" />
      <div className="card mb-4 flex items-center justify-between p-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-6 w-32" />
      </div>
      <div className="space-y-3 sm:hidden">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card space-y-2 p-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))}
      </div>
      <div className="card hidden overflow-hidden sm:grid sm:grid-cols-7">
        {Array.from({ length: 35 }, (_, i) => (
          <div key={i} className="min-h-28 border-r border-b border-ink-100 p-1.5">
            <Skeleton className="mb-2 h-5 w-5 rounded-full" />
            {i % 3 === 0 && <Skeleton className="h-5 w-full" />}
          </div>
        ))}
      </div>
    </div>
  );
}
