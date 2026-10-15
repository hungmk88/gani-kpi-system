import Link from "next/link";
import { redirect } from "next/navigation";
import { Factory, Plus, TriangleAlert } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { withProductionRole } from "@/lib/services/production-service";
import {
  PRODUCTION_ROLE_LABEL,
  SHIFT_STATUS_LABEL,
  SHIFT_TYPE_LABEL,
} from "@/lib/production/constants";
import {
  Badge,
  EmptyState,
  PageHeader,
  StatCard,
  formatDate,
} from "@/components/ui";

export const dynamic = "force-dynamic";

/** Khối lượng kiểu Việt Nam: 374,5 — tối đa 2 chữ số thập phân */
const fmtKg = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });

export default async function ProductionPage() {
  const base = (await requireSession())!;
  const user = await withProductionRole(base);

  const isInsider =
    user.role === "CEO" || user.role === "ADMIN" || !!user.productionRole;
  if (!isInsider) redirect("/dashboard");

  const isWide =
    user.role === "CEO" ||
    user.role === "ADMIN" ||
    ["SUPERVISOR", "QC_OFFICER", "PRODUCTION_DIRECTOR"].includes(
      user.productionRole ?? ""
    );

  const scope = isWide
    ? {}
    : {
        OR: [
          { createdById: user.id },
          { participants: { some: { userId: user.id } } },
        ],
      };

  const [shifts, waitingQc, waitingLock, openAudits] = await Promise.all([
    prisma.productionShiftLog.findMany({
      where: scope,
      include: {
        sku: true,
        createdBy: true,
        qcOfficer: true,
        participants: true,
        _count: { select: { audits: true } },
      },
      orderBy: [{ shiftDate: "desc" }, { shiftType: "asc" }],
      take: 60,
    }),
    prisma.productionShiftLog.count({ where: { status: "DRAFT" } }),
    prisma.productionShiftLog.count({ where: { status: "QC_APPROVED" } }),
    prisma.antiGamingAudit.count({
      where: { status: { in: ["PENDING_EXPLANATION", "EXPLAINED"] } },
    }),
  ]);

  const canDraft =
    user.role === "CEO" ||
    ["WORKER", "TEAM_LEADER", "SUPERVISOR", "PRODUCTION_DIRECTOR"].includes(
      user.productionRole ?? ""
    );

  return (
    <>
      <PageHeader
        title="Xưởng sản xuất"
        subtitle={`Số liệu ca đi qua 3 bước bắt buộc: Sản xuất khai → KCS xác nhận → Ban Giám đốc khoá. Chấm điểm chỉ chạy ở bước cuối.${
          user.productionRole
            ? ` Bạn đang là ${PRODUCTION_ROLE_LABEL[user.productionRole]}.`
            : ""
        }`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/production/audits" className="btn-ghost">
              Cảnh báo {openAudits > 0 && `(${openAudits})`}
            </Link>
            <Link href="/production/skus" className="btn-ghost">
              Danh mục SKU
            </Link>
            <Link href="/production/raw-materials" className="btn-ghost">
              Kho NVL
            </Link>
            {canDraft && (
              <Link href="/production/new" className="btn-primary">
                <Plus size={16} aria-hidden /> Khai ca sản xuất
              </Link>
            )}
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Chờ KCS xác nhận"
          value={waitingQc}
          tone={waitingQc > 0 ? "amber" : "slate"}
          hint="bước 1 đã xong"
        />
        <StatCard
          label="Chờ BGĐ khoá số"
          value={waitingLock}
          tone="slate"
          hint="bước 2 đã xong"
        />
        <StatCard
          label="Cảnh báo đang treo"
          value={openAudits}
          tone={openAudits > 0 ? "red" : "slate"}
          surface={openAudits > 0 ? "red" : undefined}
          hint={openAudits > 0 ? "thưởng đang bị khoá" : "không có bất thường"}
          href="/production/audits"
        />
        <StatCard
          label="Ca đã ghi nhận"
          value={shifts.length}
          hint="60 ca gần nhất"
        />
      </div>

      {shifts.length === 0 ? (
        <EmptyState
          icon={<Factory size={32} strokeWidth={1.75} />}
          title="Chưa có ca sản xuất nào được khai"
          hint={
            canDraft
              ? "Bấm 'Khai ca sản xuất' để ghi ca đầu tiên. Cần có ít nhất một mã SKU trong danh mục trước."
              : "Khi tổ trưởng khai ca, số liệu sẽ hiện ở đây."
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="tbl tbl-stack sm:min-w-[900px]">
            <thead>
              <tr>
                <th>Ngày · Ca</th>
                <th>Mã sản phẩm</th>
                <th className="text-right">Thô (kg)</th>
                <th className="text-right">Đạt QC (kg)</th>
                <th className="text-right">Phế (kg)</th>
                <th className="text-right">Người</th>
                <th>Trạng thái</th>
                <th>Đường đi</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link
                      href={`/production/${s.id}`}
                      className="font-medium text-ink-900 hover:text-brand-700"
                    >
                      {formatDate(s.shiftDate)}
                    </Link>
                    <div className="text-xs text-ink-500">
                      {SHIFT_TYPE_LABEL[s.shiftType] ?? s.shiftType}
                    </div>
                  </td>
                  <td data-label="Sản phẩm">
                    <div className="text-ink-800">{s.sku.skuName}</div>
                    <div className="font-mono text-xs text-ink-500">
                      {s.sku.skuCode}
                    </div>
                  </td>
                  <td data-label="Thô (kg)" className="text-right text-ink-600 tabular-nums">
                    {fmtKg(s.rawOutputKg)}
                  </td>
                  <td data-label="Đạt QC (kg)" className="text-right font-medium text-ink-900 tabular-nums">
                    {s.status === "DRAFT" ? (
                      <span className="font-normal text-ink-400">—</span>
                    ) : (
                      fmtKg(s.qcPassedKg)
                    )}
                  </td>
                  <td data-label="Phế (kg)" className="text-right tabular-nums">
                    {s.status === "DRAFT" ? (
                      <span className="text-ink-400">—</span>
                    ) : (
                      <span
                        className={
                          s.scrapKg > 0 ? "text-amber-800" : "text-ink-600"
                        }
                      >
                        {fmtKg(s.scrapKg)}
                      </span>
                    )}
                  </td>
                  <td data-label="Người" className="text-right text-ink-600 tabular-nums">
                    {s.participants.length}
                  </td>
                  <td data-label="Trạng thái">
                    <StatusBadge status={s.status} />
                    {s._count.audits > 0 && (
                      <div className="mt-1">
                        <Badge tone="red">
                          <TriangleAlert size={10} strokeWidth={2.5} className="mr-1 inline -mt-0.5" />
                          {s._count.audits} cảnh báo
                        </Badge>
                      </div>
                    )}
                  </td>
                  <td data-label="Đường đi">
                    <StepTrail status={s.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/**
 * Trạng thái ca: khai xong chờ KCS là luồng bình thường → trung tính; KCS đã
 * xác nhận → xanh lam (thông tin); đã khoá → lá xanh. Không tô vàng/tím.
 */
function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "LOCKED" ? "green" : status === "QC_APPROVED" ? "brand" : "slate";
  return <Badge tone={tone}>{SHIFT_STATUS_LABEL[status] ?? status}</Badge>;
}

/**
 * Ba ô cho thấy ca đang ở bước nào của luồng duyệt. Bước đã qua: viền + chữ lá
 * xanh (không tô nền — đây là trạng thái bình thường, không phải tín hiệu).
 */
function StepTrail({ status }: { status: string }) {
  const step = status === "LOCKED" ? 3 : status === "QC_APPROVED" ? 2 : 1;
  const labels = ["SX", "KCS", "BGĐ"];
  return (
    <div
      className="flex items-center gap-1"
      aria-label={`Đã qua ${step}/3 bước: ${labels.slice(0, step).join(", ")}`}
    >
      {labels.map((l, i) => (
        <span key={l} className="flex items-center gap-1">
          <span
            className={`flex h-6 min-w-9 items-center justify-center rounded border px-1 text-xs font-semibold ${
              i < step
                ? "border-leaf-500 text-leaf-700"
                : "border-ink-200 text-ink-500"
            }`}
          >
            {l}
          </span>
          {i < 2 && (
            <span
              className={`h-0.5 w-2 ${i + 1 < step ? "bg-leaf-500" : "bg-ink-200"}`}
            />
          )}
        </span>
      ))}
    </div>
  );
}
