import { PageSkeleton } from "@/components/ui";

/** Sửa ca bị KCS trả về: nạp ca, danh mục SKU và nhân sự xưởng */
export default function Loading() {
  return <PageSkeleton rows={4} stats={0} />;
}
