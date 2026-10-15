import { formatVnDateTime } from "@/lib/vn-time";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { kpiScopeWhere } from "@/lib/rbac";
import { classifyScore, round2, summarizeResults } from "@/lib/kpi";
import { KPI_SCORE_CAP } from "@/lib/constants";
import PrintButton from "./print-button";

export const dynamic = "force-dynamic";

/**
 * BÁO CÁO ĐIỀU HÀNH — bản in.
 *
 * Trang này nằm ngoài khung ứng dụng (không có thanh bên) và có CSS riêng cho
 * lúc in. Bấm nút In là ra hộp thoại của trình duyệt, chọn "Save as PDF" là có
 * file PDF tiếng Việt sắc nét, không cần cài thêm thư viện nào.
 */
export default async function KpiReportPage({
  params,
}: {
  params: Promise<{ periodId: string }>;
}) {
  const { periodId } = await params;
  const user = await requireSession();
  if (!user) redirect("/login");
  if (user.role !== "CEO" && user.role !== "MANAGER" && user.role !== "ADMIN") {
    redirect("/dashboard");
  }

  const period = await prisma.kpiPeriod.findUnique({ where: { id: periodId } });
  if (!period) notFound();

  const results = await prisma.kpiResult.findMany({
    where: { periodId, ...kpiScopeWhere(user) },
    include: {
      kpiDefinition: true,
      employee: { include: { department: true } },
    },
    orderBy: [
      { employee: { department: { name: "asc" } } },
      { employee: { fullName: "asc" } },
      { weightPercent: "desc" },
    ],
  });

  const company = await prisma.systemSetting.findUnique({
    where: { key: "COMPANY_NAME" },
  });

  /* ---------------- gom theo phòng ban và nhân sự ---------------- */

  type EmpRow = {
    id: string;
    name: string;
    jobTitle: string;
    rows: typeof results;
    totalScore: number;
    totalWeight: number;
  };

  const deptMap = new Map<string, { name: string; employees: Map<string, EmpRow> }>();

  for (const r of results) {
    const dName = r.employee.department?.name ?? "Chưa xếp phòng ban";
    if (!deptMap.has(dName)) {
      deptMap.set(dName, { name: dName, employees: new Map() });
    }
    const dept = deptMap.get(dName)!;
    if (!dept.employees.has(r.employeeId)) {
      dept.employees.set(r.employeeId, {
        id: r.employeeId,
        name: r.employee.fullName,
        jobTitle: r.employee.jobTitle ?? "",
        rows: [],
        totalScore: 0,
        totalWeight: 0,
      });
    }
    dept.employees.get(r.employeeId)!.rows.push(r);
  }

  const departments = [...deptMap.values()]
    .map((d) => {
      const employees = [...d.employees.values()].map((e) => {
        const s = summarizeResults(e.rows);
        return { ...e, totalScore: s.totalScore, totalWeight: s.totalWeight };
      });
      employees.sort((a, b) => b.totalScore - a.totalScore);
      const avg = employees.length
        ? round2(
            employees.reduce((s, e) => s + e.totalScore, 0) / employees.length
          )
        : 0;
      return { name: d.name, employees, avgScore: avg };
    })
    .sort((a, b) => b.avgScore - a.avgScore);

  const allEmployees = departments.flatMap((d) =>
    d.employees.map((e) => ({ ...e, department: d.name }))
  );
  const companyAvg = allEmployees.length
    ? round2(
        allEmployees.reduce((s, e) => s + e.totalScore, 0) / allEmployees.length
      )
    : 0;

  const mismatches = results.filter((r) => r.hasMismatch);
  const capped = results.filter((r) => r.isCapped);
  const notFinalized = results.filter((r) => r.status !== "FINALIZED");

  const buckets = [
    { label: "Xuất sắc (≥120)", n: allEmployees.filter((e) => e.totalScore >= 120).length },
    { label: "Tốt (100–119)", n: allEmployees.filter((e) => e.totalScore >= 100 && e.totalScore < 120).length },
    { label: "Đạt (85–99)", n: allEmployees.filter((e) => e.totalScore >= 85 && e.totalScore < 100).length },
    { label: "Cần cải thiện (70–84)", n: allEmployees.filter((e) => e.totalScore >= 70 && e.totalScore < 85).length },
    { label: "Không đạt (<70)", n: allEmployees.filter((e) => e.totalScore < 70).length },
  ];
  const maxBucket = Math.max(1, ...buckets.map((b) => b.n));

  // Kỳ chưa chốt: điểm chỉ là tạm tính, KHÔNG xếp loại — in ra "Không đạt"
  // cho cả công ty khi nhân viên còn chưa tới hạn tự khai là báo động giả.
  const isFinal = period.status === "FINALIZED";
  const rankLabel = (score: number) =>
    isFinal ? classifyScore(score).label : "Tạm tính";

  return (
    <div className="report mx-auto max-w-[900px] bg-white p-8 text-ink-900 print:max-w-none print:p-0">
      <PrintButton />

      {!isFinal && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center"
        >
          <span className="-rotate-30 text-[110px] font-black tracking-widest text-ink-900/[0.06] select-none">
            BẢN TẠM TÍNH
          </span>
        </div>
      )}

      {/* ---------------- trang bìa ---------------- */}
      <header className="mb-8 border-b-4 border-brand-600 pb-5">
        <div className="text-xs font-semibold tracking-widest text-brand-700 uppercase">
          {company?.value ?? "GANI FOODY"} · Báo cáo điều hành
        </div>
        <h1 className="mt-2 text-3xl font-bold">
          Báo cáo KPI {period.name}
        </h1>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-600">
          <span>
            Trạng thái kỳ:{" "}
            <b>
              {period.status === "FINALIZED"
                ? "Đã chốt và khoá"
                : "Chưa chốt xong"}
            </b>
          </span>
          <span>
            Xuất lúc: {formatVnDateTime(new Date())}
          </span>
          <span>Người xuất: {user.fullName}</span>
        </div>
        {period.status !== "FINALIZED" && (
          <div className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Kỳ này chưa chốt xong — còn {notFinalized.length} dòng KPI chưa
            khoá. Số liệu trong báo cáo có thể còn thay đổi.
          </div>
        )}
      </header>

      {/* ---------------- tổng quan ---------------- */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-bold">1. Tổng quan</h2>

        <div className="mb-5 grid grid-cols-4 gap-3">
          <Stat label="Nhân sự được chấm" value={String(allEmployees.length)} />
          <Stat label="Điểm trung bình" value={companyAvg.toFixed(2)} />
          <Stat
            label="Dòng lệch số liệu"
            value={String(mismatches.length)}
            warn={mismatches.length > 0}
          />
          <Stat
            label={`Chạm trần ${KPI_SCORE_CAP}%`}
            value={String(capped.length)}
          />
        </div>

        <h3 className="mb-2 text-sm font-semibold text-ink-700">
          Phân bố xếp loại
        </h3>
        {!isFinal ? (
          <p className="text-sm text-ink-600">
            Chưa xếp loại — kỳ chưa chốt nên điểm hiện tại chỉ là tạm tính.
          </p>
        ) : (
        <table className="w-full text-sm">
          <tbody>
            {buckets.map((b) => (
              <tr key={b.label}>
                <td className="w-56 py-1 text-ink-600">{b.label}</td>
                <td className="py-1">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-4 rounded-sm bg-brand-500"
                      style={{ width: `${(b.n / maxBucket) * 100}%`, minWidth: b.n ? 8 : 0 }}
                    />
                    <span className="text-xs font-medium text-ink-700">
                      {b.n}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </section>

      {/* ---------------- xếp hạng phòng ban ---------------- */}
      <section className="mb-8 break-inside-avoid">
        <h2 className="mb-3 text-lg font-bold">
          {isFinal ? "2. Xếp hạng phòng ban" : "2. Điểm tạm tính theo phòng ban"}
        </h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-ink-100">
              <th className="border border-ink-200 px-2 py-1.5 text-left">#</th>
              <th className="border border-ink-200 px-2 py-1.5 text-left">
                Phòng ban
              </th>
              <th className="border border-ink-200 px-2 py-1.5 text-right">
                Nhân sự
              </th>
              <th className="border border-ink-200 px-2 py-1.5 text-right">
                Điểm trung bình
              </th>
              <th className="border border-ink-200 px-2 py-1.5 text-left">
                Xếp loại
              </th>
            </tr>
          </thead>
          <tbody>
            {departments.map((d, i) => (
              <tr key={d.name}>
                <td className="border border-ink-200 px-2 py-1.5">{i + 1}</td>
                <td className="border border-ink-200 px-2 py-1.5 font-medium">
                  {d.name}
                </td>
                <td className="border border-ink-200 px-2 py-1.5 text-right">
                  {d.employees.length}
                </td>
                <td className="border border-ink-200 px-2 py-1.5 text-right font-semibold">
                  {d.avgScore.toFixed(2)}
                </td>
                <td className="border border-ink-200 px-2 py-1.5">
                  {rankLabel(d.avgScore)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ---------------- cảnh báo ---------------- */}
      {(mismatches.length > 0 || capped.length > 0) && (
        <section className="mb-8 break-inside-avoid">
          <h2 className="mb-3 text-lg font-bold">3. Điểm cần lưu ý</h2>

          {mismatches.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-semibold text-red-700">
                Lệch số liệu trên 5% ({mismatches.length} dòng)
              </h3>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-red-50">
                    <th className="border border-ink-200 px-2 py-1 text-left">
                      Nhân sự
                    </th>
                    <th className="border border-ink-200 px-2 py-1 text-left">
                      Chỉ tiêu
                    </th>
                    <th className="border border-ink-200 px-2 py-1 text-right">
                      Số hệ thống
                    </th>
                    <th className="border border-ink-200 px-2 py-1 text-right">
                      NV khai
                    </th>
                    <th className="border border-ink-200 px-2 py-1 text-right">
                      Lệch
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {mismatches.map((r) => (
                    <tr key={r.id}>
                      <td className="border border-ink-200 px-2 py-1">
                        {r.employee.fullName}
                      </td>
                      <td className="border border-ink-200 px-2 py-1">
                        {r.kpiDefinition?.name ?? "—"}
                      </td>
                      <td className="border border-ink-200 px-2 py-1 text-right">
                        {fmt(r.actualSystem)}
                      </td>
                      <td className="border border-ink-200 px-2 py-1 text-right">
                        {fmt(r.actualSelf)}
                      </td>
                      <td className="border border-ink-200 px-2 py-1 text-right font-semibold text-red-700">
                        {r.mismatchPercent}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {capped.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink-700">
                Vượt trần {KPI_SCORE_CAP}% ({capped.length} dòng)
              </h3>
              <p className="mb-2 text-xs text-ink-600">
                Vượt trần nhiều kỳ liên tiếp thường là dấu hiệu chỉ tiêu giao
                đang đặt thấp hơn năng lực thật.
              </p>
              <ul className="list-inside list-disc text-xs text-ink-700">
                {capped.slice(0, 15).map((r) => (
                  <li key={r.id}>
                    {r.employee.fullName} — {r.kpiDefinition?.name ?? "—"} (giao{" "}
                    {fmt(r.targetValue)}, thực tế{" "}
                    {fmt(r.actualFinal ?? r.actualSelf ?? r.actualSystem)})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* ---------------- chi tiết từng phòng ban ---------------- */}
      <section>
        <h2 className="mb-3 text-lg font-bold">
          {mismatches.length > 0 || capped.length > 0 ? "4" : "3"}. Chi tiết theo
          phòng ban
        </h2>

        {departments.map((d) => (
          <div key={d.name} className="mb-6">
            <h3 className="mb-2 border-b border-ink-200 pb-1 text-base font-semibold">
              {d.name}
              <span className="ml-2 text-sm font-normal text-ink-500">
                trung bình {d.avgScore.toFixed(2)} điểm
              </span>
            </h3>

            {d.employees.map((e) => (
              <div key={e.id} className="mb-4 break-inside-avoid">
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-sm font-medium">
                    {e.name}
                    {e.jobTitle && (
                      <span className="ml-2 text-xs font-normal text-ink-500">
                        {e.jobTitle}
                      </span>
                    )}
                  </span>
                  <span className="text-sm font-bold">
                    {e.totalScore.toFixed(2)} điểm ·{" "}
                    {rankLabel(e.totalScore)}
                  </span>
                </div>
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-ink-100">
                      <th className="border border-ink-200 px-2 py-1 text-left">
                        Chỉ tiêu
                      </th>
                      <th className="border border-ink-200 px-2 py-1 text-right">
                        Trọng số
                      </th>
                      <th className="border border-ink-200 px-2 py-1 text-right">
                        Giao
                      </th>
                      <th className="border border-ink-200 px-2 py-1 text-right">
                        Thực tế
                      </th>
                      <th className="border border-ink-200 px-2 py-1 text-right">
                        Mức đạt
                      </th>
                      <th className="border border-ink-200 px-2 py-1 text-right">
                        Điểm
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.rows.map((r) => (
                      <tr
                        key={r.id}
                        className={r.hasMismatch ? "bg-red-50" : ""}
                      >
                        <td className="border border-ink-200 px-2 py-1">
                          {r.kpiDefinition?.name ?? "—"}
                          <span className="text-ink-400">
                            {" "}
                            ({r.kpiDefinition?.unit ?? "—"},{" "}
                            {r.kpiDefinition?.isHigherBetter ? "↑" : "↓"})
                          </span>
                        </td>
                        <td className="border border-ink-200 px-2 py-1 text-right">
                          {r.weightPercent}%
                        </td>
                        <td className="border border-ink-200 px-2 py-1 text-right">
                          {fmt(r.targetValue)}
                        </td>
                        <td className="border border-ink-200 px-2 py-1 text-right">
                          {fmt(r.actualFinal ?? r.actualSelf ?? r.actualSystem)}
                        </td>
                        <td className="border border-ink-200 px-2 py-1 text-right">
                          {r.achievementPercent}%{r.isCapped && " ⌈"}
                        </td>
                        <td className="border border-ink-200 px-2 py-1 text-right font-semibold">
                          {r.weightedScore.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-ink-50 font-semibold">
                      <td className="border border-ink-200 px-2 py-1">
                        Tổng cộng
                      </td>
                      <td className="border border-ink-200 px-2 py-1 text-right">
                        {e.totalWeight}%
                      </td>
                      <td
                        className="border border-ink-200 px-2 py-1"
                        colSpan={3}
                      />
                      <td className="border border-ink-200 px-2 py-1 text-right">
                        {e.totalScore.toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ))}
      </section>

      <footer className="mt-8 border-t border-ink-200 pt-4 text-xs text-ink-500">
        <p>
          Ký hiệu ⌈ là dòng đã chạm trần {KPI_SCORE_CAP}%. Dòng nền đỏ là dòng có
          số nhân viên khai lệch quá 5% so với số hệ thống.
        </p>
        <p className="mt-1">
          Báo cáo sinh tự động từ hệ thống Quản lý Công việc &amp; KPI ·{" "}
          {company?.value ?? "GANI FOODY"} · {formatVnDateTime(new Date())}
        </p>
      </footer>
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded border p-3 ${
        warn ? "border-red-300 bg-red-50" : "border-ink-200 bg-ink-50"
      }`}
    >
      <div className="text-[10px] font-semibold tracking-wide text-ink-500 uppercase">
        {label}
      </div>
      <div
        className={`mt-1 text-xl font-bold ${warn ? "text-red-700" : "text-ink-900"}`}
      >
        {value}
      </div>
    </div>
  );
}

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n);
}
