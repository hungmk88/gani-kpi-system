import { PageSkeleton } from "@/components/ui";

/** Trang quản trị nạp cùng lúc tài khoản, phòng ban, danh mục KPI, nhật ký tích hợp */
export default function Loading() {
  return <PageSkeleton rows={8} stats={0} />;
}
