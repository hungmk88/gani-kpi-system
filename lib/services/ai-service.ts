import { prisma } from "../db";
import { BusinessError } from "../rbac";
import { ERR, type TaskPriority } from "../constants";
import { writeAudit } from "../audit";
import { parseTaskText, type ParsedTask } from "../ai/task-parser";
import { adviseKpi, type KpiAdvisory, type KpiContext } from "../ai/kpi-advisor";
import { createTask } from "./task-service";
import { vnDayRange } from "../vn-time";
import type { SessionUser } from "../auth";

type Meta = { ip?: string | null; userAgent?: string | null };

/**
 * TẦNG 3 CỦA GUARDRAIL — NGƯỜI QUYẾT ĐỊNH.
 *
 * Mọi thứ máy sinh ra đều dừng lại ở bảng ai_suggestions với trạng thái PENDING.
 * Không có hàm nào trong file này ghi thẳng vào tasks hay kpi_results.
 * Muốn thành dữ liệu thật thì phải có người bấm duyệt, và lúc đó vẫn phải đi qua
 * đúng các chốt chặn nghiệp vụ như khi làm tay.
 */

/* ---------------------------------------------------- HẠN MỨC GỌI AI */

/** Số lượt gọi AI tối đa mỗi người mỗi ngày (theo lịch VN). */
export const AI_DAILY_QUOTA: Record<string, number> = {
  EMPLOYEE: 50,
  MANAGER: 50,
  CEO: 200,
  ADMIN: 50,
};

/**
 * Chặn gọi AI quá hạn mức trong ngày. Mỗi lượt gọi AI đều để lại đúng một dòng
 * ai_suggestions (requestedById = người gọi) nên đếm thẳng trên bảng đó —
 * có index (requestedById, createdAt), không cần bảng đếm riêng.
 */
export async function assertAiQuota(actor: SessionUser) {
  const limit = AI_DAILY_QUOTA[actor.role] ?? 50;
  const used = await prisma.aiSuggestion.count({
    where: { requestedById: actor.id, createdAt: vnDayRange() },
  });
  if (used >= limit) {
    throw new BusinessError(
      "AI_QUOTA_EXCEEDED",
      `Bạn đã dùng hết ${limit} lượt trợ lý AI trong hôm nay. Vui lòng thử lại vào ngày mai.`,
      429
    );
  }
}

/** Chỉ người yêu cầu đề xuất (hoặc Ban Giám đốc) mới được quyết định nó. */
function assertSuggestionOwner(
  actor: SessionUser,
  s: { requestedById: string },
  verb: string
) {
  if (s.requestedById !== actor.id && actor.role !== "CEO") {
    throw new BusinessError(
      ERR.FORBIDDEN,
      `Chỉ người yêu cầu đề xuất (hoặc Ban Giám đốc) mới ${verb} được nó.`,
      403
    );
  }
}

/* ------------------------------------------------ ĐỌC CÂU LỆNH THÀNH VIỆC */

export async function suggestTaskFromText(
  actor: SessionUser,
  rawText: string,
  meta: Meta = {}
) {
  if (actor.role !== "MANAGER" && actor.role !== "CEO") {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Chỉ trưởng phòng và Ban Giám đốc mới dùng được trợ lý giao việc.",
      403
    );
  }
  await assertAiQuota(actor);

  // Chỉ đưa cho máy danh sách nhân sự mà người này thực sự được giao việc.
  // Máy không được biết, và do đó không thể gợi ý, người của phòng ban khác.
  const people = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { not: "ADMIN" },
      ...(actor.role === "CEO"
        ? {}
        : { departmentId: actor.departmentId ?? "__none__" }),
    },
    select: { id: true, fullName: true, jobTitle: true },
    orderBy: { fullName: "asc" },
  });

  const parsed = await parseTaskText(rawText, people);

  const suggestion = await prisma.aiSuggestion.create({
    data: {
      kind: "TASK_PARSE",
      engine: parsed.engine,
      modelName: parsed.modelName ?? "unknown",
      entityName: "tasks",
      entityId: null,
      inputText: rawText.slice(0, 2000),
      payload: JSON.stringify(parsed),
      confidencePercent: parsed.confidencePercent,
      rationale: parsed.rationale,
      missingInfo: parsed.missingInfo.length
        ? parsed.missingInfo.join(" · ")
        : null,
      status: "PENDING",
      latencyMs: parsed.latencyMs,
      requestedById: actor.id,
    },
  });

  await writeAudit({
    actor,
    action: "AI_TASK_PARSE",
    entityName: "ai_suggestions",
    entityId: suggestion.id,
    after: {
      engine: parsed.engine,
      confidence: parsed.confidencePercent,
      missing: parsed.missingInfo,
    },
    ...meta,
  });

  return { suggestion, parsed };
}

/**
 * Người dùng xem đề xuất, sửa lại nếu cần, rồi bấm duyệt.
 * `overrides` là những gì họ sửa tay — số cuối cùng luôn là số của con người.
 */
export async function acceptTaskSuggestion(
  actor: SessionUser,
  suggestionId: string,
  overrides: {
    title: string;
    description?: string | null;
    departmentId: string;
    assigneeId?: string | null;
    projectId?: string | null;
    dueDate: Date;
    priority: TaskPriority;
  },
  meta: Meta = {}
) {
  const s = await prisma.aiSuggestion.findUnique({
    where: { id: suggestionId },
  });
  if (!s) {
    throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy đề xuất.", 404);
  }
  if (s.kind !== "TASK_PARSE") {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      "Đề xuất này không phải loại tạo công việc.",
      400
    );
  }
  if (s.status !== "PENDING") {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      "Đề xuất này đã được xử lý rồi.",
      409
    );
  }
  assertSuggestionOwner(actor, s, "duyệt");

  const parsed: ParsedTask = JSON.parse(s.payload);

  // Giành quyền xử lý trước khi tạo việc — bấm duyệt 2 lần (hoặc 2 tab) không
  // đẻ ra 2 công việc.
  const claimed = await prisma.aiSuggestion.updateMany({
    where: { id: suggestionId, status: "PENDING" },
    data: { status: "ACCEPTED", decidedById: actor.id, decidedAt: new Date() },
  });
  if (claimed.count === 0) {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      "Đề xuất này đã được xử lý rồi.",
      409
    );
  }

  // Đi qua đúng cửa tạo việc bình thường, kể cả chốt chặn giao việc vượt cấp
  let task: Awaited<ReturnType<typeof createTask>>;
  try {
    task = await createTask(
      actor,
      {
        ...overrides,
        isAiGenerated: true,
        aiConfidence: s.confidencePercent,
      },
      meta
    );
  } catch (e) {
    // Tạo việc bị chặn (sai quyền, người nhận bị khoá...) — trả đề xuất về
    // trạng thái chờ để người dùng sửa lại rồi duyệt tiếp.
    await prisma.aiSuggestion.update({
      where: { id: suggestionId },
      data: { status: "PENDING", decidedById: null, decidedAt: null },
    });
    throw e;
  }

  await prisma.aiSuggestion.update({
    where: { id: suggestionId },
    data: { resultEntityId: task.id, entityId: task.id },
  });

  // Ghi lại phần con người đã sửa khác máy — đây là dữ liệu để sau này biết
  // máy đọc sai ở đâu mà chỉnh prompt, chứ không phải để đổ lỗi cho ai.
  const edits: Record<string, { may: unknown; nguoi: unknown }> = {};
  if (parsed.title !== overrides.title) {
    edits.title = { may: parsed.title, nguoi: overrides.title };
  }
  if ((parsed.assigneeId ?? null) !== (overrides.assigneeId ?? null)) {
    edits.assigneeId = {
      may: parsed.assigneeId,
      nguoi: overrides.assigneeId ?? null,
    };
  }
  if (parsed.priority !== overrides.priority) {
    edits.priority = { may: parsed.priority, nguoi: overrides.priority };
  }
  const parsedDue = parsed.dueDate ? new Date(parsed.dueDate).getTime() : null;
  if (parsedDue !== overrides.dueDate.getTime()) {
    edits.dueDate = {
      may: parsed.dueDate,
      nguoi: overrides.dueDate.toISOString(),
    };
  }

  await writeAudit({
    actor,
    action: "AI_SUGGESTION_ACCEPT",
    entityName: "ai_suggestions",
    entityId: suggestionId,
    before: { engine: s.engine, confidence: s.confidencePercent },
    after: {
      taskId: task.id,
      taskCode: task.code,
      nguoiDungSuaLai: Object.keys(edits).length ? edits : "không sửa gì",
    },
    ...meta,
  });

  return task;
}

export async function rejectSuggestion(
  actor: SessionUser,
  suggestionId: string,
  reason: string | null,
  meta: Meta = {}
) {
  const s = await prisma.aiSuggestion.findUnique({
    where: { id: suggestionId },
  });
  if (!s) {
    throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy đề xuất.", 404);
  }
  if (s.status !== "PENDING") {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      "Đề xuất này đã được xử lý rồi.",
      409
    );
  }
  assertSuggestionOwner(actor, s, "từ chối");

  const claimed = await prisma.aiSuggestion.updateMany({
    where: { id: suggestionId, status: "PENDING" },
    data: {
      status: "REJECTED",
      decidedById: actor.id,
      decidedAt: new Date(),
    },
  });
  if (claimed.count === 0) {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      "Đề xuất này đã được xử lý rồi.",
      409
    );
  }

  await writeAudit({
    actor,
    action: "AI_SUGGESTION_REJECT",
    entityName: "ai_suggestions",
    entityId: suggestionId,
    reason,
    ...meta,
  });

  return { rejected: true };
}

/* --------------------------------------------------------- CỐ VẤN KPI */

export async function suggestKpiAdvisory(
  actor: SessionUser,
  kpiResultId: string,
  meta: Meta = {}
): Promise<{ advisory: KpiAdvisory; suggestionId: string }> {
  if (actor.role !== "MANAGER" && actor.role !== "CEO") {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Chỉ trưởng phòng và Ban Giám đốc mới xem được phần cố vấn KPI.",
      403
    );
  }

  const row = await prisma.kpiResult.findUnique({
    where: { id: kpiResultId },
    include: {
      kpiDefinition: true,
      employee: {
        select: {
          fullName: true,
          jobTitle: true,
          departmentId: true,
          department: { select: { name: true } },
        },
      },
      period: true,
    },
  });
  if (!row) {
    throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy dòng KPI.", 404);
  }
  if (!row.kpiDefinition) {
    throw new BusinessError(
      ERR.VALIDATION_FAILED,
      "Dòng KPI này chưa gán chỉ tiêu, không có gì để cố vấn.",
      400
    );
  }
  if (
    actor.role === "MANAGER" &&
    row.employee.departmentId !== actor.departmentId
  ) {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Dòng KPI này không thuộc phòng ban của bạn.",
      403
    );
  }
  await assertAiQuota(actor);

  // Lịch sử cùng nhân sự, cùng chỉ tiêu, các kỳ trước
  const past = await prisma.kpiResult.findMany({
    where: {
      employeeId: row.employeeId,
      kpiDefinitionId: row.kpiDefinitionId,
      periodId: { not: row.periodId },
    },
    include: { period: true },
    orderBy: [{ period: { year: "desc" } }, { period: { month: "desc" } }],
    take: 6,
  });

  const ctx: KpiContext = {
    kpiCode: row.kpiDefinition.code,
    kpiName: row.kpiDefinition.name,
    unit: row.kpiDefinition.unit,
    isHigherBetter: row.kpiDefinition.isHigherBetter,
    dataSource: row.kpiDefinition.dataSource,
    employeeName: row.employee.fullName,
    jobTitle: row.employee.jobTitle,
    departmentName: row.employee.department?.name ?? null,
    weightPercent: row.weightPercent ?? 0,
    targetValue: row.targetValue ?? 0,
    actualSystem: row.actualSystem,
    actualSelf: row.actualSelf,
    actualFinal: row.actualFinal,
    achievementPercent: row.achievementPercent,
    hasMismatch: row.hasMismatch,
    mismatchPercent: row.mismatchPercent,
    evidenceUrl: row.evidenceUrl,
    selfNote: row.selfNote,
    history: past.map((p) => ({
      periodName: p.period.name,
      achievementPercent: p.achievementPercent,
    })),
  };

  const advisory = await adviseKpi(ctx);

  const suggestion = await prisma.aiSuggestion.create({
    data: {
      kind: "KPI_ADVISORY",
      engine: advisory.engine,
      modelName: advisory.modelName ?? "unknown",
      entityName: "kpi_results",
      entityId: kpiResultId,
      inputText: `${row.employee.fullName} · ${row.kpiDefinition.code} · ${row.period.name}`,
      payload: JSON.stringify(advisory),
      confidencePercent: advisory.confidencePercent,
      rationale: advisory.recommendation,
      missingInfo: advisory.risks.length ? advisory.risks.join(" · ") : null,
      status: "PENDING",
      latencyMs: advisory.latencyMs,
      requestedById: actor.id,
    },
  });

  await writeAudit({
    actor,
    action: "AI_KPI_ADVISORY",
    entityName: "ai_suggestions",
    entityId: suggestion.id,
    after: {
      kpiResultId,
      engine: advisory.engine,
      suggestedScore: advisory.suggestedScore,
      confidence: advisory.confidencePercent,
    },
    ...meta,
  });

  return { advisory, suggestionId: suggestion.id };
}
