import { PageSkeleton } from "@/components/ui";

/** Xưởng sản xuất: thẻ số theo chặng + bảng ca */
export default function Loading() {
  return <PageSkeleton rows={8} stats={4} />;
}
