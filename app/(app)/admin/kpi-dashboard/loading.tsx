import { PageSkeleton } from "@/components/ui";

/** Bảng KPI sản xuất: thẻ số tổng hợp + bảng trạng thái ca, top ca */
export default function Loading() {
  return <PageSkeleton rows={6} stats={4} />;
}
