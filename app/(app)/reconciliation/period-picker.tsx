"use client";

import { usePathname, useRouter } from "next/navigation";

/** Chọn kỳ đang xem — kỳ nằm trên URL (?period=…) để gửi đường dẫn vẫn đúng kỳ. */
export default function PeriodPicker({
  periods,
  value,
}: {
  periods: { id: string; name: string }[];
  value: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <select
      className="input w-auto"
      aria-label="Kỳ KPI"
      value={value}
      onChange={(e) => router.push(`${pathname}?period=${encodeURIComponent(e.target.value)}`)}
    >
      {periods.map((p) => (
        <option key={p.id} value={p.id}>
          Kỳ {p.name}
        </option>
      ))}
    </select>
  );
}
