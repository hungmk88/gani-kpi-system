import { PageSkeleton } from "@/components/ui";

/** Đối soát: nạp kỳ, các ô lệch và lịch sử chốt — giữ khung trang khi chờ */
export default function Loading() {
  return <PageSkeleton rows={4} stats={4} />;
}
