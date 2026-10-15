import { PageSkeleton } from "@/components/ui";

/** Thông báo: danh sách gần nhất + trạng thái liên kết Telegram */
export default function Loading() {
  return <PageSkeleton rows={6} stats={0} />;
}
