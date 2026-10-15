// File: app/api/kpi/dashboard/distribution/route.ts

import { handle, ok, requireUser } from "@/lib/api";
import {
  assertDashboardAccess,
  getDashboardDistribution,
} from "@/lib/services/kpi-dashboard";

export const runtime = "nodejs";

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    await assertDashboardAccess(user);

    const data = await getDashboardDistribution();
    return ok({ success: true, data });
  });
}
