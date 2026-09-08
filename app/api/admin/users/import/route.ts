import { handle, ok, requireUser } from "@/lib/api";
import { assertPermission, BusinessError } from "@/lib/rbac";
import { clientMeta } from "@/lib/audit";
import { importUsersFromFile } from "@/lib/services/user-import-service";
import { ERR } from "@/lib/constants";

export const runtime = "nodejs";

/**
 * Nạp danh sách nhân sự từ file Excel.
 *
 * Sai một dòng là từ chối cả file — lý do nằm trong `user-import-service.ts`.
 * Trả về 422 kèm danh sách lỗi từng dòng để người quản trị sửa rồi nạp lại.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    assertPermission(user, "admin.users");

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new BusinessError(ERR.VALIDATION_FAILED, "Chưa chọn file Excel.", 400);
    }

    const result = await importUsersFromFile(
      user,
      await file.arrayBuffer(),
      clientMeta(req)
    );

    if (!result.accepted) {
      return ok(
        {
          ...result,
          message: `File bị từ chối vì có ${result.errors.length} chỗ sai. Không tài khoản nào được tạo.`,
        },
        422
      );
    }

    return ok({
      ...result,
      message: `Đã tạo ${result.created} tài khoản. Tất cả đều phải tự đổi mật khẩu ở lần đăng nhập đầu tiên.`,
    });
  });
}
