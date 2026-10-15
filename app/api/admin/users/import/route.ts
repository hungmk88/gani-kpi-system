import { handle, ok, requireUser } from "@/lib/api";
import { assertPermission } from "@/lib/rbac";
import { clientMeta } from "@/lib/audit";
import { importUsersFromFile } from "@/lib/services/user-import-service";
import { assertImportFile, assertImportRequestSize } from "@/lib/excel";
import { fmtNum } from "@/lib/format";

export const runtime = "nodejs";

/**
 * Nạp danh sách nhân sự từ file Excel — hai bước trên cùng một route:
 *
 *  - `mode=preview` (mặc định): đọc + kiểm từng dòng, KHÔNG ghi gì. Luôn trả
 *    200 kèm bảng từng dòng (dòng sai có cột và lý do) để màn hình vẽ bảng.
 *  - `mode=commit` + `expectedValid`: kiểm lại từ đầu rồi tạo các dòng hợp
 *    lệ. Không tạo được ai thì 422 kèm lý do và bảng dòng như bước xem trước.
 *
 * Mặc định là xem trước: client cũ / gọi nhầm không tạo tài khoản ngoài ý muốn.
 * Lý do chi tiết nằm trong `user-import-service.ts`.
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
    const dryRun = form.get("mode") !== "commit";
    const expectedRaw = form.get("expectedValid");
    const expectedValid =
      typeof expectedRaw === "string" && /^\d+$/.test(expectedRaw)
        ? Number(expectedRaw)
        : null;

    const result = await importUsersFromFile(
      user,
      await file.arrayBuffer(),
      clientMeta(req),
      { dryRun, expectedValid }
    );

    if (dryRun) {
      return ok({
        ...result,
        message:
          result.fileErrors.length > 0
            ? result.fileErrors.join(" ")
            : `${fmtNum(result.validCount)} dòng hợp lệ · ${fmtNum(result.errorCount)} dòng lỗi${
                result.existingCount > 0
                  ? ` · ${fmtNum(result.existingCount)} dòng đã có tài khoản (bỏ qua)`
                  : ""
              }. Chưa tạo tài khoản nào.`,
      });
    }

    if (!result.accepted) {
      const message =
        result.rejectReason === "preview_mismatch"
          ? `File hoặc dữ liệu đã thay đổi từ lúc xem trước (giờ có ${fmtNum(result.validCount)} dòng hợp lệ, lúc xem trước là ${fmtNum(expectedValid)}). Chưa tạo ai — xem lại bảng bên dưới rồi bấm nhập lần nữa.`
          : result.rejectReason === "no_valid_rows"
            ? "Không có dòng hợp lệ nào để nhập. Sửa các dòng lỗi trong file rồi nạp lại."
            : result.fileErrors.join(" ") || "File không đọc được.";
      return ok({ ...result, message }, 422);
    }

    const skipped = result.errorCount + result.existingCount;
    return ok({
      ...result,
      message: `Đã tạo ${fmtNum(result.created)} tài khoản${
        skipped > 0 ? `, bỏ qua ${fmtNum(skipped)} dòng` : ""
      }. Tất cả đều phải tự đổi mật khẩu ở lần đăng nhập đầu tiên.`,
    });
  });
}
