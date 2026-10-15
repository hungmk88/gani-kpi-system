import { PageSkeleton } from "@/components/ui";

/** Bảng điều hành BGĐ: thẻ số, việc chặn chốt kỳ, việc quá hạn, ngoại lệ */
export default function Loading() {
  return <PageSkeleton rows={8} stats={4} />;
}
