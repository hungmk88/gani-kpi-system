import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { assertPermission, BusinessError } from "@/lib/rbac";
import { clientMeta, writeAudit } from "@/lib/audit";
import { computeDeadlines } from "@/lib/kpi";
import { formatVnDate, formatVnDateTime } from "@/lib/vn-time";
import { periodName } from "@/lib/codes";
import { notify } from "@/lib/telegram";
import { ERR } from "@/lib/constants";
import { forEachLimit } from "@/lib/concurrency";
import { NOTIFY_CONCURRENCY } from "@/lib/services/kpi-service";
import { planAssignments } from "@/lib/services/period-service";

export const runtime = "nodejs";
// Mở kỳ cho cả công ty: gán chỉ tiêu + gửi thông báo — nới hạn mặc định
export const maxDuration = 60;

const createSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2100),
  /** Tự động gán bộ chỉ tiêu mặc định của từng phòng ban cho mọi nhân sự. */
  autoAssign: z.boolean().default(true),
  /**
   * Xác nhận MỞ TRỄ một kỳ đã quá hạn tự khai (vd nhập bù kỳ cũ). Không gửi
   * thì máy chủ từ chối — xem chú thích ở POST.
   */
  allowLate: z.boolean().default(false),
});

export async function GET() {
  return handle(async () => {
    await requireUser();
    const periods = await prisma.kpiPeriod.findMany({
      orderBy: [{ year: "desc" }, { month: "desc" }],
      include: { _count: { select: { results: true } } },
    });
    return ok({ periods });
  });
}

/**
 * Mở kỳ KPI.
 *
 * - Gửi lại cho kỳ ĐÃ CÓ (vd lần trước quá hạn giữa chừng): không báo 409 nữa
 *   mà gán nốt những dòng còn thiếu (gán chỉ tiêu idempotent) — chỉ khi kỳ còn
 *   OPEN. Kỳ đã khoá bước tự khai trở đi thì vẫn 409.
 * - Kỳ đã QUÁ HẠN TỰ KHAI (23:59 ngày 2 tháng sau): mặc định từ chối (400).
 *   Gửi `allowLate: true` để mở trễ. Khi đó kỳ vẫn mang đúng lịch 2-4-5 của
 *   tháng đó (không dời hạn): lượt cron khoá kế tiếp sẽ khoá ngay bước tự
 *   khai (dòng chưa khai đẩy sang trưởng phòng), và nếu hạn ngày 4 cũng đã qua
 *   thì đẩy thẳng lên hàng chờ Ban Giám đốc — số liệu do trưởng phòng / Ban
 *   Giám đốc nhập (hoặc nạp Excel khi kỳ còn nhận) thay cho nhân viên tự khai.
 *
 * Thông báo "đã mở kỳ" gửi SAU khi trả lời (after), song song có giới hạn và
 * lỗi từng người không làm hỏng gì: dữ liệu đã ghi xong rồi.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    assertPermission(user, "kpi.period.manage");
    const body = createSchema.parse(await req.json());
    const meta = clientMeta(req);

    const exists = await prisma.kpiPeriod.findUnique({
      where: { month_year: { month: body.month, year: body.year } },
    });
    if (exists) {
      if (exists.status !== "OPEN" || !body.autoAssign) {
        throw new BusinessError(
          ERR.VALIDATION_FAILED,
          `Kỳ ${periodName(body.month, body.year)} đã được mở rồi.`,
          409
        );
      }
      // Gán lại: chỉ điền phần còn thiếu, dòng đã có giữ nguyên
      const { total, created, newcomers } = await autoAssignTargets(exists.id);
      await writeAudit({
        actor: user,
        action: "KPI_PERIOD_REASSIGN",
        entityName: "kpi_periods",
        entityId: exists.id,
        after: { name: exists.name, assigned: total, created },
        ...meta,
      });
      scheduleOpenNotices(exists, newcomers);
      return ok({ period: exists, assigned: total, created, reassigned: true });
    }

    const deadlines = computeDeadlines(body.month, body.year);
    if (deadlines.selfReviewDeadline.getTime() < Date.now() && !body.allowLate) {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        `Kỳ ${periodName(body.month, body.year)} đã quá hạn tự khai (${formatVnDateTime(
          deadlines.selfReviewDeadline
        )}). Mở lúc này thì hệ thống khoá ngay bước tự khai, nhân viên không kịp khai. Nếu vẫn cần mở (vd nhập bù kỳ cũ), hãy xác nhận "mở trễ".`,
        400
      );
    }

    let period;
    try {
      period = await prisma.kpiPeriod.create({
        data: {
          month: body.month,
          year: body.year,
          name: periodName(body.month, body.year),
          ...deadlines,
          status: "OPEN",
        },
      });
    } catch (e) {
      // Hai lượt mở cùng lúc: lượt thua vấp unique (month, year)
      if ((e as { code?: string }).code === "P2002") {
        throw new BusinessError(
          ERR.VALIDATION_FAILED,
          `Kỳ ${periodName(body.month, body.year)} vừa được mở ở lượt khác.`,
          409
        );
      }
      throw e;
    }

    let assigned = 0;
    let created = 0;
    let newcomers: string[] = [];
    if (body.autoAssign) {
      ({ total: assigned, created, newcomers } = await autoAssignTargets(period.id));
    }

    await writeAudit({
      actor: user,
      action: "KPI_PERIOD_OPEN",
      entityName: "kpi_periods",
      entityId: period.id,
      after: {
        name: period.name,
        assigned,
        created,
        ...(body.allowLate ? { moTre: true } : {}),
      },
      ...meta,
    });

    scheduleOpenNotices(period, newcomers);

    return ok({ period, assigned, created }, 201);
  });
}

/** Báo cho những người VỪA được gán chỉ tiêu — sau khi đã trả lời request. */
function scheduleOpenNotices(
  period: { id: string; name: string; selfReviewDeadline: Date },
  userIds: string[]
) {
  if (userIds.length === 0) return;
  after(() =>
    forEachLimit(
      userIds,
      NOTIFY_CONCURRENCY,
      (userId) =>
        notify({
          userId,
          title: `Đã mở kỳ KPI ${period.name}`,
          body: `Hạn tự khai của bạn: 23:59 ngày ${formatVnDate(
            period.selfReviewDeadline
          )}. Quá hạn hệ thống tự khoá.`,
          level: "INFO",
          linkUrl: `/kpi/${period.id}`,
        }),
      "KPI period open notify"
    )
  );
}

/**
 * Gán bộ chỉ tiêu mặc định (xem planAssignments): đọc MỘT lần nhân sự, chỉ
 * tiêu, dòng kỳ trước và dòng đã có của kỳ này, rồi tạo phần còn thiếu bằng
 * MỘT lệnh createMany (skipDuplicates) — trước đây 2 truy vấn cho mỗi người ×
 * mỗi chỉ tiêu, kỳ 50 người × 8 chỉ tiêu là ~800 lệnh rời.
 *
 * `appliesToRole` lọc thêm theo vai trò khi một phòng ban có bộ chỉ tiêu
 * KHÁC NHAU cho Trưởng phòng và Nhân viên (vd Sales: Trưởng phòng nhận tầng
 * Team, nhân viên nhận tầng cá nhân) — NULL nghĩa là áp dụng cho cả phòng.
 */
async function autoAssignTargets(periodId: string) {
  const [users, defs, prevPeriod, existing] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, role: { not: "ADMIN" }, departmentId: { not: null } },
      select: { id: true, role: true, departmentId: true },
    }),
    prisma.kpiDefinition.findMany({
      where: { isActive: true },
      select: { id: true, departmentId: true, appliesToRole: true, defaultWeight: true },
    }),
    prisma.kpiPeriod.findFirst({
      where: { id: { not: periodId } },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      select: { id: true },
    }),
    prisma.kpiResult.findMany({
      where: { periodId },
      select: { employeeId: true, kpiDefinitionId: true },
    }),
  ]);

  const prevRows = prevPeriod
    ? await prisma.kpiResult.findMany({
        where: { periodId: prevPeriod.id, employeeId: { in: users.map((u) => u.id) } },
        select: {
          employeeId: true,
          kpiDefinitionId: true,
          weightPercent: true,
          targetValue: true,
        },
      })
    : [];

  const plan = planAssignments({
    periodId,
    users,
    defs,
    prevRows,
    existingKeys: new Set(existing.map((r) => `${r.employeeId}|${r.kpiDefinitionId}`)),
  });

  const res =
    plan.rows.length > 0
      ? await prisma.kpiResult.createMany({ data: plan.rows, skipDuplicates: true })
      : { count: 0 };

  return {
    total: plan.total,
    created: res.count,
    newcomers: [...new Set(plan.rows.map((r) => r.employeeId))],
  };
}
