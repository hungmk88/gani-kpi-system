import { PageSkeleton } from "@/components/ui";

/** Phân tích chạy quét dự báo + tải nhân sự ngay khi mở trang — có thể mất vài giây */
export default function Loading() {
  return <PageSkeleton rows={8} stats={4} />;
}
