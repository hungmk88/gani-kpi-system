import Link from "next/link";
import { redirect } from "next/navigation";
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
                + Khai ca sản xuất
              </Link>
            )}
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Chờ KCS xác nhận"
          value={waitingQc}
          tone={waitingQc > 0 ? "amber" : "green"}
          hint="bước 1 đã xong"
        />
        <StatCard
          label="Chờ BGĐ khoá số"
          value={waitingLock}
          tone={waitingLock > 0 ? "violet" : "green"}
          hint="bước 2 đã xong"
        />
        <StatCard
          label="Cảnh báo đang treo"
          value={openAudits}
          tone={openAudits > 0 ? "red" : "green"}
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
          icon="🏭"
          title="Chưa có ca sản xuất nào được khai"
          hint={
            canDraft
              ? "Bấm 'Khai ca sản xuất' để ghi ca đầu tiên. Cần có ít nhất một mã SKU trong danh mục trước."
              : "Khi tổ trưởng khai ca, số liệu sẽ hiện ở đây."
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="tbl min-w-[900px]">
            <thead>
              <tr>
                <th>Ngày · Ca</th>
                <th>Mã sản phẩm</th>
                <th className="text-right">Thô</th>
                <th className="text-right">Đạt QC</th>
                <th className="text-right">Phế</th>
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
                  <td>
                    <div className="text-ink-800">{s.sku.skuName}</div>
                    <div className="font-mono text-xs text-ink-500">
                      {s.sku.skuCode}
                    </div>
                  </td>
                  <td className="text-right text-ink-600">{s.rawOutputKg}</td>
                  <td className="text-right font-medium text-ink-900">
                    {s.status === "DRAFT" ? "—" : s.qcPassedKg}
                  </td>
                  <td className="text-right">
                    {s.status === "DRAFT" ? (
                      <span className="text-ink-400">—</span>
                    ) : (
                      <span
                        className={
                          s.scrapKg > 0 ? "text-amber-700" : "text-ink-600"
                        }
                      >
                        {s.scrapKg}
                      </span>
                    )}
                  </td>
                  <td className="text-right text-ink-600">
                    {s.participants.length}
                  </td>
                  <td>
                    <StatusBadge status={s.status} />
                    {s._count.audits > 0 && (
                      <div className="mt-1">
                        <Badge tone="red">⚠ {s._count.audits} cảnh báo</Badge>
                      </div>
                    )}
                  </td>
                  <td>
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

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "LOCKED" ? "green" : status === "QC_APPROVED" ? "violet" : "amber";
  return <Badge tone={tone}>{SHIFT_STATUS_LABEL[status] ?? status}</Badge>;
}

/** Ba chấm cho thấy ca đang ở bước nào của luồng duyệt. */
function StepTrail({ status }: { status: string }) {
  const step = status === "LOCKED" ? 3 : status === "QC_APPROVED" ? 2 : 1;
  const labels = ["SX", "KCS", "BGĐ"];
  return (
    <div className="flex items-center gap-1">
      {labels.map((l, i) => (
        <span key={l} className="flex items-center gap-1">
          <span
            className={`flex h-5 w-8 items-center justify-center rounded text-[10px] font-bold ${
              i < step
                ? "bg-emerald-500 text-white"
                : "bg-ink-100 text-ink-400"
            }`}
          >
            {l}
          </span>
          {i < 2 && (
            <span
              className={`h-0.5 w-2 ${i + 1 < step ? "bg-emerald-400" : "bg-ink-200"}`}
            />
          )}
        </span>
      ))}
    </div>
  );
}
