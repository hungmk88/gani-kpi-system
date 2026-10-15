import { PageSkeleton } from "@/components/ui";

/** Đặt mục tiêu: danh sách nhân sự × chỉ tiêu, không có thẻ số. */
export default function Loading() {
  return <PageSkeleton rows={8} stats={0} />;
}
