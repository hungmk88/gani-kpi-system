import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { assertPermission, BusinessError } from "@/lib/rbac";
import { clientMeta, writeAudit } from "@/lib/audit";
import { computeDeadlines } from "@/lib/kpi";
import { periodName } from "@/lib/codes";
import { notify } from "@/lib/telegram";
import { ERR } from "@/lib/constants";

const createSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2100),
  /** Tự động gán bộ chỉ tiêu mặc định của từng phòng ban cho mọi nhân sự. */
  autoAssign: z.boolean().default(true),
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

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    assertPermission(user, "kpi.period.manage");
    const body = createSchema.parse(await req.json());

    const exists = await prisma.kpiPeriod.findUnique({
      where: { month_year: { month: body.month, year: body.year } },
    });
    if (exists) {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        `Kỳ ${periodName(body.month, body.year)} đã được mở rồi.`,
        409
      );
    }

    const deadlines = computeDeadlines(body.month, body.year);

    const period = await prisma.kpiPeriod.create({
      data: {
        month: body.month,
        year: body.year,
        name: periodName(body.month, body.year),
        ...deadlines,
        status: "OPEN",
      },
    });

    let assigned = 0;
    if (body.autoAssign) {
      assigned = await autoAssignTargets(period.id);
    }

    await writeAudit({
      actor: user,
      action: "KPI_PERIOD_OPEN",
      entityName: "kpi_periods",
      entityId: period.id,
      after: { name: period.name, assigned },
      ...clientMeta(req),
    });

    // Báo toàn bộ nhân sự nghiệp vụ biết kỳ đã mở
    if (assigned > 0) {
      const staff = await prisma.user.findMany({
        where: { isActive: true, role: { not: "ADMIN" } },
      });
      for (const s of staff) {
        await notify({
          userId: s.id,
          title: `Đã mở kỳ KPI ${period.name}`,
          body: `Hạn tự khai của bạn: ${deadlines.selfReviewDeadline.toLocaleDateString(
            "vi-VN"
          )}. Quá hạn hệ thống tự khoá.`,
          level: "INFO",
          linkUrl: `/kpi/${period.id}`,
        });
      }
    }

    return ok({ period, assigned }, 201);
  });
}

/**
 * Gán bộ chỉ tiêu mặc định: mỗi nhân sự nhận KPI đang bật của phòng ban mình,
 * target lấy từ kỳ gần nhất nếu có, không thì để 0 cho quản lý điền.
 *
 * `appliesToRole` lọc thêm theo vai trò khi một phòng ban có bộ chỉ tiêu
 * KHÁC NHAU cho Trưởng phòng và Nhân viên (vd Sales: Trưởng phòng nhận tầng
 * Team, nhân viên nhận tầng cá nhân) — NULL nghĩa là áp dụng cho cả phòng,
 * giữ nguyên hành vi gốc cho mọi phòng ban khác chưa cần tách vai trò.
 */
async function autoAssignTargets(periodId: string) {
  const users = await prisma.user.findMany({
    where: { isActive: true, role: { not: "ADMIN" }, departmentId: { not: null } },
  });
  const defs = await prisma.kpiDefinition.findMany({ where: { isActive: true } });

  const prevPeriod = await prisma.kpiPeriod.findFirst({
    where: { id: { not: periodId } },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  let count = 0;
  for (const u of users) {
    const myDefs = defs.filter(
      (d) =>
        d.departmentId === u.departmentId &&
        (d.appliesToRole === null || d.appliesToRole === u.role)
    );
    for (const d of myDefs) {
      const prev = prevPeriod
        ? await prisma.kpiResult.findFirst({
            where: {
              periodId: prevPeriod.id,
              employeeId: u.id,
              kpiDefinitionId: d.id,
            },
          })
        : null;

      await prisma.kpiResult.upsert({
        where: {
          periodId_employeeId_kpiDefinitionId: {
            periodId,
            employeeId: u.id,
            kpiDefinitionId: d.id,
          },
        },
        update: {},
        create: {
          periodId,
          employeeId: u.id,
          kpiDefinitionId: d.id,
          weightPercent: prev?.weightPercent ?? d.defaultWeight,
          targetValue: prev?.targetValue ?? 0,
          status: "DRAFT",
        },
      });
      count++;
    }
  }
  return count;
}
