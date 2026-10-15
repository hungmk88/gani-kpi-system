import { PageSkeleton } from "@/components/ui";

/** Trang chủ gom nhịp kỳ KPI, hàng chờ, số liệu so tuần trước và bảng tải */
export default function Loading() {
  return <PageSkeleton rows={5} stats={3} />;
}
