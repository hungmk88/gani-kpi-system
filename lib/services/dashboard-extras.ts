import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { taskScopeWhere } from "@/lib/rbac";
import { vnDayRange, vnParts } from "@/lib/vn-time";
import {
  leaveDaysBetween,
  pendingLeaveForReviewerWhere,
} from "@/lib/services/leave-service";
import {
  gatekeeperOutcome,
  gatekeeperRuleFor,
  isCountedKpiRow,
  kpiCapFor,
  round2,
  type GatekeeperRule,
} from "@/lib/kpi";

/**
 * BA KHỐI "GANI VIVID" CỦA TRANG CHỦ: duyệt nhanh, Phòng của tôi, phiếu điểm
 * KPI. Tách khỏi dashboard-service cho dễ đọc; mỗi hàm tự giới hạn đúng phạm
 * vi người xem được — khớp luật ở các API duyệt tương ứng.
 */

const OPEN_STATUSES = ["BACKLOG", "TO_DO", "IN_PROGRESS", "REVIEW", "BLOCKED"];
const QUICK_LIMIT = 4;

/* ==================================================================== */
/* 1. DUYỆT NHANH                                                        */
/* ==================================================================== */

export type QuickApproval =
  | {
      kind: "LEAVE";
      id: string;
      who: string;
      title: string;
      detail: string;
      urgent: boolean;
      href: string;
    }
  | {
      kind: "REQUEST";
      id: string;
      who: string;
      title: string;
      detail: string;
      urgent: boolean;
      href: string;
    };

/**
 * Đơn đang chờ ĐÚNG người này quyết:
 * - Nghỉ phép: Trưởng phòng duyệt nhân viên phòng mình; Ban Giám đốc duyệt
 *   Trưởng phòng / Quản trị và đơn của phòng chưa có trưởng phòng
 *   (pendingLeaveForReviewerWhere trong leave-service — cùng luật với nơi
 *   gửi thông báo khi đơn được tạo).
 * - Yêu cầu liên phòng: Trưởng phòng của phòng NHẬN, hoặc Ban Giám đốc.
 * Người khác trả rỗng — khối không hiện.
 */
export async function buildQuickApprovals(user: SessionUser) {
  if (user.role !== "MANAGER" && user.role !== "CEO") {
    return { items: [] as QuickApproval[], total: 0 };
  }
  const leaveWhere = pendingLeaveForReviewerWhere(user) ?? { id: "__none__" };
  const requestWhere =
    user.role === "MANAGER"
      ? { status: "PENDING", targetDeptId: user.departmentId ?? "__none__" }
      : { status: "PENDING" };

  const [leaves, leaveCount, requests, requestCount] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: leaveWhere,
      // Gấp trước, rồi ngày nghỉ gần trước
      orderBy: [{ isUrgent: "desc" }, { startDate: "asc" }],
      take: QUICK_LIMIT,
      include: { employee: { select: { fullName: true } } },
    }),
    prisma.leaveRequest.count({ where: leaveWhere }),
    prisma.crossDeptRequest.findMany({
      where: requestWhere,
      orderBy: { dueDate: "asc" },
      take: QUICK_LIMIT,
      include: {
        requester: {
          select: { fullName: true, department: { select: { name: true } } },
        },
      },
    }),
    prisma.crossDeptRequest.count({ where: requestWhere }),
  ]);

  const items: QuickApproval[] = [
    ...leaves.map((l) => {
      const days = leaveDaysBetween(l.startDate, l.endDate);
      return {
        kind: "LEAVE" as const,
        id: l.id,
        who: l.employee.fullName,
        title: "Nghỉ phép",
        detail: `${dayRange(l.startDate, l.endDate)} · ${days} ngày`,
        urgent: l.isUrgent,
        href: "/leave-requests",
      };
    }),
    ...requests.map((r) => ({
      kind: "REQUEST" as const,
      id: r.id,
      who: r.requester.fullName,
      title: r.title,
      detail: `${r.requester.department?.name ?? "—"} · hạn ${dayMonth(r.dueDate)}`,
      urgent: r.priority === "CRITICAL" || r.priority === "HIGH",
      href: "/requests",
    })),
  ];

  return { items, total: leaveCount + requestCount };
}

/* ==================================================================== */
/* 2. PHÒNG CỦA TÔI                                                      */
/* ==================================================================== */

export type TeamMember = {
  id: string;
  name: string;
  jobTitle: string;
  isMe: boolean;
  /**
   * Thứ tự ưu tiên khi một người có nhiều tình trạng: nghỉ phép > trễ việc >
   * bị chặn > đang làm > chưa có việc. Chỉ trễ (đỏ) và bị chặn (vàng) có màu.
   */
  status: "LEAVE" | "OVERDUE" | "BLOCKED" | "WORKING" | "IDLE";
  label: string;
};

/**
 * Tình trạng từng người trong phòng hôm nay.
 *
 * Trưởng phòng thấy đủ (trễ việc, bị chặn, số việc đang làm). Nhân viên chỉ
 * thấy ai có mặt / ai nghỉ — số việc trễ của đồng nghiệp là thông tin quản lý,
 * nhân viên xem là vượt quyền (cùng luật với cân bằng tải).
 */
export async function buildMyTeam(user: SessionUser, now = new Date()) {
  if (
    !user.departmentId ||
    (user.role !== "MANAGER" && user.role !== "EMPLOYEE")
  ) {
    return null;
  }
  const { gte: dayStart, lt: dayEnd } = vnDayRange(now);
  const isManager = user.role === "MANAGER";

  const [dept, members, onLeave, taskStats] = await Promise.all([
    prisma.department.findUnique({
      where: { id: user.departmentId },
      select: { name: true },
    }),
    prisma.user.findMany({
      where: {
        departmentId: user.departmentId,
        isActive: true,
        role: { not: "ADMIN" },
      },
      select: { id: true, fullName: true, jobTitle: true, role: true },
      orderBy: [{ role: "asc" }, { fullName: "asc" }],
    }),
    prisma.leaveRequest.findMany({
      where: {
        status: "APPROVED",
        departmentId: user.departmentId,
        startDate: { lt: dayEnd },
        endDate: { gte: dayStart },
      },
      select: { employeeId: true, endDate: true },
    }),
    isManager
      ? prisma.task.findMany({
          where: {
            ...taskScopeWhere(user),
            status: { in: OPEN_STATUSES },
            assignee: { departmentId: user.departmentId },
          },
          select: { assigneeId: true, status: true, dueDate: true },
        })
      : Promise.resolve([]),
  ]);

  const leaveUntil = new Map(onLeave.map((l) => [l.employeeId, l.endDate]));
  const stats = new Map<
    string,
    { open: number; overdue: number; blocked: number }
  >();
  for (const t of taskStats) {
    if (!t.assigneeId) continue;
    const s = stats.get(t.assigneeId) ?? { open: 0, overdue: 0, blocked: 0 };
    s.open += 1;
    if (t.status === "BLOCKED") s.blocked += 1;
    else if (t.dueDate < now) s.overdue += 1;
    stats.set(t.assigneeId, s);
  }

  const rank: Record<TeamMember["status"], number> = {
    OVERDUE: 0,
    BLOCKED: 1,
    LEAVE: 2,
    WORKING: 3,
    IDLE: 4,
  };

  const list: TeamMember[] = members.map((m) => {
    const until = leaveUntil.get(m.id);
    const s = stats.get(m.id);
    let status: TeamMember["status"];
    let label: string;
    if (until) {
      status = "LEAVE";
      label = `Nghỉ phép tới ${dayMonth(until)}`;
    } else if (!isManager) {
      status = "WORKING";
      label = "Có mặt";
    } else if (s && s.overdue > 0) {
      status = "OVERDUE";
      label = `Trễ ${s.overdue} việc`;
    } else if (s && s.blocked > 0) {
      status = "BLOCKED";
      label = `${s.blocked} việc bị chặn`;
    } else if (s && s.open > 0) {
      status = "WORKING";
      label = `Đang làm ${s.open} việc`;
    } else {
      status = "IDLE";
      label = "Chưa có việc";
    }
    return {
      id: m.id,
      name: m.fullName,
      jobTitle: m.jobTitle ?? "",
      isMe: m.id === user.id,
      status,
      label,
    };
  });

  // Trưởng phòng: người cần để ý lên đầu. Nhân viên: giữ thứ tự tên.
  if (isManager) list.sort((a, b) => rank[a.status] - rank[b.status]);

  return {
    departmentName: dept?.name ?? "",
    members: list,
    present: list.filter((m) => m.status !== "LEAVE").length,
    detailed: isManager,
  };
}

/* ==================================================================== */
/* 3. PHIẾU ĐIỂM KPI                                                     */
/* ==================================================================== */

export type PayslipLine = {
  id: string;
  name: string;
  weight: number;
  /** Mức đạt đã chặn trần; null = chưa có số */
  achievement: number | null;
  cap: number;
  capped: boolean;
  score: number;
  gatekeeper:
    | (GatekeeperRule & { outcome: "NO_DATA" | "PASS" | "FAIL" })
    | null;
};

type PayslipRow = {
  id: string;
  weightPercent: number | null;
  achievementPercent: number;
  weightedScore: number;
  isCapped: boolean;
  actualFinal: number | null;
  actualSelf: number | null;
  actualSystem: number | null;
  kpiDefinition: {
    name: string;
    code: string;
    isActive: boolean;
    department?: { code: string } | null;
  } | null;
};

/**
 * Phiếu điểm kiểu phiếu lương: phần CỘNG (từng chỉ tiêu × trọng số) và phần
 * TRỪ (gatekeeper vượt ngưỡng), rồi tổng. Hàm thuần — dữ liệu nạp sẵn ở
 * dashboard-service — để test được.
 */
export function buildKpiPayslip(rows: PayslipRow[]) {
  const lines: PayslipLine[] = rows.filter(isCountedKpiRow).map((r) => {
    const actual = r.actualFinal ?? r.actualSelf ?? r.actualSystem;
    const rule = gatekeeperRuleFor(r.kpiDefinition?.code);
    return {
      id: r.id,
      name: r.kpiDefinition?.name ?? "—",
      weight: r.weightPercent ?? 0,
      achievement: actual === null ? null : r.achievementPercent,
      cap: kpiCapFor(r.kpiDefinition?.department?.code),
      capped: !rule && r.isCapped,
      score: r.weightedScore,
      gatekeeper: rule
        ? { ...rule, outcome: gatekeeperOutcome(rule, actual) }
        : null,
    };
  });
  const earned = lines.filter((l) => !l.gatekeeper);
  const deductions = lines.filter((l) => l.gatekeeper);
  const earnedTotal = round2(earned.reduce((s, l) => s + l.score, 0));
  const deductionTotal = round2(
    deductions.reduce((s, l) => s + Math.min(0, l.score), 0),
  );
  return {
    earned,
    deductions,
    earnedTotal,
    deductionTotal,
    total: round2(earnedTotal + deductionTotal),
  };
}

export type KpiPayslip = ReturnType<typeof buildKpiPayslip>;

/* ------------------------------------------------------------ tiện ích */

const pad = (n: number) => String(n).padStart(2, "0");

function dayMonth(d: Date) {
  const p = vnParts(d);
  return `${pad(p.day)}/${pad(p.month)}`;
}

function dayRange(a: Date, b: Date) {
  const x = dayMonth(a);
  const y = dayMonth(b);
  return x === y ? x : `${x} → ${y}`;
}
