import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { ChevronLeft, ChevronRight, Factory, Plus, TriangleAlert, X } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  RETURNED_WHERE,
  WAITING_QC_WHERE,
  awaitingMyStepWhere,
  withProductionRole,
} from "@/lib/services/production-service";
import {
  PRODUCTION_ROLE_LABEL,
  SHIFT_TYPE_LABEL,
} from "@/lib/production/constants";
import {
  SHIFT_STAGE_LABEL,
  shiftStage,
  type ShiftStage,
} from "@/lib/production/shift-flow";
import { fmtDate, fmtKg, fmtNum } from "@/lib/format";
import {
  Badge,
  EmptyState,
  PageHeader,
  ShowingCount,
  StatCard,
} from "@/components/ui";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;
/** Khối "chờ bạn xử lý" chỉ hiện chừng này dòng — còn lại lọc theo thẻ số */
const MINE_LIMIT = 20;

/**
 * Bộ lọc theo chặng — mỗi thẻ số đầu trang là một bộ lọc (?status=…).
 * "Chờ KCS" không gồm ca bị trả về: ca đó đang nằm ở phía sản xuất.
 */
const STAGE_FILTER: Record<ShiftStage, Prisma.ProductionShiftLogWhereInput> = {
  DRAFT: WAITING_QC_WHERE,
  RETURNED: RETURNED_WHERE,
  QC_APPROVED: { status: "QC_APPROVED" },
  LOCKED: { status: "LOCKED" },
};

const FILTER_LABEL: Record<ShiftStage, string> = {
  DRAFT: "Chờ KCS xác nhận",
  RETURNED: "KCS trả về sản xuất",
  QC_APPROVED: "Chờ BGĐ khoá số",
  LOCKED: "Đã khoá số",
};

/** Việc cần làm ở mỗi chặng — chữ trên nút trong khối "chờ bạn xử lý" */
const NEXT_ACTION: Record<ShiftStage, string> = {
  DRAFT: "Xác nhận KCS",
  RETURNED: "Sửa và gửi lại",
  QC_APPROVED: "Khoá số",
  LOCKED: "Xem",
};

function isStage(v: unknown): v is ShiftStage {
  return typeof v === "string" && v in STAGE_FILTER;
}

function listHref(status: ShiftStage | null, page = 1) {
  const q = new URLSearchParams();
  if (status) q.set("status", status);
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `/production?${s}` : "/production";
}

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const base = (await requireSession())!;
  const user = await withProductionRole(base);
  const sp = await searchParams;

  const isInsider =
    user.role === "CEO" || user.role === "ADMIN" || !!user.productionRole;
  if (!isInsider) redirect("/dashboard");

  const isWide =
    user.role === "CEO" ||
    user.role === "ADMIN" ||
    ["SUPERVISOR", "QC_OFFICER", "PRODUCTION_DIRECTOR"].includes(
      user.productionRole ?? ""
    );

  const scope: Prisma.ProductionShiftLogWhereInput = isWide
    ? {}
    : {
        OR: [
          { createdById: user.id },
          { participants: { some: { userId: user.id } } },
        ],
      };

  const filter = isStage(sp.status) ? sp.status : null;
  const listWhere: Prisma.ProductionShiftLogWhereInput = filter
    ? { AND: [scope, STAGE_FILTER[filter]] }
    : scope;
  const mineWhere = awaitingMyStepWhere(user);

  // Số đếm theo chặng đi cùng phạm vi xem của người dùng — bấm thẻ "Chờ KCS 5"
  // thì danh sách lọc ra đúng 5 ca, không phải 5 ca của cả xưởng.
  const countIn = (w: Prisma.ProductionShiftLogWhereInput) =>
    prisma.productionShiftLog.count({ where: { AND: [scope, w] } });

  const [total, waitingQc, returned, waitingLock, locked, openAudits, mineTotal] =
    await Promise.all([
      prisma.productionShiftLog.count({ where: listWhere }),
      countIn(STAGE_FILTER.DRAFT),
      countIn(STAGE_FILTER.RETURNED),
      countIn(STAGE_FILTER.QC_APPROVED),
      countIn(STAGE_FILTER.LOCKED),
      prisma.antiGamingAudit.count({
        where: { status: { in: ["PENDING_EXPLANATION", "EXPLAINED"] } },
      }),
      mineWhere ? countIn(mineWhere) : Promise.resolve(0),
    ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const requested = Number.parseInt(sp.page ?? "1", 10);
  const page = Math.min(
    totalPages,
    Number.isFinite(requested) && requested > 0 ? requested : 1
  );
  // Khối "chờ bạn" chỉ ở trang đầu, khi không lọc — đã lọc là đã biết mình tìm gì
  const showMine = !!mineWhere && mineTotal > 0 && page === 1 && !filter;

  const [shifts, mine] = await Promise.all([
    prisma.productionShiftLog.findMany({
      where: listWhere,
      include: {
        sku: true,
        participants: { select: { userId: true } },
        _count: { select: { audits: true } },
      },
      orderBy: [{ shiftDate: "desc" }, { shiftType: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    showMine
      ? prisma.productionShiftLog.findMany({
          where: { AND: [scope, mineWhere!] },
          include: { sku: true },
          // Ca cũ nhất trước — để lâu nhất là cần xử lý gấp nhất
          orderBy: [{ shiftDate: "asc" }, { shiftType: "asc" }],
          take: MINE_LIMIT,
        })
      : Promise.resolve([]),
  ]);

  const canDraft =
    user.role === "CEO" ||
    ["WORKER", "TEAM_LEADER", "SUPERVISOR", "PRODUCTION_DIRECTOR"].includes(
      user.productionRole ?? ""
    );

  // Bấm lại thẻ đang lọc thì bỏ lọc
  const cardHref = (st: ShiftStage) => (filter === st ? listHref(null) : listHref(st));

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

      {/* Thẻ số = bộ lọc. Thẻ "trả về" chỉ hiện khi có ca bị trả về (hoặc
          đang lọc theo nó) — bình thường là 0, chiếm chỗ vô ích. */}
      <div
        className={`mb-6 grid grid-cols-2 gap-3 ${
          returned > 0 || filter === "RETURNED" ? "lg:grid-cols-5" : "lg:grid-cols-4"
        }`}
      >
        <StatCard
          label="Chờ KCS xác nhận"
          value={waitingQc}
          tone={waitingQc > 0 ? "amber" : "slate"}
          hint={filter === "DRAFT" ? "đang lọc · bấm để bỏ" : "bước 1 đã xong"}
          href={cardHref("DRAFT")}
        />
        {(returned > 0 || filter === "RETURNED") && (
          <StatCard
            label="KCS trả về sản xuất"
            value={returned}
            tone={returned > 0 ? "amber" : "slate"}
            surface={returned > 0 ? "amber" : undefined}
            hint={filter === "RETURNED" ? "đang lọc · bấm để bỏ" : "chờ người khai sửa"}
            href={cardHref("RETURNED")}
          />
        )}
        <StatCard
          label="Chờ BGĐ khoá số"
          value={waitingLock}
          tone="slate"
          hint={filter === "QC_APPROVED" ? "đang lọc · bấm để bỏ" : "bước 2 đã xong"}
          href={cardHref("QC_APPROVED")}
        />
        <StatCard
          label="Đã khoá số"
          value={locked}
          tone="slate"
          hint={filter === "LOCKED" ? "đang lọc · bấm để bỏ" : "đã chấm điểm"}
          href={cardHref("LOCKED")}
        />
        <StatCard
          label="Cảnh báo đang treo"
          value={openAudits}
          tone={openAudits > 0 ? "red" : "slate"}
          surface={openAudits > 0 ? "red" : undefined}
          hint={openAudits > 0 ? "thưởng đang bị khoá" : "không có bất thường"}
          href="/production/audits"
        />
      </div>

      {/* ---------------- Chờ bạn xử lý ---------------- */}
      {showMine && (
        <section className="mb-6" aria-labelledby="mine-title">
          <h2 id="mine-title" className="section-title mb-2">
            Chờ bạn xử lý ({fmtNum(mineTotal)})
          </h2>
          <ul className="card divide-y divide-ink-100">
            {mine.map((s) => {
              const st = shiftStage(s);
              const href =
                st === "RETURNED" ? `/production/${s.id}/edit` : `/production/${s.id}`;
              return (
                <li key={s.id}>
                  <Link
                    href={href}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-ink-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-ink-900">
                        {SHIFT_TYPE_LABEL[s.shiftType] ?? s.shiftType} · {fmtDate(s.shiftDate)}
                      </span>
                      <span className="ml-2 text-sm text-ink-600">{s.sku.skuName}</span>
                      <span className="block text-xs text-ink-500">
                        {SHIFT_STAGE_LABEL[st]} · thô {fmtKg(s.rawOutputKg)}
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-brand-700">
                      {NEXT_ACTION[st]} <ChevronRight size={16} aria-hidden />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <ShowingCount
            shown={mine.length}
            total={mineTotal}
            hint="ca cũ nhất trước · bấm thẻ số ở trên để xem hết"
          />
        </section>
      )}

      {/* ---------------- Tất cả ca ---------------- */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title">
          {filter ? FILTER_LABEL[filter] : "Tất cả ca"} ({fmtNum(total)})
        </h2>
        {filter && (
          <Link href={listHref(null)} className="btn btn-sm inline-flex items-center gap-1">
            <X size={14} aria-hidden /> Bỏ lọc
          </Link>
        )}
      </div>

      {shifts.length === 0 ? (
        filter ? (
          <EmptyState
            icon={<Factory size={32} strokeWidth={1.75} />}
            title={`Không có ca nào ở mục "${FILTER_LABEL[filter]}"`}
            hint="Bấm 'Bỏ lọc' để xem mọi ca."
          />
        ) : (
          <EmptyState
            icon={<Factory size={32} strokeWidth={1.75} />}
            title="Chưa có ca sản xuất nào được khai"
            hint={
              canDraft
                ? "Bấm 'Khai ca sản xuất' để ghi ca đầu tiên. Cần có ít nhất một mã SKU trong danh mục trước."
                : "Khi tổ trưởng khai ca, số liệu sẽ hiện ở đây."
            }
          />
        )
      ) : (
        <>
          <div className="table-wrap">
            <table className="tbl tbl-stack sm:min-w-[900px]">
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
                {shifts.map((s) => {
                  const st = shiftStage(s);
                  const notQcYet = st === "DRAFT" || st === "RETURNED";
                  return (
                    <tr key={s.id}>
                      <td>
                        <Link
                          href={`/production/${s.id}`}
                          className="font-medium text-ink-900 hover:text-brand-700"
                        >
                          {fmtDate(s.shiftDate)}
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
                      <td data-label="Thô" className="text-right text-ink-600 tabular-nums">
                        {fmtKg(s.rawOutputKg)}
                      </td>
                      <td data-label="Đạt QC" className="text-right font-medium text-ink-900 tabular-nums">
                        {notQcYet ? (
                          <span className="font-normal text-ink-400">—</span>
                        ) : (
                          fmtKg(s.qcPassedKg)
                        )}
                      </td>
                      <td data-label="Phế" className="text-right tabular-nums">
                        {notQcYet ? (
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
                        <StatusBadge stage={st} />
                        {s._count.audits > 0 && (
                          <div className="mt-1">
                            <Badge tone="red">
                              <TriangleAlert size={12} strokeWidth={2.5} className="mr-1 inline -mt-0.5" />
                              {s._count.audits} cảnh báo
                            </Badge>
                          </div>
                        )}
                      </td>
                      <td data-label="Đường đi">
                        <StepTrail stage={st} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ---------------- Phân trang ---------------- */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-ink-500 tabular-nums">
              {totalPages > 1
                ? `Trang ${fmtNum(page)}/${fmtNum(totalPages)} · ca ${fmtNum((page - 1) * PAGE_SIZE + 1)}–${fmtNum((page - 1) * PAGE_SIZE + shifts.length)} trong ${fmtNum(total)}`
                : `${fmtNum(total)} ca`}
            </div>
            {totalPages > 1 && (
              <nav className="flex gap-2" aria-label="Phân trang">
                {page > 1 ? (
                  <Link
                    href={listHref(filter, page - 1)}
                    className="btn-ghost btn-sm inline-flex items-center gap-1"
                    rel="prev"
                  >
                    <ChevronLeft size={14} aria-hidden /> Trang trước
                  </Link>
                ) : (
                  <span className="btn-ghost btn-sm inline-flex items-center gap-1 opacity-50" aria-disabled>
                    <ChevronLeft size={14} aria-hidden /> Trang trước
                  </span>
                )}
                {page < totalPages ? (
                  <Link
                    href={listHref(filter, page + 1)}
                    className="btn-ghost btn-sm inline-flex items-center gap-1"
                    rel="next"
                  >
                    Trang sau <ChevronRight size={14} aria-hidden />
                  </Link>
                ) : (
                  <span className="btn-ghost btn-sm inline-flex items-center gap-1 opacity-50" aria-disabled>
                    Trang sau <ChevronRight size={14} aria-hidden />
                  </span>
                )}
              </nav>
            )}
          </div>
        </>
      )}
    </>
  );
}

/**
 * Trạng thái ca: khai xong chờ KCS là luồng bình thường → trung tính; KCS đã
 * xác nhận → xanh lam (thông tin); đã khoá → lá xanh. Chỉ "KCS trả về" có nền
 * vàng — đó là ngoại lệ, có người đang phải sửa.
 */
function StatusBadge({ stage }: { stage: ShiftStage }) {
  const tone =
    stage === "LOCKED"
      ? "green"
      : stage === "QC_APPROVED"
        ? "brand"
        : stage === "RETURNED"
          ? "amber"
          : "slate";
  return <Badge tone={tone}>{SHIFT_STAGE_LABEL[stage]}</Badge>;
}

/**
 * Ba ô cho thấy ca đang ở bước nào của luồng duyệt. Bước đã qua: viền + chữ lá
 * xanh (không tô nền — đây là trạng thái bình thường, không phải tín hiệu).
 * Ca bị KCS trả về: ô SX viền vàng — việc đang quay lại phía sản xuất.
 */
function StepTrail({ stage }: { stage: ShiftStage }) {
  const step = stage === "LOCKED" ? 3 : stage === "QC_APPROVED" ? 2 : 1;
  const returned = stage === "RETURNED";
  const labels = ["SX", "KCS", "BGĐ"];
  return (
    <div
      className="flex items-center gap-1"
      aria-label={
        returned
          ? "KCS trả về, chờ sản xuất sửa"
          : `Đã qua ${step}/3 bước: ${labels.slice(0, step).join(", ")}`
      }
    >
      {labels.map((l, i) => (
        <span key={l} className="flex items-center gap-1">
          <span
            className={`flex h-6 min-w-9 items-center justify-center rounded border px-1 text-xs font-semibold ${
              returned && i === 0
                ? "border-amber-500 text-amber-800"
                : i < step && !returned
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
