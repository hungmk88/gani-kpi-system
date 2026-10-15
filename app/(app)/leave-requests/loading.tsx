import { PageSkeleton } from "@/components/ui";

/** Nghỉ phép: nạp đơn, hạn mức phép năm và việc trùng ngày nghỉ */
export default function Loading() {
  return <PageSkeleton rows={5} stats={0} />;
}
