import { handle, ok, requireUser } from "@/lib/api";
import { assertPermission } from "@/lib/rbac";
import { clientMeta } from "@/lib/audit";
import { importUsersFromFile } from "@/lib/services/user-import-service";
import { assertImportFile, assertImportRequestSize } from "@/lib/excel";

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

    assertImportRequestSize(req);
    const form = await req.formData();
    // Không có file / file rỗng / quá 5 MB → báo lỗi rõ; quá 5000 dòng chặn
    // trong bộ đọc file.
    const file = assertImportFile(form.get("file"));

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
