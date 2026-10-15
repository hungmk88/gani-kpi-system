import { formatVnDateTime } from "../vn-time";
import { prisma } from "../db";
import { scoreTaskRisk } from "../risk";
import { sendCeoAlert, notify } from "../telegram";

const OPEN_STATUSES = ["BACKLOG", "TO_DO", "IN_PROGRESS", "BLOCKED", "REVIEW"];

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
export async function runRiskScan(now = new Date()) {
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
  let newCritical = 0;
  let remindersSent = 0;
  let overloaded = 0;
  let blockedByLate = 0;

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

    await prisma.task.update({
      where: { id: t.id },
      data: {
        riskScore: r.score,
        riskReason: r.reason || null,
        riskScannedAt: now,
      },
    });
    scanned++;
    if (load > 5) overloaded++;
    if (lateBlockers.length > 0) blockedByLate++;

    // Vượt ngưỡng báo động đỏ lần đầu -> báo Ban Giám đốc
    if (r.score >= 80 && before < 80) {
      newCritical++;
      await sendCeoAlert({
        title: `Việc báo động đỏ: ${t.title}`,
        details: `Phòng ${t.department.name} · Người phụ trách: ${
          t.assignee?.fullName ?? "CHƯA GIAO"
        } · Điểm rủi ro ${r.score}/100 · ${r.reason}`,
        actionPath: `/tasks/${t.id}`,
      });
    }

    // Nhắc người phụ trách khi việc trễ hoặc sắp trễ
    if (t.assigneeId && r.score >= 60 && before < 60) {
      await notify({
        userId: t.assigneeId,
        title: `Việc của bạn đang có nguy cơ: ${t.title}`,
        body: `${r.reason}. Hạn chót: ${formatVnDateTime(t.dueDate)}`,
        level: r.score >= 80 ? "CRITICAL" : "WARNING",
        linkUrl: `/tasks/${t.id}`,
      });
      remindersSent++;
    }
  }

  return { scanned, newCritical, remindersSent, overloaded, blockedByLate };
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
