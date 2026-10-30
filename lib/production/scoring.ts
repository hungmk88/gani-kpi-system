import {
  computeFinalScore,
  computeShiftMetrics,
  computeTier2,
  tierWeightsFor,
  type FinalScore,
  type ShiftFacts,
  type ShiftMetrics,
  type Tier2Breakdown,
} from "./kpi-engine";
import { runAntiGamingRules, type AuditFinding } from "./anti-gaming";

/**
 * KẾ HOẠCH CHẤM ĐIỂM MỘT CA ĐÃ KHOÁ — hàm thuần, không đụng database.
 *
 * Trước đây executeCalculationAndAudit vừa tính vừa ghi: upsert từng người xen
 * kẽ với gửi thông báo (Telegram có thể treo 15 giây), ngoài transaction. Lỗi
 * giữa chừng để lại ca chấm dở (người có điểm, người không), mở lại ca giữa
 * vòng lặp thì điểm mọc lại trên ca đã về QC_APPROVED. Giờ TÍNH hết ở đây trước,
 * rồi máy chủ ghi một lần trong một transaction, thông báo gửi sau khi commit.
 */

/** Trạng thái cảnh báo còn KHOÁ thưởng — cùng điều kiện với reviewAudit. */
export const BONUS_LOCKING_AUDIT_STATUSES = [
  "PENDING_EXPLANATION",
  "EXPLAINED",
  "REJECTED",
] as const;

export type ScoringShiftInput = {
  facts: ShiftFacts;
  totalLaborHours: number;
  participants: {
    userId: string;
    stage: string;
    hoursWorked: number;
    scheduledHours: number;
    personalDefectKg: number;
    violationCount: number;
    employmentType: string | null | undefined;
  }[];
  /**
   * Cảnh báo ĐÃ có người đụng tới (giải trình / BGĐ đã xử lý) — giữ lại khi
   * chấm lại. Cảnh báo PENDING_EXPLANATION cũ bị xoá và quét lại từ đầu.
   */
  handledAudits: { behaviorType: string; status: string }[];
};

export type ScoringPlan = {
  metrics: ShiftMetrics;
  tier2: Tier2Breakdown;
  findings: AuditFinding[];
  /** Cảnh báo cần TẠO MỚI (luật chưa có cảnh báo đã xử lý) */
  newFindings: AuditFinding[];
  bonusLocked: boolean;
  scores: { userId: string; score: FinalScore; finalBonusVnd: number }[];
};

export function planShiftScoring(input: ScoringShiftInput): ScoringPlan {
  const { facts } = input;
  const metrics = computeShiftMetrics(facts);
  const tier2 = computeTier2(metrics, facts);

  const totalHours =
    input.participants.reduce((s, p) => s + p.hoursWorked, 0) ||
    input.totalLaborHours;

  const findings = runAntiGamingRules(facts, metrics);
  // Khi khoá lại sau lần mở lại ca, KHÔNG tạo lại cảnh báo cùng luật đã có
  // người xử lý — nếu không, cảnh báo BGĐ đã chấp nhận sẽ mọc lại và khoá
  // thưởng thêm lần nữa cho cùng một vấn đề.
  const handledTypes = new Set(input.handledAudits.map((a) => a.behaviorType));
  const newFindings = findings.filter((f) => !handledTypes.has(f.behaviorType));

  // Khoá thưởng khi có cảnh báo mới (sẽ ở PENDING_EXPLANATION) HOẶC còn cảnh
  // báo cũ đang treo / đã bị BGĐ từ chối.
  const locking = new Set<string>(BONUS_LOCKING_AUDIT_STATUSES);
  const bonusLocked =
    newFindings.length > 0 || input.handledAudits.some((a) => locking.has(a.status));

  const scores = input.participants.map((p) => {
    const { weights, tier1Components } = tierWeightsFor(p.employmentType);
    const score = computeFinalScore(
      {
        userId: p.userId,
        stage: p.stage,
        hoursWorked: p.hoursWorked,
        scheduledHours: p.scheduledHours,
        personalDefectKg: p.personalDefectKg,
        violationCount: p.violationCount,
      },
      facts,
      totalHours,
      tier2,
      weights,
      tier1Components
    );
    return {
      userId: p.userId,
      score,
      finalBonusVnd: bonusLocked ? 0 : score.finalBonusVnd,
    };
  });

  return { metrics, tier2, findings, newFindings, bonusLocked, scores };
}

/**
 * Ca đã khoá có cần chấm (lại) không: có người làm ca mà chưa có dòng điểm.
 * Trước đây lượt tự chữa chỉ nhặt ca KHÔNG có dòng điểm nào — ca chấm dở
 * (lỗi giữa vòng lặp) nằm im mãi, người thiếu điểm không ai biết.
 */
export function hasMissingResults(
  participantUserIds: string[],
  resultUserIds: string[]
) {
  const scored = new Set(resultUserIds);
  return participantUserIds.some((id) => !scored.has(id));
}

/**
 * Chạy fn cho từng phần tử, tối đa `limit` việc cùng lúc. Không bao giờ ném —
 * trả kết quả kiểu Promise.allSettled theo đúng thứ tự đầu vào. Dùng để gửi
 * thông báo sau khi chấm điểm: một kênh chậm (Telegram treo 15 giây) không
 * được nhân lên theo số người, và một lỗi gửi không làm hỏng cả lượt.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  const n = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await fn(items[i], i) };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}
