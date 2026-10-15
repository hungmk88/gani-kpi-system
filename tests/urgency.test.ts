import { describe, expect, it } from "vitest";
import {
  calendarRank,
  daysLate,
  lateBucketOf,
  lateBucketRanges,
  sortForCalendar,
  urgencyTone,
} from "@/lib/urgency";

describe("urgencyTone — màu theo thời gian còn lại", () => {
  const now = new Date("2026-10-15T09:00:00Z");
  const inHours = (h: number) => new Date(now.getTime() + h * 3_600_000);

  it("còn 18 ngày → trung tính, không đỏ", () => {
    expect(urgencyTone(inHours(18 * 24), now)).toBe("brand");
  });
  it("còn 2 ngày → vàng", () => {
    expect(urgencyTone(inHours(48), now)).toBe("amber");
  });
  it("còn dưới 24 giờ → đỏ", () => {
    expect(urgencyTone(inHours(5), now)).toBe("red");
  });
  it("đã quá hạn → đỏ", () => {
    expect(urgencyTone(inHours(-3), now)).toBe("red");
  });
});

describe("daysLate / lateBucketOf — nhóm việc quá hạn theo ngày lịch VN", () => {
  // 15/10/2026 16:00 giờ VN
  const now = new Date("2026-10-15T09:00:00Z");

  it("đếm theo ngày lịch VN, không theo khối 24 giờ", () => {
    // 14/10 23:00 giờ VN — mới trễ 10 tiếng nhưng đã sang ngày khác
    expect(daysLate(new Date("2026-10-14T16:00:00Z"), now)).toBe(1);
    // Sáng nay 08:00 giờ VN — trễ trong hôm nay
    expect(daysLate(new Date("2026-10-15T01:00:00Z"), now)).toBe(0);
    // Chưa tới hạn → âm
    expect(daysLate(new Date("2026-10-17T01:00:00Z"), now)).toBe(-2);
  });

  it("chia nhóm: hôm nay / 1–2 / 3–7 / trên 7 ngày", () => {
    expect(lateBucketOf(0).key).toBe("today");
    expect(lateBucketOf(1).key).toBe("recent");
    expect(lateBucketOf(2).key).toBe("recent");
    expect(lateBucketOf(3).key).toBe("several");
    expect(lateBucketOf(7).key).toBe("several");
    expect(lateBucketOf(8).key).toBe("week");
  });

  it("khoảng truy vấn của từng nhóm khớp với lateBucketOf", () => {
    const ranges = lateBucketRanges(now);
    // Lấy mẫu mỗi giờ trong 12 ngày qua: mỗi mốc phải rơi đúng một khoảng,
    // và khoảng đó phải là nhóm mà lateBucketOf chọn.
    for (let h = 1; h < 12 * 24; h++) {
      const due = new Date(now.getTime() - h * 3_600_000);
      const hit = ranges.filter(
        (r) => (!r.gte || due >= r.gte) && due < r.lt
      );
      expect(hit).toHaveLength(1);
      expect(hit[0].key).toBe(lateBucketOf(daysLate(due, now)).key);
    }
  });
});

describe("calendarRank / sortForCalendar — thứ tự trong ô lịch", () => {
  const now = new Date("2026-10-15T09:00:00Z");
  const past = new Date("2026-10-15T02:00:00Z");
  const later = new Date("2026-10-15T15:00:00Z");
  const t = (id: string, status: string, priority: string, dueDate: Date) => ({
    id,
    status,
    priority,
    dueDate,
  });

  it("trễ → gấp → đang mở → xong", () => {
    expect(calendarRank(t("a", "IN_PROGRESS", "LOW", past), now)).toBe(0);
    expect(calendarRank(t("b", "TO_DO", "CRITICAL", later), now)).toBe(1);
    expect(calendarRank(t("c", "TO_DO", "HIGH", later), now)).toBe(1);
    expect(calendarRank(t("d", "TO_DO", "MEDIUM", later), now)).toBe(2);
    expect(calendarRank(t("e", "DONE", "CRITICAL", past), now)).toBe(3);
  });

  it("việc xong không bao giờ chen lên trên việc trễ", () => {
    const sorted = sortForCalendar(
      [
        t("done", "DONE", "CRITICAL", past),
        t("open", "TO_DO", "MEDIUM", later),
        t("high", "TO_DO", "HIGH", later),
        t("crit", "TO_DO", "CRITICAL", later),
        t("late", "BLOCKED", "LOW", past),
      ],
      now
    );
    expect(sorted.map((x) => x.id)).toEqual(["late", "crit", "high", "open", "done"]);
  });
});
