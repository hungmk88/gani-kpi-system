import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { BusinessError } from "@/lib/rbac";
import { clientMeta, writeAudit } from "@/lib/audit";
import { generateSecret } from "@/lib/integrations/signature";
import { ERR } from "@/lib/constants";

export const runtime = "nodejs";

const KINDS = ["IPOS", "CRM", "ERP", "SHEETS", "OTHER"] as const;

const createSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9_-]+$/, "Mã chỉ gồm chữ thường, số, gạch ngang hoặc gạch dưới."),
  name: z.string().min(2).max(255),
  kind: z.enum(KINDS),
  priority: z.number().int().min(1).max(100).default(10),
});

function assertAdmin(user: { role: string }) {
  if (user.role !== "ADMIN" && user.role !== "CEO") {
    throw new BusinessError(
      ERR.FORBIDDEN,
      "Chỉ quản trị hệ thống và Ban Giám đốc mới quản lý được nguồn tích hợp.",
      403
    );
  }
}

/** Tạo một nguồn tích hợp mới. Khoá bí mật chỉ hiện đúng lần này. */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    assertAdmin(user);
    const body = createSchema.parse(await req.json());

    const exists = await prisma.integrationSource.findUnique({
      where: { code: body.code },
    });
    if (exists) {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        `Đã có nguồn mã "${body.code}".`,
        409
      );
    }

    const secret = generateSecret();
    const source = await prisma.integrationSource.create({
      data: { ...body, secret },
    });

    await writeAudit({
      actor: user,
      action: "INTEGRATION_SOURCE_CREATE",
      entityName: "integration_sources",
      entityId: source.id,
      // Cố tình KHÔNG ghi khoá bí mật vào nhật ký
      after: { code: body.code, name: body.name, kind: body.kind },
      ...clientMeta(req),
    });

    return ok(
      {
        source: { ...source, secret: undefined },
        secret,
        webhookUrl: `${process.env.APP_URL || "http://localhost:3000"}/api/integrations/${source.code}/webhook`,
        warning:
          "Chép khoá bí mật này ngay — hệ thống không hiện lại lần thứ hai. Mất thì tạo khoá mới.",
      },
      201
    );
  });
}

const patchSchema = z.object({
  name: z.string().min(2).max(255).optional(),
  priority: z.number().int().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  /** Tạo khoá mới, huỷ khoá cũ ngay lập tức. */
  rotateSecret: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    assertAdmin(user);

    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
      throw new BusinessError(ERR.VALIDATION_FAILED, "Thiếu id nguồn.", 400);
    }
    const body = patchSchema.parse(await req.json());

    const before = await prisma.integrationSource.findUnique({ where: { id } });
    if (!before) {
      throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy nguồn.", 404);
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.priority !== undefined) data.priority = body.priority;
    if (body.isActive !== undefined) data.isActive = body.isActive;

    let newSecret: string | undefined;
    if (body.rotateSecret) {
      newSecret = generateSecret();
      data.secret = newSecret;
    }

    const source = await prisma.integrationSource.update({
      where: { id },
      data,
    });

    await writeAudit({
      actor: user,
      action: body.rotateSecret
        ? "INTEGRATION_SECRET_ROTATE"
        : "INTEGRATION_SOURCE_UPDATE",
      entityName: "integration_sources",
      entityId: id,
      before: { name: before.name, isActive: before.isActive, priority: before.priority },
      after: {
        name: source.name,
        isActive: source.isActive,
        priority: source.priority,
        doiKhoa: !!body.rotateSecret,
      },
      ...clientMeta(req),
    });

    return ok({
      source: { ...source, secret: undefined },
      ...(newSecret
        ? {
            secret: newSecret,
            warning:
              "Khoá cũ đã hết hiệu lực ngay lập tức. Cập nhật khoá mới cho bên gửi trước khi họ gửi lần tới.",
          }
        : {}),
    });
  });
}
