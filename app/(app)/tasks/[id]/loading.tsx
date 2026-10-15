import { Skeleton } from "@/components/ui";

/** Chi tiết công việc: thẻ trạng thái + trao đổi bên trái, cột thao tác bên phải */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-label="Đang tải">
      <span className="sr-only">Đang tải…</span>
      <Skeleton className="mb-4 h-4 w-24" />
      <Skeleton className="mb-2 h-7 w-80 max-w-full" />
      <Skeleton className="mb-6 h-4 w-56" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="card p-5">
            <div className="mb-4 flex gap-2">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-40" />
            </div>
            <Skeleton className="mb-4 h-1.5 w-full" />
            <Skeleton className="mb-2 h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="card p-3.5">
              <Skeleton className="mb-2 h-3 w-40" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
        <div className="space-y-6">
          <div className="card space-y-3 p-5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
