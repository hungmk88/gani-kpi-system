import { PageSkeleton } from "@/components/ui";

/** Danh mục SKU: bảng mã sản phẩm, không có thẻ số */
export default function Loading() {
  return <PageSkeleton rows={8} stats={0} />;
}
