import { handle, ok, requireUser } from "@/lib/api";
import { BusinessError } from "@/lib/rbac";
import { ERR } from "@/lib/constants";
import {
  buildHealthSnapshot,
  getCapacityReports,
  getPredictionAccuracy,
  runPredictiveScan,
} from "@/lib/services/analytics-service";

export const runtime = "nodejs";

/**
 * Toàn bộ số liệu phân tích cho một lượt xem.
 *
 * Trưởng phòng chỉ thấy phòng mình; Ban Giám đốc thấy toàn công ty.
 *
 * Mọi khối trả về đều kèm `confidence` và `sampleSize` — không có con số nào
 * đứng trơ trọi mà không nói nó dựa trên bao nhiêu dữ liệu.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    if (user.role !== "CEO" && user.role !== "MANAGER") {
      throw new BusinessError(
        ERR.FORBIDDEN,
        "Phần phân tích và dự báo dành cho trưởng phòng và Ban Giám đốc.",
        403
      );
    }

    const url = new URL(req.url);
    const requestedDept = url.searchParams.get("departmentId");

    // Trưởng phòng bị khoá vào phòng của mình, không đọc được phòng khác
    const departmentId =
      user.role === "MANAGER"
        ? (user.departmentId ?? "__none__")
        : (requestedDept ?? null);

    const [scan, capacity, accuracy, snapshot] = await Promise.all([
      runPredictiveScan({ departmentId, persist: false }),
      getCapacityReports(departmentId),
      getPredictionAccuracy(),
      user.role === "CEO" ? buildHealthSnapshot() : Promise.resolve(null),
    ]);

    return ok({
      scope: user.role === "CEO" ? "COMPANY" : "DEPARTMENT",
      predictions: scan,
      capacity,
      accuracy,
      health: snapshot?.health ?? null,
      facts: snapshot?.facts ?? null,
    });
  });
}
