// File: app/api/kpi/dashboard/summary/route.ts

import { NextRequest } from "next/server";
import { handle, ok, requireUser } from "@/lib/api";
import {
  assertDashboardAccess,
  getDashboardSummary,
  normalizePeriod,
  redactDashboardMoney,
} from "@/lib/services/kpi-dashboard";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const { includeMoney } = await assertDashboardAccess(user);

    const period = normalizePeriod(request.nextUrl.searchParams.get("period"));
    const data = await getDashboardSummary(period);

    return ok({ success: true, includeMoney, data: includeMoney ? data : redactDashboardMoney(data) });
  });
}
