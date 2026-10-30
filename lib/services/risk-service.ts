import { formatVnDateTime } from "../vn-time";
import { prisma } from "../db";
import { scoreTaskRisk } from "../risk";
import { sendCeoAlert, notify, type NotifyInput } from "../telegram";
import { logOutOfTime, runBounded, TimeBudget } from "../time-budget";

const OPEN_STATUSES = ["BACKLOG", "TO_DO", "IN_PROGRESS", "BLOCKED", "REVIEW"];
/** Số lệnh UPDATE mỗi transaction — đủ nhỏ để không giữ khoá dòng lâu. */
const UPDATE_CHUNK = 50;
/** Số id mỗi lệnh updateMany chỉ đóng dấu thời điểm quét. */
const STAMP_CHUNK = 1000;
const UPDATE_RESERVE_MS = 2000;
const SEND_CONCURRENCY = 5;
const SEND_RESERVE_MS = 3000;

/**
 * Quét rủi ro toàn bộ task đang mở, cập nhật risk_score + risk_reason.
 *
 * Tính cả hai yếu tố liên quan tới ngữ cảnh, thứ mà chấm từng task riêng lẻ
 * không nhìn ra được:
 *   - Người phụ trách đang ôm bao nhiêu việc dở dang (quá tải).
 *   - Việc này có đang đứng chờ một việc khác đã trễ hay không (mắt xích gãy).
 *
 * Task vọt lên mức CRITICAL mà lần quét trước chưa phải CRITICAL thì bắn cảnh
 * báo đỏ về Telegram Ban Giám đốc — đúng nguyên tắc quản trị ngoại lệ: chỉ báo
 * cái mới phát sinh, không nhắc lại cái Ban Giám đốc đã biết.
 */
export async function runRiskScan(
  now = new Date(),
  budget: TimeBudget = TimeBudget.unlimited()
) {
  const tasks = await prisma.task.findMany({
    where: { status: { notIn: ["DONE", "CANCELLED"] } },
    include: {
      assignee: true,
      department: true,
      dependencies: { include: { dependsOn: true } },
    },
  });

  // Đếm việc dở dang theo từng người, một lần cho cả lượt quét
  const loadRows = await prisma.task.groupBy({
    by: ["assigneeId"],
    where: { status: "IN_PROGRESS", assigneeId: { not: null } },
    _count: { _all: true },
  });
  const loadMap = new Map<string, number>();
  for (const r of loadRows) {
    if (r.assigneeId) loadMap.set(r.assigneeId, r._count._all);
  }

  let scanned = 0;
  let overloaded = 0;
  let blockedByLate = 0;

  // Gom thay đổi trước, ghi sau: trước đây mỗi task mở một lệnh UPDATE riêng
  // (kể cả khi điểm không đổi) — vài trăm task là vài trăm vòng tới pooler.
  const changed: { id: string; score: number; reason: string | null }[] = [];
  const unchangedIds: string[] = [];
  // Kèm taskId: chỉ báo cho task đã GHI được điểm mới, nếu không lượt sau
  // (vẫn thấy điểm cũ < ngưỡng) sẽ báo lặp.
  const ceoAlerts: { taskId: string; alert: Parameters<typeof sendCeoAlert>[0] }[] = [];
  const assigneeAlerts: { taskId: string; alert: NotifyInput }[] = [];

  for (const t of tasks) {
    const before = t.riskScore;

    const lateBlockers = t.dependencies
      .filter(
        (d) =>
          OPEN_STATUSES.includes(d.dependsOn.status) &&
          new Date(d.dependsOn.dueDate).getTime() < now.getTime()
      )
      .map((d) => d.dependsOn.title);

    const load = t.assigneeId ? (loadMap.get(t.assigneeId) ?? 0) : 0;

    const r = scoreTaskRisk(
      {
        status: t.status,
        priority: t.priority,
        progress: t.progress,
        startDate: t.startDate,
        dueDate: t.dueDate,
        blockedSince: t.blockedSince,
        assigneeId: t.assigneeId,
        assigneeActiveTaskCount: load,
        lateBlockers,
      },
      now
    );

    const reason = r.reason || null;
    if (r.score === t.riskScore && reason === t.riskReason) unchangedIds.push(t.id);
    else changed.push({ id: t.id, score: r.score, reason });
    scanned++;
    if (load > 5) overloaded++;
    if (lateBlockers.length > 0) blockedByLate++;

    // Vượt ngưỡng báo động đỏ lần đầu -> báo Ban Giám đốc
    if (r.score >= 80 && before < 80) {
      ceoAlerts.push({
        taskId: t.id,
        alert: {
          title: `Việc báo động đỏ: ${t.title}`,
          details: `Phòng ${t.department.name} · Người phụ trách: ${
            t.assignee?.fullName ?? "CHƯA GIAO"
          } · Điểm rủi ro ${r.score}/100 · ${r.reason}`,
          actionPath: `/tasks/${t.id}`,
        },
      });
    }

    // Nhắc người phụ trách khi việc trễ hoặc sắp trễ
    if (t.assigneeId && r.score >= 60 && before < 60) {
      assigneeAlerts.push({
        taskId: t.id,
        alert: {
          userId: t.assigneeId,
          title: `Việc của bạn đang có nguy cơ: ${t.title}`,
          body: `${r.reason}. Hạn chót: ${formatVnDateTime(t.dueDate)}`,
          level: r.score >= 80 ? "CRITICAL" : "WARNING",
          linkUrl: `/tasks/${t.id}`,
        },
      });
    }
  }

  // Ghi điểm mới theo lô, mỗi lô một transaction (pgbouncer chế độ
  // transaction vẫn chạy được $transaction dạng mảng). Task không đổi điểm chỉ
  // cần đóng dấu riskScannedAt — một lệnh updateMany cho cả lô.
  const written = new Set<string>();
  for (let i = 0; i < changed.length; i += UPDATE_CHUNK) {
    if (budget.expired(UPDATE_RESERVE_MS)) {
      logOutOfTime("runRiskScan (ghi điểm)", changed.length - i);
      break;
    }
    const chunk = changed.slice(i, i + UPDATE_CHUNK);
    await prisma.$transaction(
      chunk.map((c) =>
        prisma.task.update({
          where: { id: c.id },
          data: { riskScore: c.score, riskReason: c.reason, riskScannedAt: now },
        })
      )
    );
    for (const c of chunk) written.add(c.id);
  }
  for (let i = 0; i < unchangedIds.length; i += STAMP_CHUNK) {
    if (budget.expired(UPDATE_RESERVE_MS)) break;
    await prisma.task.updateMany({
      where: { id: { in: unchangedIds.slice(i, i + STAMP_CHUNK) } },
      data: { riskScannedAt: now },
    });
  }

  // Thông báo SAU khi đã ghi điểm: gửi hỏng/hết giờ không làm mất điểm rủi ro.
  const ceoToSend = ceoAlerts.filter((a) => written.has(a.taskId)).map((a) => a.alert);
  const assigneeToSend = assigneeAlerts
    .filter((a) => written.has(a.taskId))
    .map((a) => a.alert);
  const ceo = await runBounded(ceoToSend, SEND_CONCURRENCY, (a) => sendCeoAlert(a), {
    budget,
    reserveMs: SEND_RESERVE_MS,
    label: "cảnh báo đỏ quét rủi ro",
  });
  const assignee = await runBounded(assigneeToSend, SEND_CONCURRENCY, notify, {
    budget,
    reserveMs: SEND_RESERVE_MS,
    label: "nhắc người phụ trách quét rủi ro",
  });

  return {
    scanned,
    updated: written.size,
    newCritical: ceo.done,
    remindersSent: assignee.done,
    overloaded,
    blockedByLate,
  };
}

/**
 * Lấy đủ ngữ cảnh để chấm rủi ro cho MỘT task.
 * Dùng khi tạo hoặc cập nhật task lẻ, để điểm rủi ro tức thời khớp với
 * điểm mà lượt quét định kỳ sẽ tính ra.
 */
export async function riskContextFor(
  taskId: string | null,
  assigneeId: string | null,
  now = new Date()
) {
  const assigneeActiveTaskCount = assigneeId
    ? await prisma.task.count({
        where: { assigneeId, status: "IN_PROGRESS" },
      })
    : 0;

  let lateBlockers: string[] = [];
  if (taskId) {
    const deps = await prisma.taskDependency.findMany({
      where: { taskId },
      include: { dependsOn: true },
    });
    lateBlockers = deps
      .filter(
        (d) =>
          OPEN_STATUSES.includes(d.dependsOn.status) &&
          new Date(d.dependsOn.dueDate).getTime() < now.getTime()
      )
      .map((d) => d.dependsOn.title);
  }

  return { assigneeActiveTaskCount, lateBlockers };
}
