/**
 * LỊCH SỬ CHO PHẦN PHÂN TÍCH & DỰ BÁO (Phase 4).
 *
 * Ba tính năng của Phase 4 đều là đọc quá khứ để đoán tương lai. Không có quá
 * khứ thì mở lên chỉ thấy "chưa đủ dữ liệu" — đúng về mặt trung thực nhưng
 * không xem được gì. Nên dữ liệu mẫu dựng sẵn 6 kỳ KPI đã chốt và một loạt việc
 * đã đóng, để mở lên là thấy các engine chạy thật.
 *
 * Số sinh theo hàm giả ngẫu nhiên CÓ HẠT CỐ ĐỊNH — chạy lại seed bao nhiêu lần
 * cũng ra đúng bộ số đó, nên bộ kiểm thử mới lặp lại được kết quả.
 */

const HISTORY_MONTHS = 6;

/** Sinh số giả ngẫu nhiên nhưng lặp lại được — cùng hạt thì cùng dãy số. */
function makeRng(seed) {
  let x = seed >>> 0;
  return function () {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

/** Bản rút gọn của công thức KPI, dùng khi dựng lịch sử. */
function kpiScore(target, actual, weight, higher) {
  const CAP = 150;
  let raw;
  if (higher) {
    if (target === 0) return { achievement: 0, score: 0, capped: false };
    raw = (actual / target) * 100;
  } else {
    if (actual === 0) raw = target === 0 ? 100 : CAP;
    else if (target === 0) return { achievement: 0, score: 0, capped: false };
    else raw = (target / actual) * 100;
  }
  if (raw < 0) raw = 0;
  const capped = raw >= CAP;
  const achievement = capped ? CAP : round2(raw);
  return { achievement, score: round2((achievement * weight) / 100), capped };
}

const VERBS = [
  "Đối soát công nợ nhóm khách",
  "Kiểm kê tồn kho cuối tuần",
  "Chuẩn bị mẫu gửi khách",
  "Gọi lại nhóm khách chưa chốt",
  "Rà soát chứng từ giao hàng",
  "Vệ sinh và bảo dưỡng máy",
  "Lên lịch giao hàng tuần",
  "Tổng hợp báo cáo tuần",
  "Cập nhật hồ sơ nhà cung cấp",
];

/** Tỷ lệ đúng hạn khác nhau để bộ dự báo phân biệt được nhịp từng người. */
const WORKERS = [
  { email: "nv.sales1@ganifoody.vn", dept: "SALES", onTimeRate: 0.8 },
  { email: "nv.sales2@ganifoody.vn", dept: "SALES", onTimeRate: 0.35 },
  { email: "nv.mkt1@ganifoody.vn", dept: "MKT", onTimeRate: 0.7 },
  { email: "nv.prod1@ganifoody.vn", dept: "PROD", onTimeRate: 0.85 },
  { email: "nv.wh1@ganifoody.vn", dept: "WH", onTimeRate: 0.6 },
  { email: "nv.ops1@ganifoody.vn", dept: "OPS", onTimeRate: 0.5 },
];

export async function seedHistory(ctx) {
  const { prisma, deptMap, userMap, kpiMap, users, kpiDefs, targets, month, year } =
    ctx;

  const existing = await prisma.kpiPeriod.count();
  if (existing > 1) {
    console.log("  · Đã có nhiều kỳ KPI, bỏ qua phần dựng lịch sử");
    return;
  }

  const rng = makeRng(20260908);

  /* ---------------- 6 kỳ KPI đã chốt ---------------- */

  const bizUsers = users.filter((u) => u.role !== "ADMIN" && u.dept !== "BOD");
  let periodCount = 0;
  let rowCount = 0;

  for (let back = HISTORY_MONTHS; back >= 1; back--) {
    let m = month - back;
    let y = year;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }

    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    const at = (d) => new Date(ny, nm - 1, d, 23, 59, 59);

    const period = await prisma.kpiPeriod.upsert({
      where: { month_year: { month: m, year: y } },
      update: {},
      create: {
        month: m,
        year: y,
        name: "Tháng " + String(m).padStart(2, "0") + "/" + y,
        selfReviewDeadline: at(2),
        managerReviewDeadline: at(4),
        ceoApprovalDeadline: at(5),
        status: "FINALIZED",
        isLocked: true,
        finalizedAt: at(5),
      },
    });
    periodCount++;

    for (const u of bizUsers) {
      const defs = kpiDefs.filter((k) => k.dept === u.dept);
      for (const k of defs) {
        const t = targets[k.code];
        if (!t) continue;

        const factor = u.role === "MANAGER" ? 1 : 0.9;
        const target = round2(t.target * factor);

        // Dao động quanh chỉ tiêu 85–110%: đủ tạo độ lệch thật mà không loạn
        const ratio = 0.85 + rng() * 0.25;
        const actual = round2(k.higher ? target * ratio : target * (2 - ratio));
        const calc = kpiScore(target, actual, k.weight, k.higher);

        await prisma.kpiResult.upsert({
          where: {
            periodId_employeeId_kpiDefinitionId: {
              periodId: period.id,
              employeeId: userMap[u.email].id,
              kpiDefinitionId: kpiMap[k.code].id,
            },
          },
          update: {},
          create: {
            periodId: period.id,
            employeeId: userMap[u.email].id,
            kpiDefinitionId: kpiMap[k.code].id,
            weightPercent: k.weight,
            targetValue: target,
            actualSelf: actual,
            actualFinal: actual,
            achievementPercent: calc.achievement,
            weightedScore: calc.score,
            isCapped: calc.capped,
            status: "FINALIZED",
            selfSubmittedAt: at(2),
            managerReviewedAt: at(4),
            ceoReviewedAt: at(5),
            finalizedAt: at(5),
          },
        });
        rowCount++;
      }
    }
  }

  console.log(
    "  ✓ " +
      periodCount +
      " kỳ KPI lịch sử đã chốt (" +
      rowCount +
      " dòng) — nền cho bộ phát hiện bất thường"
  );

  /* ---------------- Một khai báo bất thường ở kỳ hiện tại ---------------- */

  const curPeriod = await prisma.kpiPeriod.findUnique({
    where: { month_year: { month, year } },
  });
  const huy = userMap["nv.sales2@ganifoody.vn"];
  const revDef = kpiMap["SALES_REV"];

  if (curPeriod && huy && revDef) {
    const row = await prisma.kpiResult.findUnique({
      where: {
        periodId_employeeId_kpiDefinitionId: {
          periodId: curPeriod.id,
          employeeId: huy.id,
          kpiDefinitionId: revDef.id,
        },
      },
    });
    if (row) {
      // Khai gấp hơn 3 lần nếp cũ — thứ mà thước thống kê phải bắt được
      await prisma.kpiResult.update({
        where: { id: row.id },
        data: {
          actualSelf: round2(row.targetValue * 3.2),
          status: "SELF_REVIEWED",
          selfSubmittedAt: new Date(),
          selfNote: "Tháng này chốt được đơn lớn.",
        },
      });
      console.log(
        "  ✓ 1 khai báo KPI đột biến (gấp 3,2 lần chỉ tiêu) để xem bộ phát hiện bất thường"
      );
    }
  }

  /* ---------------- Việc đã đóng: nền cho nhịp làm việc ---------------- */

  const workers = WORKERS.filter((w) => userMap[w.email]);
  const yearNow = new Date().getFullYear();
  let seq = 900;
  let closed = 0;

  for (const w of workers) {
    for (let i = 0; i < 9; i++) {
      const daysAgo = 12 + i * 9;
      const start = new Date();
      start.setDate(start.getDate() - daysAgo);
      start.setHours(8, 0, 0, 0);

      const planDays = 3 + Math.floor(rng() * 4);
      const due = new Date(start);
      due.setDate(due.getDate() + planDays);
      due.setHours(17, 0, 0, 0);

      // Đúng hạn hay trễ, theo tỷ lệ riêng của từng người
      const onTime = rng() < w.onTimeRate;
      const done = new Date(due);
      done.setDate(
        done.getDate() +
          (onTime ? -Math.floor(rng() * 2) : 1 + Math.floor(rng() * 4))
      );

      await prisma.task.create({
        data: {
          code: "TASK-" + yearNow + "-" + String(seq++).padStart(4, "0"),
          title: VERBS[i % VERBS.length] + " (đợt " + (i + 1) + ")",
          departmentId: deptMap[w.dept],
          assigneeId: userMap[w.email].id,
          creatorId: userMap[w.email].id,
          startDate: start,
          dueDate: due,
          completedAt: done,
          priority: i % 4 === 0 ? "HIGH" : "MEDIUM",
          status: "DONE",
          progress: 100,
          estimatedHours: 4 + Math.floor(rng() * 12),
        },
      });
      closed++;
    }
  }

  console.log(
    "  ✓ " +
      closed +
      " việc đã đóng của " +
      workers.length +
      " người — nền cho dự báo nhịp làm việc"
  );

  /* ---------------- Tải lệch: một người quá tải ---------------- */

  const overloaded = userMap["nv.sales1@ganifoody.vn"];
  const boss = userMap["tp.sales@ganifoody.vn"];
  if (overloaded && boss) {
    for (let i = 0; i < 7; i++) {
      const due = new Date();
      due.setDate(due.getDate() + 4 + i * 2);
      due.setHours(17, 0, 0, 0);
      await prisma.task.create({
        data: {
          code: "TASK-" + yearNow + "-" + String(seq++).padStart(4, "0"),
          title: "Chăm sóc nhóm khách sỉ khu vực " + (i + 1),
          departmentId: deptMap.SALES,
          assigneeId: overloaded.id,
          creatorId: boss.id,
          startDate: new Date(),
          dueDate: due,
          priority: i % 3 === 0 ? "HIGH" : "MEDIUM",
          status: i < 4 ? "IN_PROGRESS" : "TO_DO",
          progress: i < 4 ? 20 + i * 10 : 0,
          estimatedHours: 24,
        },
      });
    }
    console.log(
      "  ✓ 7 việc dồn cho một nhân viên Kinh doanh — để xem bộ cân bằng tải"
    );
  }

  /* ---------------- Điền giờ ước tính cho việc còn thiếu ---------------- */

  const noEstimate = await prisma.task.findMany({
    where: { estimatedHours: null },
    select: { id: true, priority: true },
  });
  for (const t of noEstimate) {
    const hours = { LOW: 4, MEDIUM: 12, HIGH: 20, CRITICAL: 28 }[t.priority] ?? 12;
    await prisma.task.update({
      where: { id: t.id },
      data: { estimatedHours: hours },
    });
  }
  if (noEstimate.length > 0) {
    console.log(
      "  ✓ Điền giờ ước tính cho " + noEstimate.length + " việc mẫu còn thiếu"
    );
  }
}
