import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, ok, requireUser } from "@/lib/api";
import { BusinessError } from "@/lib/rbac";
import { clientMeta, writeAudit } from "@/lib/audit";
import { notify } from "@/lib/telegram";
import { PUBLIC_USER_SELECT } from "@/lib/services/task-service";
import { formatVnDateTime } from "@/lib/vn-time";
import { ERR, TASK_PRIORITIES } from "@/lib/constants";

const schema = z.object({
  title: z.string().min(3).max(255),
  description: z.string().max(5000).optional(),
  targetDeptId: z.string().min(1),
  dueDate: z.string().datetime(),
  priority: z.enum(TASK_PRIORITIES).default("MEDIUM"),
});

/**
 * Đường đi chính thức thay cho việc giao vượt cấp.
 * Trưởng phòng A gửi yêu cầu → trưởng phòng B nhận → B tự phân công người của B.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    if (user.role !== "MANAGER" && user.role !== "CEO") {
      throw new BusinessError(
        ERR.FORBIDDEN,
        "Chỉ trưởng phòng và Ban Giám đốc mới gửi được yêu cầu liên phòng ban.",
        403
      );
    }
    const body = schema.parse(await req.json());

    if (body.targetDeptId === user.departmentId) {
      throw new BusinessError(
        ERR.VALIDATION_FAILED,
        "Đây là phòng ban của chính bạn — hãy giao việc trực tiếp.",
        400
      );
    }

    const dept = await prisma.department.findUnique({
      where: { id: body.targetDeptId },
    });
    if (!dept) {
      throw new BusinessError(ERR.NOT_FOUND, "Không tìm thấy phòng ban.", 404);
    }

    const request = await prisma.crossDeptRequest.create({
      data: {
        title: body.title,
        description: body.description ?? null,
        requesterId: user.id,
        targetDeptId: body.targetDeptId,
        dueDate: new Date(body.dueDate),
        priority: body.priority,
      },
    });

    await writeAudit({
      actor: user,
      action: "CROSS_DEPT_REQUEST_CREATE",
      entityName: "cross_dept_requests",
      entityId: request.id,
      after: { title: body.title, targetDept: dept.name },
      ...clientMeta(req),
    });

    const managers = await prisma.user.findMany({
      where: {
        departmentId: body.targetDeptId,
        role: "MANAGER",
        isActive: true,
      },
      select: { id: true },
    });
    for (const m of managers) {
      await notify({
        userId: m.id,
        title: `Yêu cầu công việc từ phòng ${user.departmentName ?? "khác"}`,
        body: `${user.fullName} nhờ phòng bạn: ${body.title}. Hạn ${formatVnDateTime(body.dueDate)}`,
        level: body.priority === "CRITICAL" ? "CRITICAL" : "WARNING",
        linkUrl: "/requests",
      });
    }

    if (managers.length === 0) {
      // Không có trưởng phòng nào -> báo lại người gửi để họ biết mà xử lý khác
      await notify({
        userId: user.id,
        title: "Phòng ban nhận yêu cầu chưa có trưởng phòng",
        body: `Yêu cầu "${body.title}" đã lưu nhưng phòng ${dept.name} chưa có trưởng phòng để tiếp nhận. Báo Ban Giám đốc phân công.`,
        level: "WARNING",
        linkUrl: "/requests",
      });
    }

    return ok({ request }, 201);
  });
}

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    // Cùng luật với trang /requests: chỉ trưởng phòng và Ban Giám đốc xem
    // hộp thư yêu cầu của PHÒNG. Trước đây nhân viên gọi thẳng API là đọc được
    // mọi yêu cầu gửi tới phòng mình (nội dung nhờ việc giữa hai trưởng
    // phòng). Vai trò khác chỉ thấy yêu cầu do CHÍNH MÌNH gửi (nếu có).
    const where =
      user.role === "CEO"
        ? {}
        : user.role === "MANAGER"
          ? {
              OR: [
                { requesterId: user.id },
                { targetDeptId: user.departmentId ?? "__none__" },
              ],
            }
          : { requesterId: user.id };

    const requests = await prisma.crossDeptRequest.findMany({
      where,
      include: {
        requester: { select: PUBLIC_USER_SELECT },
        targetDept: true,
        approver: { select: PUBLIC_USER_SELECT },
      },
      orderBy: { createdAt: "desc" },
    });
    return ok({ requests });
  });
}
