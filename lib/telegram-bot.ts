import { prisma } from "./db";
import {
  appUrl,
  callTelegram,
  escapeHtml,
  sendMessage,
  telegramEnabled,
} from "./telegram-api";
import { writeAudit } from "./audit";
import { notify } from "./notify";
import { ceoApprove } from "./services/kpi-service";
import { classifyScore, summarizeResults } from "./kpi";
import { ROLE_LABEL, TASK_STATUS_LABEL, type Role } from "./constants";
import type { SessionUser } from "./auth";

/**
 * BOT TELEGRAM TƯƠNG TÁC.
 *
 * ---------------------------------------------------------------------------
 * CẢNH BÁO BẢO MẬT — điểm khác biệt lớn nhất so với bản thiết kế gốc.
 *
 * Thiết kế gốc xử lý callback bằng cách đọc `callbackQuery.from` rồi cập nhật
 * thẳng vào database, KHÔNG kiểm tra người bấm là ai. Làm như vậy thì bất cứ ai
 * gọi được vào địa chỉ webhook đều tự chế được một gói tin giả và duyệt KPI cho
 * cả công ty.
 *
 * Bản này chặn ba lớp:
 *   1. Endpoint webhook chỉ nhận tin có đúng header bí mật của Telegram
 *      (X-Telegram-Bot-Api-Secret-Token), khai lúc gọi setWebhook.
 *   2. `from.id` phải khớp một tài khoản đang hoạt động trong hệ thống. Người lạ
 *      nhắn bot thì bot chỉ chào, không làm gì.
 *   3. Mọi thao tác vẫn đi qua đúng hàm nghiệp vụ như trên web (ceoApprove...),
 *      nên vẫn bị chặn quyền và vẫn ghi nhật ký đầy đủ.
 * ---------------------------------------------------------------------------
 */

/* ------------------------------------------------------------ NHẬN DIỆN */

async function resolveActor(telegramUserId: number | string) {
  const chatId = String(telegramUserId);
  const user = await prisma.user.findFirst({
    where: { telegramChatId: chatId, isActive: true },
    include: { department: true },
  });
  if (!user) return null;
  const session: SessionUser = {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role as Role,
    departmentId: user.departmentId,
    departmentName: user.department?.name ?? null,
  };
  return session;
}

/* -------------------------------------------------- GỬI YÊU CẦU DUYỆT */

/**
 * Gửi yêu cầu duyệt KPI kèm nút bấm.
 * Chỉ gửi cho tài khoản Ban Giám đốc đã nối Telegram.
 */
export async function sendKpiApprovalRequest(kpiResultId: string) {
  if (!telegramEnabled()) {
    return { sent: 0, reason: "TELEGRAM_DISABLED" };
  }

  const row = await prisma.kpiResult.findUnique({
    where: { id: kpiResultId },
    include: {
      kpiDefinition: true,
      employee: { include: { department: true } },
      period: true,
    },
  });
  if (!row) return { sent: 0, reason: "NOT_FOUND" };
  if (!row.kpiDefinition) return { sent: 0, reason: "NO_KPI_DEFINITION" };
  if (row.status === "FINALIZED") return { sent: 0, reason: "ALREADY_LOCKED" };

  const ceos = await prisma.user.findMany({
    where: { role: "CEO", isActive: true, telegramChatId: { not: null } },
  });
  if (ceos.length === 0) return { sent: 0, reason: "NO_LINKED_CEO" };

  const lines = [
    "📊 <b>[CẦN DUYỆT KPI]</b>",
    "──────────────────────────",
    `👤 <b>Nhân viên:</b> ${escapeHtml(row.employee.fullName)}`,
    `🏢 <b>Phòng ban:</b> ${escapeHtml(row.employee.department?.name ?? "—")}`,
    `🎯 <b>Chỉ tiêu:</b> ${escapeHtml(row.kpiDefinition.name)}`,
    `📅 <b>Kỳ:</b> ${escapeHtml(row.period.name)}`,
    `📌 <b>Giao:</b> ${fmt(row.targetValue)} ${escapeHtml(row.kpiDefinition.unit)}`,
    `📈 <b>Số chốt:</b> ${fmt(row.actualFinal ?? row.actualSelf ?? row.actualSystem)} ${escapeHtml(row.kpiDefinition.unit)}`,
    `⭐ <b>Mức đạt:</b> <b>${row.achievementPercent}%</b> · điểm ${row.weightedScore}`,
  ];

  if (row.hasMismatch) {
    lines.push(
      "",
      `⚠️ <b>CẢNH BÁO LỆCH SỐ:</b> nhân viên khai lệch ${row.mismatchPercent}% so với số hệ thống.`
    );
  }
  if (row.isCapped) {
    lines.push("", "ℹ️ Dòng này đã chạm trần 150%.");
  }
  lines.push("", "<i>Chọn thao tác bên dưới:</i>");

  const keyboard = {
    inline_keyboard: [
      [
        { text: "✅ Duyệt & khoá", callback_data: `KPI_APPROVE:${row.id}` },
        { text: "💬 Yêu cầu giải trình", callback_data: `KPI_EXPLAIN:${row.id}` },
      ],
      [
        {
          text: "🔎 Mở trên hệ thống",
          url: appUrl(`/kpi/${row.periodId}`),
        },
      ],
    ],
  };

  let sent = 0;
  for (const ceo of ceos) {
    const res = await sendMessage(ceo.telegramChatId!, lines.join("\n"), keyboard);
    if (res.ok) sent++;
  }
  return { sent };
}

/* ------------------------------------------------------ XỬ LÝ CẬP NHẬT */

type TgUpdate = {
  message?: {
    chat?: { id: number };
    from?: { id: number; first_name?: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    from: { id: number; first_name?: string };
    message?: { chat: { id: number }; message_id: number; text?: string };
  };
};

export async function handleTelegramUpdate(update: TgUpdate, ip?: string | null) {
  if (update.callback_query) {
    return handleCallback(update.callback_query, ip);
  }
  if (update.message?.text) {
    return handleCommand(update.message, ip);
  }
  return { handled: false, reason: "Loại cập nhật không xử lý" };
}

/* ---------------------------------------------------------- NÚT BẤM */

async function handleCallback(
  cb: NonNullable<TgUpdate["callback_query"]>,
  ip?: string | null
) {
  const answer = async (text: string, alert = true) => {
    await callTelegram("answerCallbackQuery", {
      callback_query_id: cb.id,
      text: text.slice(0, 200),
      show_alert: alert,
    });
  };

  const actor = await resolveActor(cb.from.id);
  if (!actor) {
    await answer(
      "Tài khoản Telegram này chưa được nối với hệ thống. Gõ /start để biết cách nối."
    );
    return { handled: true, denied: true };
  }

  const [action, targetId] = (cb.data ?? "").split(":");
  if (!action || !targetId) {
    await answer("Nút bấm không hợp lệ.");
    return { handled: true, denied: true };
  }

  const meta = { ip: ip ?? null, userAgent: "telegram-bot" };

  /* --- Duyệt KPI --- */
  if (action === "KPI_APPROVE") {
    // Kiểm quyền y như trên web: chỉ Ban Giám đốc mới chốt được
    if (actor.role !== "CEO") {
      await answer(
        `Chỉ Ban Giám đốc mới duyệt được KPI. Bạn đang là ${ROLE_LABEL[actor.role]}.`
      );
      await writeAudit({
        actor,
        action: "TELEGRAM_APPROVE_DENIED",
        entityName: "kpi_results",
        entityId: targetId,
        reason: "Sai vai trò",
        ...meta,
      });
      return { handled: true, denied: true };
    }

    const row = await prisma.kpiResult.findUnique({
      where: { id: targetId },
      include: { employee: true, kpiDefinition: true },
    });
    if (!row) {
      await answer("Không tìm thấy dòng KPI này.");
      return { handled: true };
    }
    if (row.status === "FINALIZED") {
      await answer("Dòng KPI này đã được chốt trước đó rồi.");
      await editOriginal(cb, "Đã chốt trước đó");
      return { handled: true };
    }

    // Đi qua đúng hàm nghiệp vụ trên web: có ghi nhật ký, có báo nhân viên
    await ceoApprove(
      actor,
      [targetId],
      { ceoNote: "Duyệt qua Telegram" },
      meta
    );

    await answer(
      `✅ Đã duyệt và khoá KPI "${row.kpiDefinition?.name ?? "—"}" của ${row.employee.fullName}.`
    );
    await editOriginal(
      cb,
      `✅ ĐÃ DUYỆT & KHOÁ bởi ${actor.fullName} lúc ${new Date().toLocaleString("vi-VN")}`
    );
    return { handled: true, approved: true };
  }

  /* --- Yêu cầu giải trình --- */
  if (action === "KPI_EXPLAIN") {
    if (actor.role !== "CEO" && actor.role !== "MANAGER") {
      await answer("Bạn không có quyền yêu cầu giải trình.");
      return { handled: true, denied: true };
    }

    const row = await prisma.kpiResult.findUnique({
      where: { id: targetId },
      include: { employee: true, kpiDefinition: true },
    });
    if (!row) {
      await answer("Không tìm thấy dòng KPI này.");
      return { handled: true };
    }
    if (row.status === "FINALIZED") {
      await answer("Dòng KPI này đã chốt, không yêu cầu giải trình được nữa.");
      return { handled: true };
    }
    if (
      actor.role === "MANAGER" &&
      row.employee.departmentId !== actor.departmentId
    ) {
      await answer("Dòng KPI này không thuộc phòng ban của bạn.");
      return { handled: true, denied: true };
    }

    await prisma.kpiReview.create({
      data: {
        kpiResultId: targetId,
        reviewerId: actor.id,
        stage: actor.role === "CEO" ? "CEO" : "MANAGER",
        action: "REQUEST_EVIDENCE",
        reason: "Yêu cầu giải trình qua Telegram",
      },
    });
    await prisma.kpiResult.update({
      where: { id: targetId },
      data: {
        ceoNote:
          actor.role === "CEO"
            ? `Ban Giám đốc yêu cầu giải trình (${new Date().toLocaleString("vi-VN")})`
            : row.ceoNote,
      },
    });

    await writeAudit({
      actor,
      action: "KPI_REQUEST_EVIDENCE",
      entityName: "kpi_results",
      entityId: targetId,
      reason: "Yêu cầu giải trình qua Telegram",
      ...meta,
    });

    await notify({
      userId: row.employeeId,
      title: `Cần giải trình KPI: ${row.kpiDefinition?.name ?? "—"}`,
      body: `${actor.fullName} yêu cầu bạn bổ sung giải trình và bằng chứng cho chỉ tiêu này.`,
      level: "WARNING",
      linkUrl: `/kpi/${row.periodId}`,
    });

    await answer(`💬 Đã gửi yêu cầu giải trình tới ${row.employee.fullName}.`);
    await editOriginal(
      cb,
      `💬 ĐÃ YÊU CẦU GIẢI TRÌNH — ${actor.fullName}, ${new Date().toLocaleString("vi-VN")}`
    );
    return { handled: true };
  }

  /* --- Nhận việc / báo xong --- */
  if (action === "TASK_REVIEW") {
    const task = await prisma.task.findUnique({ where: { id: targetId } });
    if (!task) {
      await answer("Không tìm thấy công việc này.");
      return { handled: true };
    }
    if (task.assigneeId !== actor.id) {
      await answer("Đây không phải việc của bạn.");
      return { handled: true, denied: true };
    }
    await prisma.task.update({
      where: { id: targetId },
      data: { status: "REVIEW", progress: Math.max(task.progress, 90) },
    });
    await prisma.taskComment.create({
      data: {
        taskId: targetId,
        userId: actor.id,
        kind: "STATUS_CHANGE",
        body: `Chuyển trạng thái: ${task.status} → REVIEW (qua Telegram)`,
      },
    });
    await writeAudit({
      actor,
      action: "TASK_UPDATE",
      entityName: "tasks",
      entityId: targetId,
      before: { status: task.status },
      after: { status: "REVIEW" },
      reason: "Cập nhật qua Telegram",
      ...meta,
    });
    await answer("✅ Đã báo xong, chờ trưởng phòng nghiệm thu.");
    await editOriginal(cb, "✅ ĐÃ BÁO XONG, CHỜ NGHIỆM THU");
    return { handled: true };
  }

  await answer("Thao tác không được hỗ trợ.");
  return { handled: true };
}

/** Ghi kết quả vào chính tin nhắn cũ, để lần sau mở lại không bấm nhầm nữa. */
async function editOriginal(
  cb: NonNullable<TgUpdate["callback_query"]>,
  statusLine: string
) {
  if (!cb.message) return;
  const base = cb.message.text ?? "";
  await callTelegram("editMessageText", {
    chat_id: cb.message.chat.id,
    message_id: cb.message.message_id,
    text: `${escapeHtml(base)}\n\n<b>${escapeHtml(statusLine)}</b>`,
    parse_mode: "HTML",
  });
}

/* ---------------------------------------------------------- LỆNH CHAT */

async function handleCommand(
  msg: NonNullable<TgUpdate["message"]>,
  ip?: string | null
) {
  const chatId = String(msg.chat?.id ?? msg.from?.id ?? "");
  const text = (msg.text ?? "").trim();
  if (!chatId) return { handled: false };

  const [rawCmd, ...args] = text.split(/\s+/);
  const cmd = rawCmd.toLowerCase().replace(/@.*$/, "");

  /* --- /start: nối tài khoản --- */
  if (cmd === "/start") {
    const code = args[0];
    if (code) {
      const res = await linkAccount(code, chatId, ip);
      await sendMessage(chatId, res.message);
      return { handled: true, linked: res.ok };
    }
    const existing = await resolveActor(chatId);
    if (existing) {
      await sendMessage(
        chatId,
        [
          `👋 Chào ${escapeHtml(existing.fullName)}.`,
          `Tài khoản đã nối rồi — bạn đang là <b>${ROLE_LABEL[existing.role]}</b>.`,
          "",
          "Gõ /trogiup để xem các lệnh dùng được.",
        ].join("\n")
      );
    } else {
      await sendMessage(
        chatId,
        [
          "👋 <b>GANI FOODY — Quản lý Công việc &amp; KPI</b>",
          "",
          "Tài khoản Telegram này chưa nối với hệ thống.",
          "",
          "Cách nối:",
          `1. Đăng nhập <a href="${appUrl("/notifications")}">hệ thống</a>`,
          "2. Vào mục <b>Thông báo</b>, bấm <b>Nối Telegram</b>",
          "3. Chép mã 6 số rồi gõ vào đây: <code>/start 123456</code>",
        ].join("\n")
      );
    }
    return { handled: true };
  }

  const actor = await resolveActor(chatId);
  if (!actor) {
    await sendMessage(
      chatId,
      "Tài khoản này chưa được nối với hệ thống. Gõ /start để xem cách nối."
    );
    return { handled: true, denied: true };
  }

  /* --- /trogiup --- */
  if (cmd === "/trogiup" || cmd === "/help") {
    const lines = [
      `<b>Các lệnh dùng được</b> (bạn đang là ${ROLE_LABEL[actor.role]})`,
      "",
      "/homnay — việc của bạn tới hạn hôm nay và đã trễ",
      "/kpi — điểm KPI kỳ gần nhất của bạn",
    ];
    if (actor.role === "CEO" || actor.role === "MANAGER") {
      lines.push("/canhbao — các mắt xích đang báo động");
      lines.push("/duyet — số dòng KPI đang chờ bạn xử lý");
    }
    lines.push("/huy — ngắt nối tài khoản Telegram này");
    await sendMessage(chatId, lines.join("\n"));
    return { handled: true };
  }

  /* --- /homnay --- */
  if (cmd === "/homnay") {
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const tasks = await prisma.task.findMany({
      where: {
        assigneeId: actor.id,
        status: { notIn: ["DONE", "CANCELLED"] },
        dueDate: { lte: endOfToday },
      },
      orderBy: [{ riskScore: "desc" }, { dueDate: "asc" }],
      take: 10,
      include: { department: true },
    });

    if (tasks.length === 0) {
      await sendMessage(chatId, "🎉 Không có việc nào tới hạn hôm nay. Nhẹ người.");
      return { handled: true };
    }

    const lines = [`📋 <b>${tasks.length} việc cần xử lý</b>`, ""];
    for (const t of tasks) {
      const late = t.dueDate < new Date();
      lines.push(
        `${late ? "🔴" : "•"} <b>${escapeHtml(t.title)}</b>`,
        `   ${TASK_STATUS_LABEL[t.status]} · hạn ${t.dueDate.toLocaleDateString("vi-VN")}${late ? " (ĐÃ TRỄ)" : ""}`
      );
    }
    lines.push("", `<a href="${appUrl("/tasks")}">Mở danh sách đầy đủ</a>`);

    // Nút báo xong nhanh cho việc gấp nhất
    const top = tasks[0];
    await sendMessage(chatId, lines.join("\n"), {
      inline_keyboard: [
        [
          {
            text: `✅ Báo xong: ${top.title.slice(0, 25)}`,
            callback_data: `TASK_REVIEW:${top.id}`,
          },
        ],
      ],
    });
    return { handled: true };
  }

  /* --- /kpi --- */
  if (cmd === "/kpi") {
    const period = await prisma.kpiPeriod.findFirst({
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });
    if (!period) {
      await sendMessage(chatId, "Chưa có kỳ KPI nào được mở.");
      return { handled: true };
    }
    const rows = await prisma.kpiResult.findMany({
      where: { periodId: period.id, employeeId: actor.id },
      include: { kpiDefinition: true },
      orderBy: { weightPercent: "desc" },
    });
    if (rows.length === 0) {
      await sendMessage(
        chatId,
        `Bạn chưa được gán chỉ tiêu nào cho kỳ ${escapeHtml(period.name)}.`
      );
      return { handled: true };
    }

    const s = summarizeResults(rows);
    const cls = classifyScore(s.totalScore);
    const draft = rows.filter((r) => r.status === "DRAFT").length;

    const lines = [
      `📊 <b>KPI ${escapeHtml(period.name)}</b>`,
      `Tổng điểm: <b>${s.totalScore.toFixed(2)}</b> — ${cls.label}`,
      "",
    ];
    for (const r of rows) {
      lines.push(
        `• ${escapeHtml(r.kpiDefinition?.name ?? "—")}: ${r.achievementPercent}% (${r.weightPercent}% trọng số)`
      );
    }
    if (draft > 0) {
      lines.push(
        "",
        `⚠️ Còn <b>${draft}</b> chỉ tiêu bạn chưa tự khai. Hạn ${period.selfReviewDeadline.toLocaleDateString("vi-VN")}.`
      );
    }
    lines.push("", `<a href="${appUrl("/kpi")}">Mở bảng KPI</a>`);
    await sendMessage(chatId, lines.join("\n"));
    return { handled: true };
  }

  /* --- /canhbao --- */
  if (cmd === "/canhbao") {
    if (actor.role !== "CEO" && actor.role !== "MANAGER") {
      await sendMessage(chatId, "Lệnh này dành cho trưởng phòng và Ban Giám đốc.");
      return { handled: true, denied: true };
    }
    const deptFilter =
      actor.role === "MANAGER"
        ? { departmentId: actor.departmentId ?? "__none__" }
        : {};

    const [critical, overdue, mismatches] = await Promise.all([
      prisma.task.count({
        where: {
          ...deptFilter,
          status: { notIn: ["DONE", "CANCELLED"] },
          riskScore: { gte: 80 },
        },
      }),
      prisma.task.count({
        where: {
          ...deptFilter,
          status: { notIn: ["DONE", "CANCELLED"] },
          dueDate: { lt: new Date() },
        },
      }),
      prisma.reconciliation.count({ where: { status: "MISMATCH" } }),
    ]);

    const lines = [
      "🎯 <b>Tình hình hiện tại</b>",
      "",
      `🔴 Việc báo động đỏ: <b>${critical}</b>`,
      `⏰ Việc đã trễ hạn: <b>${overdue}</b>`,
      `⚠️ Ô KPI đang lệch số: <b>${mismatches}</b>`,
      "",
      critical + overdue + mismatches === 0
        ? "✅ Không có gì phải can thiệp."
        : `<a href="${appUrl("/ceo")}">Mở bảng điều hành</a>`,
    ];
    await sendMessage(chatId, lines.join("\n"));
    return { handled: true };
  }

  /* --- /duyet --- */
  if (cmd === "/duyet") {
    if (actor.role !== "CEO" && actor.role !== "MANAGER") {
      await sendMessage(chatId, "Lệnh này dành cho trưởng phòng và Ban Giám đốc.");
      return { handled: true, denied: true };
    }
    const period = await prisma.kpiPeriod.findFirst({
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });
    if (!period) {
      await sendMessage(chatId, "Chưa có kỳ KPI nào được mở.");
      return { handled: true };
    }
    const pending = await prisma.kpiResult.count({
      where:
        actor.role === "CEO"
          ? { periodId: period.id, status: "MANAGER_REVIEWED" }
          : {
              periodId: period.id,
              status: "SELF_REVIEWED",
              employee: { departmentId: actor.departmentId ?? "__none__" },
            },
    });
    await sendMessage(
      chatId,
      pending === 0
        ? `✅ Không còn dòng KPI nào chờ bạn ở kỳ ${escapeHtml(period.name)}.`
        : `📊 Có <b>${pending}</b> dòng KPI đang chờ bạn xử lý ở kỳ ${escapeHtml(period.name)}.\n\n<a href="${appUrl(`/kpi/${period.id}`)}">Mở bảng duyệt</a>`
    );
    return { handled: true };
  }

  /* --- /huy --- */
  if (cmd === "/huy") {
    await prisma.user.update({
      where: { id: actor.id },
      data: { telegramChatId: null },
    });
    await writeAudit({
      actor,
      action: "TELEGRAM_UNLINK",
      entityName: "users",
      entityId: actor.id,
      ip: ip ?? null,
      userAgent: "telegram-bot",
    });
    await sendMessage(
      chatId,
      "Đã ngắt nối. Từ giờ bạn không nhận thông báo qua Telegram nữa. Gõ /start để nối lại."
    );
    return { handled: true };
  }

  await sendMessage(
    chatId,
    "Không hiểu lệnh này. Gõ /trogiup để xem danh sách lệnh."
  );
  return { handled: true };
}

/* ------------------------------------------------------- NỐI TÀI KHOẢN */

async function linkAccount(code: string, chatId: string, ip?: string | null) {
  const link = await prisma.telegramLink.findUnique({
    where: { code },
    include: { user: { include: { department: true } } },
  });

  if (!link) {
    return { ok: false, message: "❌ Mã không đúng. Kiểm tra lại trong hệ thống." };
  }
  if (link.usedAt) {
    return {
      ok: false,
      message: "❌ Mã này đã dùng rồi. Vào hệ thống lấy mã mới.",
    };
  }
  if (link.expiresAt < new Date()) {
    return {
      ok: false,
      message: "❌ Mã đã hết hạn (mã chỉ sống 10 phút). Vào hệ thống lấy mã mới.",
    };
  }
  if (!link.user.isActive) {
    return { ok: false, message: "❌ Tài khoản này đã bị khoá." };
  }

  // Một chat Telegram chỉ nối được với một tài khoản
  await prisma.user.updateMany({
    where: { telegramChatId: chatId, id: { not: link.userId } },
    data: { telegramChatId: null },
  });

  await prisma.user.update({
    where: { id: link.userId },
    data: { telegramChatId: chatId },
  });
  await prisma.telegramLink.update({
    where: { id: link.id },
    data: { usedAt: new Date(), chatId },
  });

  await writeAudit({
    actor: {
      id: link.user.id,
      email: link.user.email,
      fullName: link.user.fullName,
      role: link.user.role as Role,
      departmentId: link.user.departmentId,
      departmentName: link.user.department?.name ?? null,
    },
    action: "TELEGRAM_LINK",
    entityName: "users",
    entityId: link.userId,
    after: { chatId },
    ip: ip ?? null,
    userAgent: "telegram-bot",
  });

  return {
    ok: true,
    message: [
      `✅ Đã nối xong, chào ${escapeHtml(link.user.fullName)}.`,
      `Bạn đang là <b>${ROLE_LABEL[link.user.role]}</b>${
        link.user.department ? ` · phòng ${escapeHtml(link.user.department.name)}` : ""
      }.`,
      "",
      "Từ giờ thông báo sẽ về đây. Gõ /trogiup để xem các lệnh.",
    ].join("\n"),
  };
}

/* ------------------------------------------------------------ TIỆN ÍCH */

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n);
}

/**
 * Khai báo địa chỉ webhook với Telegram.
 * Gọi một lần sau khi có địa chỉ công khai (ngrok, VPS, Vercel...).
 */
export async function registerWebhook(publicUrl: string) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    return {
      ok: false,
      error:
        "Chưa đặt TELEGRAM_WEBHOOK_SECRET trong .env — không nên mở webhook khi thiếu khoá này.",
    };
  }
  return callTelegram("setWebhook", {
    url: `${publicUrl.replace(/\/$/, "")}/api/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
}

export async function deleteWebhook() {
  return callTelegram("deleteWebhook", { drop_pending_updates: true });
}

export async function getWebhookInfo() {
  return callTelegram("getWebhookInfo", {});
}
