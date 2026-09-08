import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import AdminPanel from "./admin-panel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = (await requireSession())!;
  if (user.role !== "ADMIN") redirect("/dashboard");

  const [
    users,
    departments,
    definitions,
    settings,
    importLogs,
    integrationSources,
    webhookLogs,
  ] = await Promise.all([
      prisma.user.findMany({
        include: { department: true },
        orderBy: [{ role: "asc" }, { fullName: "asc" }],
      }),
      prisma.department.findMany({
        include: { _count: { select: { users: true } } },
        orderBy: { name: "asc" },
      }),
      prisma.kpiDefinition.findMany({
        include: { department: true },
        orderBy: [{ department: { name: "asc" } }, { code: "asc" }],
      }),
      prisma.systemSetting.findMany({ orderBy: { key: "asc" } }),
      prisma.dataImport.findMany({
        include: { user: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.integrationSource.findMany({ orderBy: { name: "asc" } }),
      prisma.webhookLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
    ]);

  return (
    <>
      <PageHeader
        title="Quản trị hệ thống"
        subtitle="Tài khoản, phòng ban, danh mục chỉ tiêu và cấu hình kết nối. Quản trị hệ thống KHÔNG có quyền chạm vào điểm KPI."
      />

      <AdminPanel
        users={users.map((u) => ({
          id: u.id,
          email: u.email,
          fullName: u.fullName,
          jobTitle: u.jobTitle ?? "",
          role: u.role,
          departmentId: u.departmentId,
          departmentName: u.department?.name ?? null,
          telegramChatId: u.telegramChatId,
          isActive: u.isActive,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        }))}
        departments={departments.map((d) => ({
          id: d.id,
          code: d.code,
          name: d.name,
          userCount: d._count.users,
        }))}
        definitions={definitions.map((k) => ({
          id: k.id,
          code: k.code,
          name: k.name,
          unit: k.unit,
          isHigherBetter: k.isHigherBetter,
          dataSource: k.dataSource,
          defaultWeight: k.defaultWeight ?? 0,
          isActive: k.isActive,
          departmentId: k.departmentId,
          departmentName: k.department?.name ?? null,
        }))}
        settings={settings.map((s) => ({
          key: s.key,
          value: s.value,
          label: s.label ?? s.key,
        }))}
        importLogs={importLogs.map((i) => ({
          id: i.id,
          fileName: i.fileName,
          source: i.source,
          uploadedBy: i.user.fullName,
          rowsOk: i.rowsOk,
          rowsError: i.rowsError,
          createdAt: i.createdAt.toISOString(),
          errorLog: i.errorLog,
        }))}
        integrationSources={integrationSources.map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          kind: s.kind,
          priority: s.priority,
          isActive: s.isActive,
          lastSeenAt: s.lastSeenAt?.toISOString() ?? null,
          lastStatus: s.lastStatus,
        }))}
        webhookLogs={webhookLogs.map((w) => ({
          id: w.id,
          sourceCode: w.sourceCode,
          endpoint: w.endpoint,
          signatureOk: w.signatureOk,
          httpStatus: w.httpStatus,
          itemsReceived: w.itemsReceived,
          itemsApplied: w.itemsApplied,
          itemsRejected: w.itemsRejected,
          error: w.error,
          ipAddress: w.ipAddress,
          createdAt: w.createdAt.toISOString(),
        }))}
        appUrl={process.env.APP_URL || "http://localhost:3000"}
        telegramReady={{
          enabled: process.env.TELEGRAM_ENABLED === "true",
          hasToken: !!process.env.TELEGRAM_BOT_TOKEN,
          hasWebhookSecret: !!process.env.TELEGRAM_WEBHOOK_SECRET,
        }}
        zaloReady={{
          enabled: process.env.ZALO_ENABLED === "true",
          hasToken: !!process.env.ZALO_ZNS_ACCESS_TOKEN,
        }}
      />
    </>
  );
}
