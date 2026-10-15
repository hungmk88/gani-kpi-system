import { PageSkeleton } from "@/components/ui";

/** Nhật ký: đếm + nhóm theo hành động trên bảng lớn — hiện khung trong lúc chờ */
export default function Loading() {
  return <PageSkeleton rows={10} stats={0} />;
}
