import { PageSkeleton } from "@/components/ui";

/** Yêu cầu liên phòng: hàng chờ xử lý, đã gửi và lịch sử */
export default function Loading() {
  return <PageSkeleton rows={5} stats={0} />;
}
