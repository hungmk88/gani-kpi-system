import { PageSkeleton } from "@/components/ui";

/** Gantt nạp tới 200 việc kèm quan hệ phụ thuộc rồi mới tính đường găng */
export default function Loading() {
  return <PageSkeleton rows={10} stats={0} />;
}
