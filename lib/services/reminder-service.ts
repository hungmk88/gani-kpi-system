import { prisma } from "../db";
import { formatVnDate, vnDayDiff, vnParts, vnStartOfDay } from "../vn-time";
import { notify, type NotifyInput } from "../notify";
import { logOutOfTime, runBounded, TimeBudget } from "../time-budget";
import { sendCeoAlert } from "../telegram";
import { sendKpiApprovalRequest } from "../telegram-bot";

/**
 * BỘ NHẮC HẠN TỰ ĐỘNG.
 *
 * Chạy chung nhịp với bộ máy nền (mỗi 2 tiếng). Vấn đề của việc chạy dày như vậy
 * là dễ thành spam, nên mọi lời nhắc đều đi qua `alreadyRemindedToday` — mỗi
 * người chỉ nhận đúng một lần mỗi loại mỗi ngày, dù bộ máy chạy bao nhiêu lượt.
 * Gửi song song có giới hạn và theo ngân sách thời gian của lượt cron (xem
 * lib/time-budget.ts) — hết giờ thì để lượt sau gửi nốt.
 */

/**
 * Những người ĐÃ được nhắc loại này trong hôm nay (ngày VN) — một query cho cả
 * danh sách, thay vì một query mỗi người. Dấu nhắc là dòng notifications mà
 * `notify` ghi TRƯỚC khi gọi Telegram/Zalo (xem lib/notify.ts), nên lượt cron
 * bị giết giữa chừng không làm lượt sau nhắc lặp.
 */
async function remindedToday(userIds: string[], marker: string, now: Date) {
  if (userIds.length === 0) return new Set<string>();
  const rows = await prisma.notification.findMany({
    where: {
      userId: { in: userIds },
      title: { contains: marker },
      createdAt: { gte: vnStartOfDay(now) },
    },
    select: { userId: true },
  });
  return new Set(rows.map((r) => r.userId));
}

/** Còn bao nhiêu ngày lịch VN tới hạn (0 = hôm nay là ngày hạn). */
function daysUntil(d: Date, now: Date) {
  return vnDayDiff(now, d);
}

/** Số tin gửi song song tối đa — đủ nhanh mà không bị Telegram chặn vì dồn dập. */
const SEND_CONCURRENCY = 5;
/** Còn dưới chừng này thì không mở thêm lượt gửi (một lần gọi Telegram tối đa 15s). */
const SEND_RESERVE_MS = 3000;

export async function runDeadlineReminders(
  now = new Date(),
  budget: TimeBudget = TimeBudget.unlimited()
) {
  const periods = await prisma.kpiPeriod.findMany({
    where: { status: { not: "FINALIZED" } },
  });

  // Gom mọi lời nhắc cần gửi trước, gửi sau (song song có giới hạn).
  const selfJobs: NotifyInput[] = [];
  const managerJobs: NotifyInput[] = [];
  const ceoJobs: NotifyInput[] = [];
  const approvalIds: string[] = [];
  let timedOut = false;

  for (const p of periods) {
    if (budget.expired(SEND_RESERVE_MS)) {
      timedOut = true;
      break;
    }
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

        const marker = `tự khai KPI ${p.name}`;
        const done = await remindedToday(
          pending.map((r) => r.employeeId),
          marker,
          now
        );
        for (const row of pending) {
          if (done.has(row.employeeId)) continue;
          selfJobs.push({
            userId: row.employeeId,
            title:
              left === 0
                ? `HÔM NAY là hạn cuối tự khai KPI ${p.name}`
                : `Ngày mai hết hạn tự khai KPI ${p.name}`,
            body: `Bạn còn ${row._count._all} chỉ tiêu chưa khai. Quá 23:59 ngày ${vnParts(p.selfReviewDeadline).day} hệ thống tự khoá, không mở lại được.`,
            level: left === 0 ? "CRITICAL" : "WARNING",
            linkUrl: `/kpi/${p.id}`,
            zaloKind: "KPI_REMINDER",
            zaloData: {
              period_name: p.name,
              deadline_date: formatVnDate(p.selfReviewDeadline),
              pending_count: String(row._count._all),
            },
          });
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
        const marker = `duyệt KPI ${p.name}`;
        const done = await remindedToday(
          managers.map((m) => m.id),
          marker,
          now
        );

        for (const m of managers) {
          if (done.has(m.id)) continue;
          const pending = await prisma.kpiResult.count({
            where: {
              periodId: p.id,
              status: { in: ["DRAFT", "SELF_REVIEWED"] },
              employee: { departmentId: m.departmentId },
            },
          });
          if (pending === 0) continue;

          managerJobs.push({
            userId: m.id,
            title:
              left === 0
                ? `HÔM NAY là hạn cuối duyệt KPI ${p.name}`
                : `Ngày mai hết hạn duyệt KPI ${p.name}`,
            body: `Phòng bạn còn ${pending} dòng chưa xử lý. Quá 23:59 ngày ${vnParts(p.managerReviewDeadline).day} hệ thống tự đẩy hết lên Ban Giám đốc.`,
            level: left === 0 ? "CRITICAL" : "WARNING",
            linkUrl: `/kpi/${p.id}`,
            zaloKind: "KPI_REMINDER",
            zaloData: {
              period_name: p.name,
              deadline_date: formatVnDate(p.managerReviewDeadline),
              pending_count: String(pending),
            },
          });
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
          const marker = `chốt kỳ KPI ${p.name}`;
          const done = await remindedToday(
            ceos.map((c) => c.id),
            marker,
            now
          );
          for (const c of ceos) {
            if (done.has(c.id)) continue;
            ceoJobs.push({
              userId: c.id,
              title: `Cần chốt kỳ KPI ${p.name}`,
              body: `Còn ${pending} dòng chờ bạn duyệt. Hạn chốt là ngày ${vnParts(p.ceoApprovalDeadline).day}.`,
              level: left <= 0 ? "CRITICAL" : "WARNING",
              linkUrl: `/kpi/${p.id}`,
            });
          }

          /* Gửi thẳng nút duyệt cho những dòng đang lệch số — đây là mấy dòng
             Ban Giám đốc cần nhìn tận mắt chứ không nên duyệt hàng loạt. */
          // Chỉ dòng ĐÃ qua trưởng phòng (bấm "Duyệt & khoá" mới chốt được),
          // và bỏ dòng còn treo đối soát MISMATCH — dòng đó ceoApprove từ chối,
          // phải chốt số ở trang Đối soát trước. Mỗi dòng tối đa một tin mỗi
          // ngày VN: sendKpiApprovalRequest tự chặn gửi lặp.
          const [candidates, openMismatches] = await Promise.all([
            prisma.kpiResult.findMany({
              where: {
                periodId: p.id,
                status: "MANAGER_REVIEWED",
                hasMismatch: true,
              },
              take: 50,
              orderBy: { mismatchPercent: "desc" },
              select: { id: true, employeeId: true, kpiDefinitionId: true },
            }),
            prisma.reconciliation.findMany({
              where: { periodId: p.id, status: "MISMATCH" },
              select: { employeeId: true, kpiDefinitionId: true },
            }),
          ]);
          const blocked = new Set(
            openMismatches.map((m) => `${m.employeeId}|${m.kpiDefinitionId}`)
          );
          const risky = candidates
            .filter((r) => !blocked.has(`${r.employeeId}|${r.kpiDefinitionId}`))
            .slice(0, 5);
          approvalIds.push(...risky.map((r) => r.id));
        }
      }
    }
  }
  if (timedOut) logOutOfTime("runDeadlineReminders (gom danh sách)");

  // Gửi theo thứ tự ưu tiên: nhân viên (hạn sớm nhất) -> trưởng phòng -> BGĐ.
  // Mỗi tin không chặn tin khác; hết giờ thì dừng, lượt sau gửi nốt (dấu nhắc
  // đảm bảo không ai nhận hai lần).
  const opts = { budget, reserveMs: SEND_RESERVE_MS };
  const self = await runBounded(selfJobs, SEND_CONCURRENCY, notify, {
    ...opts,
    label: "nhắc tự khai KPI",
  });
  const mgr = await runBounded(managerJobs, SEND_CONCURRENCY, notify, {
    ...opts,
    label: "nhắc trưởng phòng duyệt KPI",
  });
  const ceo = await runBounded(ceoJobs, SEND_CONCURRENCY, notify, {
    ...opts,
    label: "nhắc BGĐ chốt kỳ",
  });
  let approvalRequests = 0;
  const appr = await runBounded(
    approvalIds,
    SEND_CONCURRENCY,
    async (id) => {
      const res = await sendKpiApprovalRequest(id);
      approvalRequests += res.sent;
    },
    { ...opts, label: "gửi nút duyệt KPI lệch số" }
  );

  return {
    selfReminders: self.done,
    managerReminders: mgr.done,
    ceoReminders: ceo.done,
    approvalRequests,
    failed: self.failed + mgr.failed + ceo.failed + appr.failed,
    skippedOutOfTime:
      timedOut || self.skipped + mgr.skipped + ceo.skipped + appr.skipped > 0,
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

  // Cron chạy 12 lượt/ngày — chỉ báo Ban Giám đốc tối đa 1 lần mỗi ngày.
  const alertedToday = await prisma.auditLog.findFirst({
    where: { action: "STALE_MISMATCH_ALERT", createdAt: { gte: vnStartOfDay(now) } },
    select: { id: true },
  });
  if (alertedToday) return { stale, alerted: false, reason: "Đã báo hôm nay" };

  // Ghi dấu "đã báo hôm nay" TRƯỚC khi gửi: lượt cron bị giết ngay sau khi
  // tin bay đi thì lượt sau không báo lặp. Gửi hỏng thì hôm nay thôi (như cũ —
  // trước đây dấu cũng được ghi dù gửi được hay không), log server ghi lỗi.
  await prisma.auditLog.create({
    data: {
      action: "STALE_MISMATCH_ALERT",
      entityName: "reconciliations",
      entityId: "system",
      afterPayload: JSON.stringify({ stale }),
    },
  });

  const res = await sendCeoAlert({
    title: `${stale} ô KPI treo vì lệch số quá ${staleHours} giờ`,
    details:
      "Hệ thống không tự chọn số khi các nguồn đá nhau. Chưa ai quyết thì mấy ô này không có số để chấm điểm.",
    actionPath: "/reconciliation",
  }).catch((e) => {
    console.error("[CRON] Gửi cảnh báo ô KPI treo thất bại:", e);
    return { sent: false };
  });

  return { stale, alerted: res.sent === true };
}
