import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, ShieldAlert } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge, PageHeader } from "@/components/ui";
import { fmtDateTime, fmtNum } from "@/lib/format";
import {
  ACTION_LABEL,
  DEPT_ID_FIELDS,
  ENTITY_LABEL,
  FIELD_LABEL,
  HIGH_RISK,
  HIGH_RISK_ACTIONS,
  USER_ID_FIELDS,
} from "./audit-labels";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type Names = {
  users: Map<string, string>;
  depts: Map<string, string>;
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = (await requireSession())!;
  if (user.role !== "CEO" && user.role !== "ADMIN") redirect("/dashboard");

  const sp = await searchParams;
  const action = sp.action ?? "";
  // Mặc định chỉ thao tác rủi ro cao; "Tất cả thao tác" là lựa chọn chủ động.
  const showAll = sp.scope === "all";
  const requestedPage = Math.max(1, Math.floor(Number(sp.page) || 1));

  const scopeWhere = showAll ? {} : { action: { in: [...HIGH_RISK_ACTIONS] } };
  const where = action ? { action } : scopeWhere;

  const [total, actions] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.groupBy({
      by: ["action"],
      _count: { action: true },
      orderBy: { _count: { action: "desc" } },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  const logs = await prisma.auditLog.findMany({
    where,
    include: { user: { select: { fullName: true } } },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  const names = await loadNames(logs);
  const targets = await loadTargets(logs);

  const allCount = actions.reduce((s, a) => s + a._count.action, 0);
  const highCount = actions
    .filter((a) => HIGH_RISK.has(a.action))
    .reduce((s, a) => s + a._count.action, 0);
  // Chip từng hành động: chỉ những hành động thuộc nhóm đang xem
  const actionChips = actions
    .filter((a) => showAll || HIGH_RISK.has(a.action))
    .slice(0, 12);

  const href = (p: { action?: string; all?: boolean; page?: number }) => {
    const q = new URLSearchParams();
    if (p.all) q.set("scope", "all");
    if (p.action) q.set("action", p.action);
    if (p.page && p.page > 1) q.set("page", String(p.page));
    const s = q.toString();
    return s ? `/audit?${s}` : "/audit";
  };

  const chip = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm ${
      active ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-700 hover:bg-ink-200"
    }`;

  return (
    <>
      <PageHeader
        title="Nhật ký hệ thống"
        subtitle="Bản ghi không thể xoá. Mọi thao tác chạm vào điểm KPI đều để lại dấu vết đầy đủ: ai, làm gì, lúc nào, số cũ, số mới, lý do."
      />

      <div
        role="tablist"
        aria-label="Nhóm thao tác"
        className="mb-3 flex gap-5 overflow-x-auto border-b border-ink-200"
      >
        {[
          { all: false, label: "Thao tác rủi ro cao", count: highCount },
          { all: true, label: "Tất cả thao tác", count: allCount },
        ].map((t) => {
          const active = showAll === t.all;
          return (
            <Link
              key={t.label}
              href={href({ all: t.all })}
              role="tab"
              aria-selected={active}
              className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-1 py-2.5 text-sm font-medium whitespace-nowrap ${
                active
                  ? "border-brand-600 text-brand-700"
                  : "border-transparent text-ink-500 hover:text-ink-800"
              }`}
            >
              {!t.all && <ShieldAlert size={15} aria-hidden />}
              {t.label}
              <span className="text-xs font-normal text-ink-500 tabular-nums">
                {fmtNum(t.count)}
              </span>
            </Link>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href={href({ all: showAll })}
          aria-current={!action ? "true" : undefined}
          className={chip(!action)}
        >
          {showAll ? "Mọi hành động" : "Mọi thao tác rủi ro"}
        </Link>
        {actionChips.map((a) => (
          <Link
            key={a.action}
            href={href({ all: showAll, action: a.action })}
            aria-current={action === a.action ? "true" : undefined}
            className={chip(action === a.action)}
          >
            {ACTION_LABEL[a.action] ?? a.action} ({fmtNum(a._count.action)})
          </Link>
        ))}
      </div>

      <div className="table-wrap">
        <table className="tbl tbl-stack sm:min-w-[900px]">
          <thead>
            <tr>
              <th className="w-40">Thời điểm</th>
              <th>Người thực hiện</th>
              <th>Hành động</th>
              <th>Đối tượng</th>
              <th>Thay đổi</th>
              <th>Lý do</th>
              <th className="w-28">IP</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="text-xs whitespace-nowrap text-ink-500">
                  {fmtDateTime(l.createdAt)}
                </td>
                <td data-label="Người thực hiện" className="text-ink-700">
                  {l.user?.fullName ?? l.userEmail ?? "Hệ thống"}
                  {l.user && l.userEmail && (
                    <div className="text-xs break-all text-ink-500">{l.userEmail}</div>
                  )}
                </td>
                <td data-label="Hành động">
                  {HIGH_RISK.has(l.action) ? (
                    <Badge tone="red">{ACTION_LABEL[l.action] ?? l.action}</Badge>
                  ) : (
                    <span className="text-ink-700">
                      {ACTION_LABEL[l.action] ?? l.action}
                    </span>
                  )}
                </td>
                <td data-label="Đối tượng" className="text-xs text-ink-500">
                  <div>{ENTITY_LABEL[l.entityName] ?? l.entityName}</div>
                  <Target
                    entityName={l.entityName}
                    entityId={l.entityId}
                    targets={targets}
                    names={names}
                  />
                </td>
                <td data-label="Thay đổi" className="max-w-sm">
                  <Diff before={l.beforePayload} after={l.afterPayload} names={names} />
                </td>
                <td data-label="Lý do" className="max-w-xs text-xs text-ink-600">
                  {l.reason ?? "—"}
                </td>
                <td data-label="IP" className="font-mono text-xs text-ink-500">
                  {l.ipAddress ?? "—"}
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-ink-500">
                  {showAll || action
                    ? "Chưa có bản ghi nào."
                    : "Chưa có thao tác rủi ro cao nào."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-ink-500 tabular-nums">
          {total > 0
            ? `Bản ghi ${fmtNum((page - 1) * PAGE_SIZE + 1)}–${fmtNum(
                (page - 1) * PAGE_SIZE + logs.length
              )} trên tổng ${fmtNum(total)}`
            : null}
        </div>
        {totalPages > 1 && (
          <nav aria-label="Phân trang" className="flex items-center gap-2 text-sm">
            {page > 1 ? (
              <Link
                href={href({ all: showAll, action, page: page - 1 })}
                className="btn-ghost btn-sm"
              >
                <ChevronLeft size={16} aria-hidden /> Trang trước
              </Link>
            ) : null}
            <span className="text-ink-500 tabular-nums">
              Trang {fmtNum(page)}/{fmtNum(totalPages)}
            </span>
            {page < totalPages ? (
              <Link
                href={href({ all: showAll, action, page: page + 1 })}
                className="btn-ghost btn-sm"
              >
                Trang sau <ChevronRight size={16} aria-hidden />
              </Link>
            ) : null}
          </nav>
        )}
      </div>
      <p className="mt-3 text-xs text-ink-500">
        Không có chức năng xoá — kể cả tài khoản quản trị hệ thống cũng không sửa
        được bảng này.
      </p>
    </>
  );
}

/* ------------------------------------------------------- nạp tên một lượt */

type LogLite = {
  entityName: string;
  entityId: string;
  beforePayload: string | null;
  afterPayload: string | null;
};

/**
 * Gom mọi mã người dùng / phòng ban xuất hiện trong trang (đối tượng là tài
 * khoản, người phụ trách trong dữ liệu trước/sau…) rồi nạp tên MỘT lần — đọc
 * "Người phụ trách: 3f9a1c…" thì không ai biết là ai.
 */
async function loadNames(logs: LogLite[]): Promise<Names> {
  const userIds = new Set<string>();
  const deptIds = new Set<string>();
  for (const l of logs) {
    if (l.entityName === "users" && l.entityId !== "bulk") userIds.add(l.entityId);
    for (const p of [parse(l.beforePayload), parse(l.afterPayload)]) {
      if (!p) continue;
      for (const [k, v] of Object.entries(p)) {
        if (typeof v !== "string" || !v) continue;
        if (USER_ID_FIELDS.has(k)) userIds.add(v);
        if (DEPT_ID_FIELDS.has(k)) deptIds.add(v);
      }
    }
  }
  const [users, depts] = await Promise.all([
    userIds.size
      ? prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, fullName: true },
        })
      : [],
    deptIds.size
      ? prisma.department.findMany({
          where: { id: { in: [...deptIds] } },
          select: { id: true, name: true },
        })
      : [],
  ]);
  return {
    users: new Map(users.map((u) => [u.id, u.fullName])),
    depts: new Map(depts.map((d) => [d.id, d.name])),
  };
}

type Targets = {
  tasks: Map<string, { id: string; code: string; title: string }>;
  kpi: Map<string, string>;
};

/** Công việc và dòng KPI là đối tượng hay gặp nhất — nạp mã/tên để đọc được */
async function loadTargets(logs: LogLite[]): Promise<Targets> {
  const taskIds = logs.filter((l) => l.entityName === "tasks").map((l) => l.entityId);
  const kpiIds = logs.filter((l) => l.entityName === "kpi_results").map((l) => l.entityId);
  const [tasks, kpis] = await Promise.all([
    taskIds.length
      ? prisma.task.findMany({
          where: { id: { in: taskIds } },
          select: { id: true, code: true, title: true },
        })
      : [],
    kpiIds.length
      ? prisma.kpiResult.findMany({
          where: { id: { in: kpiIds } },
          select: {
            id: true,
            employee: { select: { fullName: true } },
            kpiDefinition: { select: { name: true } },
            period: { select: { name: true } },
          },
        })
      : [],
  ]);
  return {
    tasks: new Map(tasks.map((t) => [t.id, t])),
    kpi: new Map(
      kpis.map((k) => [
        k.id,
        `${k.employee.fullName} — ${k.kpiDefinition?.name ?? "chỉ tiêu"} · ${k.period.name}`,
      ])
    ),
  };
}

function Target({
  entityName,
  entityId,
  targets,
  names,
}: {
  entityName: string;
  entityId: string;
  targets: Targets;
  names: Names;
}) {
  if (entityName === "users") {
    if (entityId === "bulk") return <div className="text-ink-700">Nhiều tài khoản</div>;
    const n = names.users.get(entityId);
    if (n) return <div className="font-medium text-ink-700">{n}</div>;
  }
  if (entityName === "tasks") {
    const t = targets.tasks.get(entityId);
    if (t) {
      return (
        <Link href={`/tasks/${t.id}`} className="text-brand-700 hover:underline">
          {t.code} · <span className="line-clamp-1 inline">{t.title}</span>
        </Link>
      );
    }
  }
  if (entityName === "kpi_results") {
    const k = targets.kpi.get(entityId);
    if (k) return <div className="text-ink-700">{k}</div>;
  }
  return (
    <div title={entityId}>
      Mã <span className="font-mono">{entityId.slice(0, 8)}</span>
    </div>
  );
}

function Diff({
  before,
  after,
  names,
}: {
  before: string | null;
  after: string | null;
  names: Names;
}) {
  const b = parse(before);
  const a = parse(after);
  if (!b && !a) return <span className="text-ink-400">—</span>;

  const keys = [...new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])];
  // Chỉ những trường thực sự đổi (giá trị giống nhau trước/sau thì bỏ)
  const changed = keys.filter(
    (k) => JSON.stringify(b?.[k]) !== JSON.stringify(a?.[k])
  );
  const label = (k: string, v: unknown) => {
    if (typeof v === "string") {
      if (USER_ID_FIELDS.has(k)) return names.users.get(v) ?? short(v);
      if (DEPT_ID_FIELDS.has(k)) return names.depts.get(v) ?? short(v);
    }
    if (v === true) return "Có";
    if (v === false) return "Không";
    if (v === null) return "—";
    if (typeof v === "number") return fmtNum(v);
    return short(v);
  };

  return (
    <div className="space-y-0.5 text-xs">
      {changed.slice(0, 6).map((k) => {
        const ov = b?.[k];
        const nv = a?.[k];
        return (
          <div key={k}>
            <span className="text-ink-500" title={k}>
              {FIELD_LABEL[k] ?? k}:{" "}
            </span>
            {ov !== undefined && (
              <span className="text-red-700 line-through">{label(k, ov)}</span>
            )}
            {ov !== undefined && nv !== undefined && " → "}
            {nv !== undefined && (
              <span className="font-medium text-leaf-700">{label(k, nv)}</span>
            )}
          </div>
        );
      })}
      {changed.length > 6 && (
        <div className="text-ink-500">và {changed.length - 6} trường khác</div>
      )}
    </div>
  );
}

function parse(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null
      ? (v as Record<string, unknown>)
      : { value: v };
  } catch {
    return { raw: s };
  }
}

function short(v: unknown) {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 40 ? s.slice(0, 40) + "…" : s;
}
