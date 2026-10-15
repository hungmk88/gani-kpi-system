import { Skeleton } from "@/components/ui";

/** Chi tiết ca: 3 bước duyệt, số liệu ca bên trái, cột thao tác bên phải */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-label="Đang tải">
      <span className="sr-only">Đang tải…</span>
      <Skeleton className="mb-4 h-4 w-32" />
      <Skeleton className="mb-2 h-7 w-64 max-w-full" />
      <Skeleton className="mb-6 h-4 w-48" />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="card p-3">
            <Skeleton className="mb-2 h-4 w-32" />
            <Skeleton className="ml-8 h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <Skeleton className="mb-4 h-5 w-28" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        </div>
        <div className="card space-y-3 p-5">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  );
}
