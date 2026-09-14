import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { taskScopeWhere } from "@/lib/rbac";
import { summarizeResults, classifyScore } from "@/lib/kpi";
import { periodName } from "@/lib/codes";
import { getCapacityReports } from "@/lib/services/analytics-service";
import { CONFIDENCE_LABEL } from "@/lib/analytics/constants";

/**
 * GOM DỮ LIỆU CHO BẢNG ĐIỀU HÀNH.
 *
 * Trang bảng điều hành trước đây tự gọi thẳng Prisma. Sau khi thêm thanh nhịp
 * kỳ KPI, hàng chờ hành động, số liệu so kỳ trước và ba bộ máy Phase 4 thì phần
 * gom dữ liệu dài gấp ba phần hiển thị — nên tách hẳn ra đây.
 *
 * File này KHÔNG biết gì về giao diện: nó trả dữ liệu thuần, mọi quyết định về
 * màu sắc và chữ nghĩa nằm ở components/dashboard.tsx.
 */

const OPEN_STATUSES = ["BACKLOG", "TO_DO", "IN_PROGRESS", "BLOCKED", "REVIEW"];

/** Số kỳ vẽ lên cột mini của thẻ điểm KPI. */
const TREND_PERIODS = 6;

/* ==================================================================== */
/* KIỂU DỮ LIỆU                                                          */
/* ==================================================================== */

export type GateLeg = {
  key: "SELF" | "MANAGER" | "CEO";
  label: string;
  deadline: Date;
  /** done = đã đóng · now = đang mở · future = chưa tới */
  state: "done" | "now" | "future";
  /** Cửa này có phải việc của chính người đang xem không */
  mine: boolean;
};

export type GateState = {
  periodName: string;
  periodStatus: string;
  legs: GateLeg[];
  /** Cửa đang mở — null khi cả ba đã đóng */
  openLeg: GateLeg | null;
  /** Còn bao lâu thì cửa đang mở đóng lại, đã format sẵn */
  remaining: string | null;
  /** Cửa đang mở có phải của người đang xem không */
  isMyTurn: boolean;
};

export type ActionItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  cta: string;
  /** Tông màu vệt bên trái */
  tone: "red" | "amber" | "brand";
  /** Nhãn thời gian bên trái, đã format sẵn */
  when: string;
  /**
   * Quá hạn là KHOÁ THẬT, không làm bù được. Những việc này luôn xếp trước,
   * kể cả khi việc khác đã trễ lâu hơn — vì việc trễ còn làm bù được, còn cửa
   * KPI đóng lúc 23:59 thì thôi.
   */
  hardLock: boolean;
  /** Mốc dùng để xếp thứ tự; null thì xuống cuối */
  dueAt: Date | null;
};

export type TrendStat = {
  value: number;
  /** Chênh so với mốc so sánh — dương là tăng */
  delta: number | null;
};

export type DashboardAlert = {
  id: string;
  kind: "ANOMALY" | "PREDICTION" | "MISMATCH" | "CAPACITY";
  title: string;
  detail: string;
  footnote: string;
  href: string;
  tone: "red" | "amber" | "brand";
};

export type LeanTask = {
  id: string;
  code: string;
  title: string;
  assignee: string;
  progress: number;
  dueDate: Date;
  /** Số ngày trễ, chỉ có ở nhóm quá hạn */
  lateDays?: number;
};

export type ProductionSummary = {
  /** Số người có mặt trong ít nhất một ca sản xuất hôm nay (không phân biệt ca đã khoá hay chưa) */
  workforceToday: number;
  /** Tổng sản lượng đã qua KCS xác nhận, từ đầu tháng tới hôm nay, đơn vị tấn */
  outputTonnes: number;
  /** Số ca trong tháng vẫn còn ở bước khai, chưa được KCS xác nhận — sản lượng của các ca này CHƯA tính vào outputTonnes */
  pendingQcShifts: number;
  monthLabel: string;
};

/* ==================================================================== */
/* NHỊP KỲ KPI                                                           */
/* ==================================================================== */

/** "9 giờ 11 phút" · "2 ngày 4 giờ" · "12 phút" */
function formatRemaining(ms: number): string {
  if (ms <= 0) return "đã đóng";
  const mins = Math.floor(ms / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (days >= 1) {
    const h = hours % 24;
    return h > 0 ? `${days} ngày ${h} giờ` : `${days} ngày`;
  }
  if (hours >= 1) {
    const m = mins % 60;
    return m > 0 ? `${hours} giờ ${m} phút` : `${hours} giờ`;
  }
  return `${mins} phút`;
}

/** Số ngày trễ, làm tròn lên — trễ 3 tiếng vẫn tính là 1 ngày. */
function lateDays(due: Date, now: Date): number {
  return Math.max(1, Math.ceil((now.getTime() - due.getTime()) / 86_400_000));
}

/**
 * Dựng ba chặng của kỳ KPI và xác định hôm nay đang đứng ở đâu.
 *
 * Đây là thứ bảng điều hành cũ thiếu hẳn. Hệ thống có ba cửa đóng cứng mỗi
 * tháng, quá giờ là khoá thật — mà người dùng phải tự nhớ hôm nay là ngày mấy.
 */
function buildGateState(
  period: {
    name: string;
    status: string;
    selfReviewDeadline: Date;
    managerReviewDeadline: Date;
    ceoApprovalDeadline: Date;
  },
  role: string,
  now: Date,
): GateState {
  const raw: {
    key: GateLeg["key"];
    label: string;
    deadline: Date;
    owner: string;
  }[] = [
    {
      key: "SELF",
      label: "Nhân viên tự khai",
      deadline: new Date(period.selfReviewDeadline),
      owner: "EMPLOYEE",
    },
    {
      key: "MANAGER",
      label: "Trưởng phòng duyệt",
      deadline: new Date(period.managerReviewDeadline),
      owner: "MANAGER",
    },
    {
      key: "CEO",
      label: "Ban Giám đốc chốt",
      deadline: new Date(period.ceoApprovalDeadline),
      owner: "CEO",
    },
  ];

  // Cửa đang mở là cửa đầu tiên chưa quá hạn. Kỳ đã chốt thì không cửa nào mở.
  const firstOpen =
    period.status === "FINALIZED"
      ? -1
      : raw.findIndex((r) => now <= r.deadline);

  const legs: GateLeg[] = raw.map((r, i) => ({
    key: r.key,
    label: r.label,
    deadline: r.deadline,
    state:
      firstOpen === -1 || i < firstOpen
        ? "done"
        : i === firstOpen
          ? "now"
          : "future",
    mine: r.owner === role,
  }));

  const openLeg = legs.find((l) => l.state === "now") ?? null;

  return {
    periodName: period.name,
    periodStatus: period.status,
    legs,
    openLeg,
    remaining: openLeg
      ? formatRemaining(openLeg.deadline.getTime() - now.getTime())
      : null,
    isMyTurn: openLeg?.mine ?? false,
  };
}

/* ==================================================================== */
/* NHÂN LỰC & SẢN LƯỢNG XƯỞNG                                            */
/* ==================================================================== */

/**
 * Hai chỉ số nhìn nhanh về xưởng: hôm nay có bao nhiêu người đang làm, và
 * tháng này đã ra được bao nhiêu tấn.
 *
 * Sản lượng chỉ tính ca đã qua KCS xác nhận (`qcPassedKg`), không tính số thô
 * tự khai (`rawOutputKg`) — đúng quy ước đã có sẵn ở trang Xưởng sản xuất, nơi
 * cột "đạt" hiện dấu gạch ngang cho tới khi KCS xác nhận. Số thô là lời tự khai,
 * chưa ai kiểm; đưa lên trang chủ dưới danh nghĩa "sản lượng" mà chưa ai xác
 * minh thì sai bản chất con số. Ca chưa xác nhận vẫn được đếm riêng để không
 * giấu việc số liệu chưa đầy đủ.
 */
async function buildProductionSummary(now: Date): Promise<ProductionSummary> {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [participantsToday, confirmed, pendingQcShifts] = await Promise.all([
    prisma.productionShiftParticipant.findMany({
      where: {
        shiftLog: { shiftDate: { gte: startOfToday, lt: startOfTomorrow } },
      },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.productionShiftLog.aggregate({
      where: {
        shiftDate: { gte: startOfMonth, lt: startOfTomorrow },
        status: { in: ["QC_APPROVED", "LOCKED"] },
      },
      _sum: { qcPassedKg: true },
    }),
    prisma.productionShiftLog.count({
      where: {
        shiftDate: { gte: startOfMonth, lt: startOfTomorrow },
        status: "DRAFT",
      },
    }),
  ]);

  return {
    workforceToday: participantsToday.length,
    outputTonnes:
      Math.round(((confirmed._sum.qcPassedKg ?? 0) / 1000) * 10) / 10,
    pendingQcShifts,
    monthLabel: periodName(now.getMonth() + 1, now.getFullYear()),
  };
}

/* ==================================================================== */
/* GOM TẤT CẢ                                                            */
/* ==================================================================== */

export async function buildDashboard(user: SessionUser, now = new Date()) {
  const scope = taskScopeWhere(user);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);

  const openWhere = { ...scope, status: { in: OPEN_STATUSES } };

  /**
   * Mốc so sánh "một tuần trước" dựng lại từ dấu thời gian chứ không đọc bản
   * chụp — hệ thống không lưu chuỗi thời gian của số việc. Một việc bị huỷ
   * trong tuần sẽ không được đếm vào mốc cũ vì không có cột thời điểm huỷ;
   * sai lệch nhỏ và luôn lệch về một phía, chấp nhận được cho một mũi tên xu hướng.
   */
  const existedAWeekAgo = {
    ...scope,
    createdAt: { lte: weekAgo },
    status: { not: "CANCELLED" },
    OR: [{ completedAt: null }, { completedAt: { gt: weekAgo } }],
  };

  const period = await prisma.kpiPeriod.findFirst({
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  const isLeader = user.role === "MANAGER" || user.role === "CEO";

  /**
   * Trang /analytics đá cả nhân viên lẫn quản trị về /dashboard. Nên đường dẫn
   * của cảnh báo phải theo vai trò, nếu không là dựng ra nút bấm quay vòng.
   * Nhân viên giải trình ngay tại chỗ, ở khối cuối bảng điều hành.
   */
  const anomalyHref = isLeader ? "/analytics" : "/dashboard#giai-trinh";
  const analyticsHref = isLeader ? "/analytics" : "/tasks";

  const [
    openCount,
    overdueCount,
    openCountWeekAgo,
    overdueCountWeekAgo,
    overdueTasks,
    todayTasks,
    myResults,
    pendingReview,
    trendPeriods,
    anomalies,
    predictions,
    mismatchCount,
    capacity,
    production,
    pendingLeaveRequests,
  ] = await Promise.all([
    prisma.task.count({ where: openWhere }),
    prisma.task.count({ where: { ...openWhere, dueDate: { lt: now } } }),
    prisma.task.count({ where: existedAWeekAgo }),
    prisma.task.count({
      where: { ...existedAWeekAgo, dueDate: { lt: weekAgo } },
    }),

    // Hai nhóm việc tách hẳn nhau: đã trễ và hết hạn hôm nay là hai tình huống
    // khác nhau về cách xử, trộn chung một danh sách là đánh đồng.
    prisma.task.findMany({
      where: { ...openWhere, dueDate: { lt: now } },
      orderBy: { dueDate: "asc" },
      take: 5,
      include: { assignee: { select: { fullName: true } } },
    }),
    prisma.task.findMany({
      where: { ...openWhere, dueDate: { gte: now, lte: endOfToday } },
      orderBy: { dueDate: "asc" },
      take: 5,
      include: { assignee: { select: { fullName: true } } },
    }),

    period
      ? prisma.kpiResult.findMany({
          where: { periodId: period.id, employeeId: user.id },
          include: { kpiDefinition: true },
          orderBy: { weightPercent: "desc" },
        })
      : Promise.resolve([]),

    period && user.role === "MANAGER"
      ? prisma.kpiResult.count({
          where: {
            periodId: period.id,
            status: "SELF_REVIEWED",
            employee: { departmentId: user.departmentId ?? "__none__" },
          },
        })
      : period && user.role === "CEO"
        ? prisma.kpiResult.count({
            where: { periodId: period.id, status: "MANAGER_REVIEWED" },
          })
        : Promise.resolve(0),

    prisma.kpiPeriod.findMany({
      orderBy: [{ year: "desc" }, { month: "desc" }],
      take: TREND_PERIODS,
      select: { id: true, name: true },
    }),

    // Bất thường KPI: mỗi vai trò nhìn thấy phần việc của mình.
    // Nhân viên xem cái của chính họ để còn giải trình; trưởng phòng xem cả
    // phòng; Ban Giám đốc chỉ quan tâm cái đã giải trình xong đang chờ quyết.
    // Quản trị không có KPI và cũng không vào được trang Phân tích, nên không
    // nhận gì — đưa cho họ chỉ tổ dựng ra nút bấm không đi tới đâu.
    period && user.role !== "ADMIN"
      ? prisma.kpiAnomaly.findMany({
          where: {
            periodId: period.id,
            ...(user.role === "EMPLOYEE"
              ? { employeeId: user.id, status: "OPEN" }
              : user.role === "MANAGER"
                ? {
                    employee: { departmentId: user.departmentId ?? "__none__" },
                    status: { in: ["OPEN", "EXPLAINED"] },
                  }
                : { status: { in: ["OPEN", "EXPLAINED"] } }),
          },
          orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
          take: 4,
          include: {
            employee: { select: { fullName: true } },
            kpiDefinition: { select: { name: true } },
          },
        })
      : Promise.resolve([]),

    // Dự báo vỡ kế hoạch — lấy dư rồi lọc bản mới nhất của mỗi việc, vì một
    // việc có nhiều lượt dự báo chồng lên nhau.
    user.role === "ADMIN"
      ? Promise.resolve([])
      : prisma.predictionLog.findMany({
          where: {
            outcomeKnown: false,
            riskCategory: "HIGH_FAILURE_RISK",
            task: openWhere,
          },
          orderBy: { predictedAt: "desc" },
          take: 20,
          include: {
            task: {
              select: { id: true, code: true, title: true, dueDate: true },
            },
          },
        }),

    period && isLeader
      ? prisma.reconciliation.count({
          where: {
            periodId: period.id,
            status: "MISMATCH",
            ...(user.role === "MANAGER"
              ? { employee: { departmentId: user.departmentId ?? "__none__" } }
              : {}),
          },
        })
      : Promise.resolve(0),

    // Cân bằng tải chỉ có nghĩa với người quản lý người khác. Nhân viên xem
    // tải của đồng nghiệp là vượt quyền, nên không tính luôn cho đỡ tốn.
    isLeader
      ? getCapacityReports(
          user.role === "MANAGER" ? (user.departmentId ?? "__none__") : null,
        )
      : Promise.resolve(null),

    // Chỉ Admin và Ban Giám đốc cần thấy nhịp toàn xưởng ngay trang chủ —
    // Trưởng phòng và nhân viên đã có mục Xưởng sản xuất riêng cho việc này.
    user.role === "ADMIN" || user.role === "CEO"
      ? buildProductionSummary(now)
      : Promise.resolve(null),

    // Đơn xin nghỉ đang chờ ĐÚNG người này duyệt — khớp luật ở
    // app/api/leave-requests/[id]/route.ts: Trưởng phòng duyệt nhân viên
    // phòng mình, Ban Giám đốc duyệt Trưởng phòng/Admin.
    user.role === "MANAGER"
      ? prisma.leaveRequest.count({
          where: {
            status: "PENDING",
            departmentId: user.departmentId ?? "__none__",
            employee: { role: { not: "MANAGER" } },
          },
        })
      : user.role === "CEO"
        ? prisma.leaveRequest.count({
            where: {
              status: "PENDING",
              employee: { role: { in: ["MANAGER", "ADMIN"] } },
            },
          })
        : Promise.resolve(0),
  ]);

  /* ------------------------------------------------ điểm KPI theo kỳ */

  const trendIds = trendPeriods.map((p) => p.id);
  const kpiScopeWhere =
    user.role === "EMPLOYEE"
      ? { employeeId: user.id }
      : user.role === "MANAGER"
        ? { employee: { departmentId: user.departmentId ?? "__none__" } }
        : {};

  const trendRows =
    trendIds.length > 0 && user.role !== "ADMIN"
      ? await prisma.kpiResult.groupBy({
          by: ["periodId", "employeeId"],
          where: { periodId: { in: trendIds }, ...kpiScopeWhere },
          _sum: { weightedScore: true },
        })
      : [];

  // Điểm của một kỳ = trung bình tổng điểm của từng người trong tầm nhìn.
  // Cộng thẳng weightedScore của cả phòng sẽ ra một con số vô nghĩa vì mỗi
  // người đã có thang 100 riêng.
  const byPeriod = new Map<string, number[]>();
  for (const r of trendRows) {
    const arr = byPeriod.get(r.periodId) ?? [];
    arr.push(r._sum.weightedScore ?? 0);
    byPeriod.set(r.periodId, arr);
  }

  const trend = [...trendPeriods]
    .reverse() // cũ → mới, đúng chiều đọc của cột mini
    .map((p) => {
      const arr = byPeriod.get(p.id) ?? [];
      const avg =
        arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
      return { periodId: p.id, name: p.name, score: Math.round(avg * 10) / 10 };
    });

  const withScore = trend.filter((t) => t.score > 0);
  const kpiScore: TrendStat | null =
    withScore.length > 0
      ? {
          value: withScore[withScore.length - 1].score,
          delta:
            withScore.length >= 2
              ? Math.round(
                  (withScore[withScore.length - 1].score -
                    withScore[withScore.length - 2].score) *
                    10,
                ) / 10
              : null,
        }
      : null;

  /* ------------------------------------------------ KPI của chính tôi */

  const mySummary = summarizeResults(myResults);
  const myClass = classifyScore(mySummary.totalScore);
  const myDraft = myResults.filter((r) => r.status === "DRAFT").length;
  // Chỉ tiêu đang kéo tụt: thấp nhất và dưới ngưỡng đạt
  const myWeakest =
    myResults.length > 0
      ? [...myResults].sort(
          (a, b) => a.achievementPercent - b.achievementPercent,
        )[0]
      : null;

  /* ------------------------------------------------ nhịp kỳ */

  const gate =
    period && user.role !== "ADMIN"
      ? buildGateState(period, user.role, now)
      : null;

  /* ------------------------------------------------ hàng chờ hành động */

  const queue: ActionItem[] = [];

  // 1. Cửa KPI của chính mình, nếu còn việc chưa xong
  if (gate?.openLeg && gate.isMyTurn) {
    const remaining = gate.remaining ?? "";
    if (user.role === "EMPLOYEE" && myDraft > 0) {
      queue.push({
        id: "gate-self",
        title: `Tự khai ${myDraft} chỉ tiêu KPI ${gate.periodName}`,
        detail:
          "Quá 23:59 là khoá, không khai bù được — chỉ tiêu chưa khai bị tính 0.",
        href: "/kpi",
        cta: "Khai ngay",
        tone: "red",
        when: remaining,
        hardLock: true,
        dueAt: gate.openLeg.deadline,
      });
    } else if (isLeader && pendingReview > 0) {
      queue.push({
        id: "gate-review",
        title: `Duyệt ${pendingReview} chỉ tiêu KPI ${
          user.role === "MANAGER" ? "của phòng" : "toàn công ty"
        }`,
        detail:
          user.role === "MANAGER"
            ? "Quá 23:59 là khoá, đẩy thẳng lên Ban Giám đốc ở trạng thái chưa duyệt."
            : "Quá hạn chốt thì kỳ treo lại, phòng ban không xem được điểm cuối.",
        href: "/kpi",
        cta: "Duyệt ngay",
        tone: "red",
        when: remaining,
        hardLock: true,
        dueAt: gate.openLeg.deadline,
      });
    }
  }

  // 2. Việc đã quá hạn
  if (overdueCount > 0 && overdueTasks.length > 0) {
    const oldest = overdueTasks[0];
    const days = lateDays(new Date(oldest.dueDate), now);
    queue.push({
      id: "overdue",
      title: `${overdueCount} việc đã quá hạn${
        user.role === "EMPLOYEE" ? "" : " trong tầm quản lý"
      }`,
      detail: `Sớm nhất: ${oldest.code} trễ ${days} ngày, tiến độ mới ${oldest.progress}%.`,
      href: "/tasks?filter=overdue",
      cta: "Xem",
      tone: "amber",
      when: `${days} ngày`,
      hardLock: false,
      dueAt: new Date(oldest.dueDate),
    });
  }

  // 3. Bất thường KPI cần chính người này xử
  const myAnomalies = anomalies.filter((a) =>
    user.role === "CEO" ? a.status === "EXPLAINED" : a.status === "OPEN",
  );
  if (myAnomalies.length > 0) {
    const first = myAnomalies[0];
    queue.push({
      id: "anomaly",
      title:
        user.role === "EMPLOYEE"
          ? `${myAnomalies.length} chỉ tiêu của bạn bị đánh dấu bất thường`
          : user.role === "CEO"
            ? `${myAnomalies.length} giải trình bất thường chờ bạn quyết`
            : `${myAnomalies.length} chỉ tiêu trong phòng chưa có giải trình`,
      detail:
        user.role === "EMPLOYEE"
          ? `${first.kpiDefinition.name} — chưa giải trình thì Ban Giám đốc không chốt được.`
          : `${first.employee.fullName} · ${first.kpiDefinition.name}`,
      href: anomalyHref,
      cta: user.role === "EMPLOYEE" ? "Giải trình" : "Xem",
      tone: "amber",
      when: "kỳ này",
      hardLock: false,
      dueAt: period ? new Date(period.ceoApprovalDeadline) : null,
    });
  }

  // 4. Quá tải nhân sự
  const overloaded = capacity?.reports.filter(
    (r) => r.workloadStatus === "OVERLOADED",
  );
  if (overloaded && overloaded.length > 0) {
    const worst = overloaded[0];
    const suggestion = capacity?.suggestions[0];
    queue.push({
      id: "capacity",
      title: `${worst.fullName} đang gánh ${worst.utilizationPercent}% tải`,
      detail: suggestion
        ? `${suggestion.to.fullName} còn dư sức — gợi ý san bớt ${suggestion.suggestedHours} giờ việc.`
        : `${overloaded.length} người đang quá tải trong tầm quản lý.`,
      href: "/analytics",
      cta: "Cân tải",
      tone: "brand",
      when: "tuần này",
      hardLock: false,
      dueAt: null,
    });
  }

  // 5. Lệch số liệu treo chờ quyết
  if (mismatchCount > 0) {
    queue.push({
      id: "mismatch",
      title: `${mismatchCount} ô KPI đang lệch số giữa các nguồn`,
      detail: "Chưa quyết lấy số nào thì kỳ không chốt được.",
      href: "/reconciliation",
      cta: "Đối soát",
      tone: "brand",
      when: "kỳ này",
      hardLock: false,
      dueAt: period ? new Date(period.ceoApprovalDeadline) : null,
    });
  }

  // 6. Đơn xin nghỉ chờ duyệt
  if (pendingLeaveRequests > 0) {
    queue.push({
      id: "leave",
      title: `${pendingLeaveRequests} đơn nghỉ phép đang chờ bạn duyệt`,
      detail: "Người xin nghỉ vẫn đang chờ bạn quyết định.",
      href: "/leave-requests",
      cta: "Duyệt",
      tone: "brand",
      when: "mới gửi",
      hardLock: false,
      dueAt: null,
    });
  }

  /**
   * Luật xếp: khoá cứng trước, rồi tới hạn gần trước.
   *
   * Không xếp thuần theo thời gian, vì việc trễ 4 ngày sẽ luôn đứng trên cửa
   * KPI đóng tối nay — mà việc trễ thì làm bù được, còn cửa đóng thì thôi.
   */
  queue.sort((a, b) => {
    if (a.hardLock !== b.hardLock) return a.hardLock ? -1 : 1;
    if (a.dueAt && b.dueAt) return a.dueAt.getTime() - b.dueAt.getTime();
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return 0;
  });

  /* ------------------------------------------------ cảnh báo Phase 4 */

  const alerts: DashboardAlert[] = [];

  for (const a of anomalies.slice(0, 2)) {
    const ratio =
      a.historicalMedian > 0
        ? (a.reportedValue / a.historicalMedian).toFixed(1).replace(".", ",")
        : null;
    alerts.push({
      id: `anomaly-${a.id}`,
      kind: "ANOMALY",
      title: `Bất thường KPI · ${a.employee.fullName}`,
      detail: ratio
        ? `${a.kpiDefinition.name} khai gấp ${ratio} lần nếp cũ.`
        : a.reason,
      footnote: `dựa trên ${a.sampleSize} kỳ · ${
        CONFIDENCE_LABEL[a.confidence] ?? a.confidence
      }`,
      href: anomalyHref,
      tone: a.severity === "CRITICAL" ? "red" : "amber",
    });
  }

  // Một việc có nhiều lượt dự báo — chỉ giữ lượt mới nhất của mỗi việc
  const seenTask = new Set<string>();
  const freshPredictions = predictions.filter((p) => {
    if (seenTask.has(p.taskId)) return false;
    seenTask.add(p.taskId);
    return true;
  });

  if (freshPredictions.length > 0) {
    const codes = freshPredictions
      .slice(0, 2)
      .map((p) => p.task.code)
      .join(" và ");
    const best = freshPredictions[0];
    alerts.push({
      id: "prediction",
      kind: "PREDICTION",
      title: `Dự báo vỡ kế hoạch · ${freshPredictions.length} việc`,
      detail: `${codes} nhiều khả năng không kịp hạn.`,
      footnote: `dựa trên ${best.sampleSize} việc đã đóng · ${
        CONFIDENCE_LABEL[best.confidence] ?? best.confidence
      }`,
      href: analyticsHref,
      tone: "amber",
    });
  }

  if (mismatchCount > 0) {
    alerts.push({
      id: "mismatch",
      kind: "MISMATCH",
      title: `Lệch số liệu · ${mismatchCount} ô`,
      detail: "Các nguồn báo số khác nhau, chưa ai quyết lấy số nào.",
      footnote: "chờ người có quyền quyết",
      href: "/reconciliation",
      tone: "brand",
    });
  }

  /* ------------------------------------------------ việc, đã rút gọn */

  const toLean = (
    t: {
      id: string;
      code: string;
      title: string;
      progress: number;
      dueDate: Date;
      assignee: { fullName: string } | null;
    },
    late: boolean,
  ): LeanTask => ({
    id: t.id,
    code: t.code,
    title: t.title,
    assignee: t.assignee?.fullName ?? "Chưa giao",
    progress: t.progress,
    dueDate: new Date(t.dueDate),
    ...(late ? { lateDays: lateDays(new Date(t.dueDate), now) } : {}),
  });

  /**
   * Cảnh báo về số của CHÍNH người đang xem và chưa giải trình.
   *
   * API đã cho nhân viên tự giải trình từ lâu (Phase 4 có kiểm thử hẳn hoi),
   * nhưng chưa có màn hình nào nhân viên vào được để làm — trang Phân tích chỉ
   * mở cho trưởng phòng và Ban Giám đốc. Ô này bịt chỗ đó.
   */
  const myOpenAnomalies = anomalies
    .filter((a) => a.employeeId === user.id && a.status === "OPEN")
    .map((a) => ({
      id: a.id,
      kpiName: a.kpiDefinition.name,
      reason: a.reason,
      reportedValue: a.reportedValue,
      historicalMedian: a.historicalMedian,
      sampleSize: a.sampleSize,
      severity: a.severity,
      confidence: a.confidence,
    }));

  return {
    gate,
    queue: queue.slice(0, 5),
    alerts: alerts.slice(0, 3),
    myOpenAnomalies,
    production,

    stats: {
      open: {
        value: openCount,
        delta: openCountWeekAgo > 0 ? openCount - openCountWeekAgo : null,
      } as TrendStat,
      overdue: {
        value: overdueCount,
        delta:
          overdueCountWeekAgo > 0 || overdueCount > 0
            ? overdueCount - overdueCountWeekAgo
            : null,
      } as TrendStat,
      kpiScore,
      trend: trend.map((t) => t.score),
    },

    overdueTasks: overdueTasks.map((t) => toLean(t, true)),
    todayTasks: todayTasks.map((t) => toLean(t, false)),
    overdueCount,

    myKpi: period
      ? {
          periodName: period.name,
          hasResults: myResults.length > 0,
          totalScore: mySummary.totalScore,
          classLabel: myClass.label,
          classTone: myClass.tone,
          draftCount: myDraft,
          selfReviewDeadline: new Date(period.selfReviewDeadline),
          weakest: myWeakest
            ? {
                name: myWeakest.kpiDefinition?.name ?? "—",
                achievement: myWeakest.achievementPercent,
              }
            : null,
        }
      : null,
  };
}

export type DashboardData = Awaited<ReturnType<typeof buildDashboard>>;
