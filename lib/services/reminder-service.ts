import { prisma } from "../db";
import { notify } from "../notify";
import { sendCeoAlert } from "../telegram";
import { sendKpiApprovalRequest } from "../telegram-bot";

/**
 * BỘ NHẮC HẠN TỰ ĐỘNG.
 *
 * Chạy chung nhịp với bộ máy nền (mỗi 2 tiếng). Vấn đề của việc chạy dày như vậy
 * là dễ thành spam, nên mọi lời nhắc đều đi qua `alreadyRemindedToday` — mỗi
 * người chỉ nhận đúng một lần mỗi loại mỗi ngày, dù bộ máy chạy bao nhiêu lượt.
 */

const DAY = 86400_000;

/** Đã nhắc loại này cho người này trong hôm nay chưa. */
async function alreadyRemindedToday(userId: string, marker: string) {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const found = await prisma.notification.findFirst({
    where: {
      userId,
      title: { contains: marker },
      createdAt: { gte: since },
    },
    select: { id: true },
  });
  return !!found;
}

function daysUntil(d: Date, now: Date) {
  const a = new Date(d);
  a.setHours(0, 0, 0, 0);
  const b = new Date(now);
  b.setHours(0, 0, 0, 0);
  return Math.round((a.getTime() - b.getTime()) / DAY);
}

export async function runDeadlineReminders(now = new Date()) {
  const periods = await prisma.kpiPeriod.findMany({
    where: { status: { not: "FINALIZED" } },
  });

  let selfReminders = 0;
  let managerReminders = 0;
  let ceoReminders = 0;
  let approvalRequests = 0;

  for (const p of periods) {
    /* --------- Chặng 1: nhắc nhân viên chưa tự khai --------- */
    if (p.status === "OPEN") {
      const left = daysUntil(p.selfReviewDeadline, now);
      // Nhắc khi còn 1 ngày và đúng ngày hết hạn. Nhắc sớm quá thì người ta quên,
      // nhắc muộn quá thì không kịp làm.
      if (left === 1 || left === 0) {
        const pending = await prisma.kpiResult.groupBy({
          by: ["employeeId"],
          where: { periodId: p.id, status: "DRAFT" },
          _count: { _all: true },
        });

        for (const row of pending) {
          const marker = `tự khai KPI ${p.name}`;
          if (await alreadyRemindedToday(row.employeeId, marker)) continue;

          await notify({
            userId: row.employeeId,
            title:
              left === 0
                ? `HÔM NAY là hạn cuối tự khai KPI ${p.name}`
                : `Ngày mai hết hạn tự khai KPI ${p.name}`,
            body: `Bạn còn ${row._count._all} chỉ tiêu chưa khai. Quá 23:59 ngày ${p.selfReviewDeadline.getDate()} hệ thống tự khoá, không mở lại được.`,
            level: left === 0 ? "CRITICAL" : "WARNING",
            linkUrl: `/kpi/${p.id}`,
            zaloKind: "KPI_REMINDER",
            zaloData: {
              period_name: p.name,
              deadline_date: p.selfReviewDeadline.toLocaleDateString("vi-VN"),
              pending_count: String(row._count._all),
            },
          });
          selfReminders++;
        }
      }
    }

    /* --------- Chặng 2: nhắc trưởng phòng chưa duyệt --------- */
    if (p.status === "SELF_LOCKED" || p.status === "OPEN") {
      const left = daysUntil(p.managerReviewDeadline, now);
      if (left === 1 || left === 0) {
        const managers = await prisma.user.findMany({
          where: { role: "MANAGER", isActive: true, departmentId: { not: null } },
        });

        for (const m of managers) {
          const pending = await prisma.kpiResult.count({
            where: {
              periodId: p.id,
              status: { in: ["DRAFT", "SELF_REVIEWED"] },
              employee: { departmentId: m.departmentId },
            },
          });
          if (pending === 0) continue;

          const marker = `duyệt KPI ${p.name}`;
          if (await alreadyRemindedToday(m.id, marker)) continue;

          await notify({
            userId: m.id,
            title:
              left === 0
                ? `HÔM NAY là hạn cuối duyệt KPI ${p.name}`
                : `Ngày mai hết hạn duyệt KPI ${p.name}`,
            body: `Phòng bạn còn ${pending} dòng chưa xử lý. Quá 23:59 ngày ${p.managerReviewDeadline.getDate()} hệ thống tự đẩy hết lên Ban Giám đốc.`,
            level: left === 0 ? "CRITICAL" : "WARNING",
            linkUrl: `/kpi/${p.id}`,
            zaloKind: "KPI_REMINDER",
            zaloData: {
              period_name: p.name,
              deadline_date: p.managerReviewDeadline.toLocaleDateString("vi-VN"),
              pending_count: String(pending),
            },
          });
          managerReminders++;
        }
      }
    }

    /* --------- Chặng 3: nhắc Ban Giám đốc chốt kỳ --------- */
    if (p.status === "MANAGER_LOCKED") {
      const left = daysUntil(p.ceoApprovalDeadline, now);
      if (left <= 1) {
        const pending = await prisma.kpiResult.count({
          where: { periodId: p.id, status: { not: "FINALIZED" } },
        });

        if (pending > 0) {
          const ceos = await prisma.user.findMany({
            where: { role: "CEO", isActive: true },
          });
          for (const c of ceos) {
            const marker = `chốt kỳ KPI ${p.name}`;
            if (await alreadyRemindedToday(c.id, marker)) continue;
            await notify({
              userId: c.id,
              title: `Cần chốt kỳ KPI ${p.name}`,
              body: `Còn ${pending} dòng chờ bạn duyệt. Hạn chốt là ngày ${p.ceoApprovalDeadline.getDate()}.`,
              level: left <= 0 ? "CRITICAL" : "WARNING",
              linkUrl: `/kpi/${p.id}`,
            });
            ceoReminders++;
          }

          /* Gửi thẳng nút duyệt cho những dòng đang lệch số — đây là mấy dòng
             Ban Giám đốc cần nhìn tận mắt chứ không nên duyệt hàng loạt. */
          const risky = await prisma.kpiResult.findMany({
            where: {
              periodId: p.id,
              status: { not: "FINALIZED" },
              hasMismatch: true,
            },
            take: 5,
            orderBy: { mismatchPercent: "desc" },
          });
          for (const r of risky) {
            const res = await sendKpiApprovalRequest(r.id);
            approvalRequests += res.sent;
          }
        }
      }
    }
  }

  return {
    selfReminders,
    managerReminders,
    ceoReminders,
    approvalRequests,
  };
}

/**
 * Nhắc gọn cho Ban Giám đốc khi có ô KPI treo vì lệch số quá lâu.
 * Treo lâu tức là không ai chịu quyết, mà không quyết thì không chốt được kỳ.
 */
export async function remindStaleMismatches(now = new Date(), staleHours = 48) {
  const cutoff = new Date(now.getTime() - staleHours * 3600_000);
  const stale = await prisma.reconciliation.count({
    where: { status: "MISMATCH", createdAt: { lt: cutoff } },
  });

  if (stale === 0) return { stale: 0, alerted: false };

  const res = await sendCeoAlert({
    title: `${stale} ô KPI treo vì lệch số quá ${staleHours} giờ`,
    details:
      "Hệ thống không tự chọn số khi các nguồn đá nhau. Chưa ai quyết thì mấy ô này không có số để chấm điểm.",
    actionPath: "/reconciliation",
  });

  return { stale, alerted: res.sent === true };
}
