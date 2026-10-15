// File: app/api/kpi/dashboard/trends/route.ts

import { NextRequest } from "next/server";
import { handle, ok, requireUser } from "@/lib/api";
import {
  assertDashboardAccess,
  getDashboardTrends,
  redactDashboardMoney,
} from "@/lib/services/kpi-dashboard";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const { includeMoney } = await assertDashboardAccess(user);

    // Số ngày (7, 30 hoặc 90) — chặn trong khoảng 1..90
    const numDays = parseInt(request.nextUrl.searchParams.get("days") ?? "7", 10) || 7;
    const data = await getDashboardTrends(numDays);

    return ok({ success: true, includeMoney, data: includeMoney ? data : redactDashboardMoney(data) });
  });
}
