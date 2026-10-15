import { PageSkeleton } from "@/components/ui";

/** Trang KPI: 4 thẻ số (kỳ, điểm, trọng số, chờ duyệt) + bảng chỉ tiêu của tôi. */
export default function Loading() {
  return <PageSkeleton rows={6} stats={4} />;
}
