import { PageSkeleton } from "@/components/ui";

/** Báo cáo in: gom cả kỳ theo phòng ban — trang nặng nhất của KPI. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[900px] p-8">
      <PageSkeleton rows={10} stats={4} />
    </div>
  );
}
