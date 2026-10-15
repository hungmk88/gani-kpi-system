import { PageSkeleton } from "@/components/ui";

/** Kho NVL: danh sách mã nguyên liệu kèm tồn kho */
export default function Loading() {
  return <PageSkeleton rows={5} stats={0} />;
}
