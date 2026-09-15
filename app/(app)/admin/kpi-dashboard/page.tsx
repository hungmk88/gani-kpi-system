// File: app/(app)/admin/kpi-dashboard/page.tsx

import { notFound } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { Badge, PageHeader } from "@/components/ui";
import DashboardClient from "./dashboard-client";

export const dynamic = "force-dynamic";

export default async function KpiDashboardPage() {
  const user = await requireSession();

  if (!user || !["CEO", "ADMIN"].includes(user.role)) {
    return notFound();
  }

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <BarChart3 size={22} strokeWidth={2} /> Dashboard KPI
          </span>
        }
        subtitle="Tổng hợp điểm KPI 6 chỉ tiêu theo ngày/tuần/tháng"
        actions={
          <Badge tone="blue">
            Phòng SX
          </Badge>
        }
      />

      <DashboardClient />
    </>
  );
}
