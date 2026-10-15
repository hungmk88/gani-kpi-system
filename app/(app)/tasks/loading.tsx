import { Skeleton } from "@/components/ui";

/**
 * Bảng công việc: thanh lọc rồi các cột Kanban. Điện thoại là một danh sách
 * nhóm nên khung xương cũng chỉ một cột.
 */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-label="Đang tải">
      <span className="sr-only">Đang tải…</span>
      <Skeleton className="mb-2 h-7 w-40" />
      <Skeleton className="mb-6 h-4 w-72 max-w-full" />
      <div className="card mb-4 flex gap-2 p-3">
        <Skeleton className="h-9 flex-1" />
        <Skeleton className="hidden h-9 w-40 sm:block" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, c) => (
          <div
            key={c}
            className={`space-y-2 rounded-[10px] bg-ink-100/50 p-2 ${
              c > 2 ? "hidden lg:block" : c > 0 ? "hidden sm:block" : ""
            }`}
          >
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="rounded-[10px] border border-ink-200 bg-white p-3">
                <Skeleton className="mb-2 h-4 w-full" />
                <Skeleton className="mb-3 h-3 w-24" />
                <Skeleton className="h-1.5 w-full" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
