import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge, PageHeader, formatDateTime } from "@/components/ui";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  LOGIN: "Đăng nhập",
  LOGOUT: "Đăng xuất",
  TASK_CREATE: "Tạo công việc",
  TASK_UPDATE: "Cập nhật công việc",
  CROSS_DEPT_REQUEST_CREATE: "Gửi yêu cầu liên phòng",
  CROSS_DEPT_REQUEST_ACCEPT: "Tiếp nhận yêu cầu liên phòng",
  CROSS_DEPT_REQUEST_REJECT: "Từ chối yêu cầu liên phòng",
  KPI_PERIOD_OPEN: "Mở kỳ KPI",
  KPI_PERIOD_FINALIZE: "Chốt toàn kỳ KPI",
  KPI_TARGET_ASSIGN: "Gán chỉ tiêu KPI",
  KPI_TARGET_UPDATE: "Sửa chỉ tiêu KPI",
  KPI_TARGET_REMOVE: "Gỡ chỉ tiêu KPI",
  KPI_SELF_REVIEW: "Nhân viên tự khai",
  KPI_MANAGER_APPROVE: "Trưởng phòng duyệt",
  KPI_MANAGER_ADJUST: "Trưởng phòng điều chỉnh",
  KPI_CEO_APPROVE_LOCK: "Ban Giám đốc chốt & khoá",
  KPI_EDIT_AFTER_LOCK: "Sửa KPI đã khoá",
  KPI_IMPORT_EXCEL: "Nạp số từ Excel",
  IPOS_WEBHOOK_INGEST: "Đồng bộ dữ liệu iPOS",
  CRON_RUN: "Bộ máy nền chạy",
  USER_CREATE: "Tạo tài khoản",
  USER_UPDATE: "Sửa tài khoản",
};

/**
 * Tên trường trong dữ liệu trước/sau → nhãn tiếng Việt cho người đọc nhật ký.
 * Trường chưa có trong bảng thì hiện nguyên tên gốc (không giấu thông tin).
 */
const FIELD_LABEL: Record<string, string> = {
  actualSystem: "Số hệ thống",
  actualSelf: "Số tự khai",
  actualFinal: "Số chốt",
  targetValue: "Chỉ tiêu giao",
  weightPercent: "Trọng số (%)",
  weightedScore: "Điểm",
  achievementPercent: "Mức đạt (%)",
  mismatchPercent: "Mức lệch (%)",
  hasMismatch: "Lệch số",
  isCapped: "Chạm trần",
  selfNote: "Giải trình nhân viên",
  managerNote: "Ghi chú trưởng phòng",
  status: "Trạng thái",
  reason: "Lý do",
  title: "Tiêu đề",
  name: "Tên",
  code: "Mã",
  priority: "Ưu tiên",
  progress: "Tiến độ (%)",
  dueDate: "Hạn chót",
  startDate: "Ngày bắt đầu",
  assigneeId: "Người phụ trách",
  departmentId: "Phòng ban",
  role: "Vai trò",
  isActive: "Đang hoạt động",
  fullName: "Họ tên",
  email: "Email",
  jobTitle: "Chức danh",
  employmentType: "Loại hợp đồng",
  unit: "Đơn vị",
  severity: "Mức độ",
  confidence: "Độ tin cậy",
  sampleSize: "Số kỳ dữ liệu",
  rowsOk: "Dòng nạp được",
  rowsError: "Dòng lỗi",
  totalRows: "Tổng số dòng",
  taskCode: "Mã việc",
  ipAddress: "Địa chỉ IP",
  userAgent: "Trình duyệt",
};

const HIGH_RISK = new Set([
  "KPI_EDIT_AFTER_LOCK",
  "KPI_CEO_APPROVE_LOCK",
  "KPI_PERIOD_FINALIZE",
  "USER_UPDATE",
]);

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = (await requireSession())!;
  if (user.role !== "CEO" && user.role !== "ADMIN") redirect("/dashboard");

  const sp = await searchParams;
  const filter = sp.action ?? "";

  const logs = await prisma.auditLog.findMany({
    where: filter ? { action: filter } : {},
    include: { user: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const actions = await prisma.auditLog.groupBy({
    by: ["action"],
    _count: { action: true },
    orderBy: { _count: { action: "desc" } },
  });

  return (
    <>
      <PageHeader
        title="Nhật ký hệ thống"
        subtitle="Bản ghi không thể xoá. Mọi thao tác chạm vào điểm KPI đều để lại dấu vết đầy đủ: ai, làm gì, lúc nào, số cũ, số mới, lý do."
      />

      <div className="card mb-4 flex flex-wrap gap-2 p-3">
        <a
          href="/audit"
          aria-current={!filter ? "true" : undefined}
          className={`btn-sm rounded-md px-3 py-1.5 text-sm ${
            !filter ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-700 hover:bg-ink-200"
          }`}
        >
          Tất cả
        </a>
        {actions.slice(0, 10).map((a) => (
          <a
            key={a.action}
            href={`/audit?action=${a.action}`}
            aria-current={filter === a.action ? "true" : undefined}
            className={`btn-sm rounded-md px-3 py-1.5 text-sm ${
              filter === a.action
                ? "bg-ink-900 text-white"
                : "bg-ink-100 text-ink-700 hover:bg-ink-200"
            }`}
          >
            {ACTION_LABEL[a.action] ?? a.action} (
            {a._count.action.toLocaleString("vi-VN")})
          </a>
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
                  {formatDateTime(l.createdAt)}
                </td>
                <td data-label="Người thực hiện" className="text-ink-700">
                  {l.user?.fullName ?? l.userEmail ?? "Hệ thống"}
                </td>
                <td data-label="Hành động">
                  {HIGH_RISK.has(l.action) ? (
                    <Badge tone="red">
                      {ACTION_LABEL[l.action] ?? l.action}
                    </Badge>
                  ) : (
                    <span className="text-ink-700">
                      {ACTION_LABEL[l.action] ?? l.action}
                    </span>
                  )}
                </td>
                <td data-label="Đối tượng" className="text-xs text-ink-500">
                  {l.entityName}
                  <div className="text-xs" title={l.entityId}>
                    Mã <span className="font-mono">{l.entityId.slice(0, 8)}</span>
                  </div>
                </td>
                <td data-label="Thay đổi" className="max-w-sm">
                  <Diff before={l.beforePayload} after={l.afterPayload} />
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
                <td colSpan={7} className="py-10 text-center text-ink-400">
                  Chưa có bản ghi nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-500">
        Hiển thị 200 bản ghi gần nhất. Không có chức năng xoá — kể cả tài khoản
        quản trị hệ thống cũng không sửa được bảng này.
      </p>
    </>
  );
}

function Diff({
  before,
  after,
}: {
  before: string | null;
  after: string | null;
}) {
  const b = parse(before);
  const a = parse(after);
  if (!b && !a) return <span className="text-ink-400">—</span>;

  const keys = [...new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])];

  return (
    <div className="space-y-0.5 text-xs">
      {keys.slice(0, 5).map((k) => {
        const ov = b?.[k];
        const nv = a?.[k];
        if (JSON.stringify(ov) === JSON.stringify(nv)) return null;
        return (
          <div key={k}>
            <span className="text-ink-500" title={k}>
              {FIELD_LABEL[k] ?? k}:{" "}
            </span>
            {ov !== undefined && (
              <span className="text-red-700 line-through">{short(ov)}</span>
            )}
            {ov !== undefined && nv !== undefined && " → "}
            {nv !== undefined && (
              <span className="font-medium text-leaf-700">{short(nv)}</span>
            )}
          </div>
        );
      })}
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
