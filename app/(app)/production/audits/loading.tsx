import { PageSkeleton } from "@/components/ui";

/** Cổng cảnh báo chạy chỉ tiêu: 4 thẻ số + danh sách cảnh báo */
export default function Loading() {
  return <PageSkeleton rows={5} stats={4} />;
}
