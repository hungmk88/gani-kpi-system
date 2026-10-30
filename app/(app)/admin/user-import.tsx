"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Download, FileSpreadsheet } from "lucide-react";
import { ShowingCount } from "@/components/ui";
import { toast } from "@/components/toast";
import { fmtNum } from "@/lib/format";
import { fetchJson } from "@/lib/fetch-json";
import { ROLE_LABEL } from "@/lib/constants";
import { PRODUCTION_ROLE_LABEL } from "@/lib/production/constants";

type RowIssue = { column: string | null; message: string };
type PreviewRow = {
  rowNumber: number;
  fullName: string;
  email: string;
  role: string;
  departmentCode: string;
  departmentName: string | null;
  jobTitle: string | null;
  productionRole: string | null;
  employeeCode: string | null;
  status: "ok" | "error" | "exists";
  issues: RowIssue[];
};
type ImportResult = {
  dryRun: boolean;
  accepted: boolean;
  totalRows: number;
  validCount: number;
  errorCount: number;
  existingCount: number;
  fileErrors: string[];
  rows: PreviewRow[];
  created: number;
  createdUsers: { email: string; fullName: string; role: string }[];
  message?: string;
};

/** Tên cột trong file mẫu → nhãn dễ đọc (vẫn giữ mã cột để dò trong Excel) */
const COLUMN_LABEL: Record<string, string> = {
  HO_TEN: "Họ tên",
  EMAIL: "Email",
  MAT_KHAU_TAM: "Mật khẩu tạm",
  VAI_TRO: "Vai trò",
  MA_PHONG_BAN: "Mã phòng ban",
  VAI_TRO_XUONG: "Vai trò xưởng",
};

/** Bảng xem trước vẽ tối đa chừng này dòng — file 5.000 dòng không làm treo trang */
const MAX_RENDERED = 300;

/**
 * Nạp nhân sự hàng loạt — hai bước: chọn file là XEM TRƯỚC (chưa tạo ai),
 * bấm "Nhập N dòng" mới tạo.
 *
 * Màn xem trước phải liệt kê ĐỦ các dòng sai kèm cột và lý do, để người quản
 * trị sửa một lượt — không rút gọn kiểu "và 12 lỗi khác", không báo chung
 * chung "Lỗi".
 */
export default function UserImport() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(true);

  async function send(f: File, mode: "preview" | "commit", expectedValid?: number) {
    const fd = new FormData();
    fd.append("file", f);
    fd.append("mode", mode);
    if (expectedValid !== undefined) fd.append("expectedValid", String(expectedValid));
    // fetchJson: file quá lớn (413 từ nền tảng, body là HTML) hay hết thời gian
    // (504) ra thông báo tiếng Việt rõ ràng thay vì "Không đọc được file."
    const r = await fetchJson<Partial<ImportResult> & { message?: string }>(
      "/api/admin/users/import",
      { method: "POST", body: fd }
    );
    return { res: r, data: r.data };
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!f) return;

    setBusy("preview");
    setError(null);
    setPreview(null);
    setDone(null);
    setFile(f);
    try {
      const { res, data } = await send(f, "preview");
      // Lỗi từ server (file quá lớn, sai định dạng, hết phiên...) không có
      // danh sách dòng — hiện thông báo thay vì vẽ bảng kết quả rỗng rồi vỡ.
      if (!res.ok || !Array.isArray(data.rows)) {
        setError(res.message ?? "Không đọc được file.");
        setFile(null);
        return;
      }
      setPreview(data as ImportResult);
      setOnlyProblems((data.errorCount ?? 0) + (data.existingCount ?? 0) > 0);
    } catch {
      setError("Không gửi được file lên máy chủ.");
      setFile(null);
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (!file || !preview) return;
    setBusy("commit");
    setError(null);
    try {
      const { res, data } = await send(file, "commit", preview.validCount);
      if (!res.ok) {
        setError(res.message ?? "Nhập thất bại. Chưa tài khoản nào được tạo.");
        // Bảng dòng mới nhất (vd có người vừa được tạo tay) thay cho bảng cũ
        if (Array.isArray(data.rows)) setPreview({ ...(data as ImportResult), dryRun: true });
        return;
      }
      const result = data as ImportResult;
      setDone(result);
      setPreview(null);
      setFile(null);
      toast(`Đã tạo ${fmtNum(result.created)} tài khoản.`);
      router.refresh();
    } catch {
      setError("Không gửi được file lên máy chủ.");
    } finally {
      setBusy(null);
    }
  }

  function reset() {
    setPreview(null);
    setFile(null);
    setError(null);
  }

  const problems = preview?.rows.filter((r) => r.status !== "ok") ?? [];
  const listed = preview ? (onlyProblems ? problems : preview.rows) : [];
  const canCommit =
    !!preview && preview.fileErrors.length === 0 && preview.validCount > 0 && !busy;

  return (
    <div className="card mb-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-ink-800">
            Nạp nhân sự hàng loạt từ Excel
          </div>
          <p className="mt-0.5 text-xs text-ink-500">
            Chọn file là xem trước — chưa tạo ai. Dòng sai được tô đỏ kèm lý do;
            chỉ khi bấm “Nhập” thì các dòng hợp lệ mới được tạo.
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/api/admin/users/template" className="btn-ghost btn-sm">
            <Download size={16} aria-hidden /> Tải file mẫu
          </a>
          <button
            className={preview ? "btn-ghost btn-sm" : "btn-primary btn-sm"}
            disabled={!!busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy === "preview"
              ? "Đang đọc file…"
              : preview
                ? "Chọn file khác"
                : "Chọn file để xem trước"}
          </button>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={onPick}
      />

      {error && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {preview && (
        <div className="mt-4">
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-1.5 text-ink-700">
              <FileSpreadsheet size={16} aria-hidden className="text-ink-500" />
              {file?.name}
            </span>
            <span className="font-medium text-leaf-700 tabular-nums">
              {fmtNum(preview.validCount)} dòng hợp lệ
            </span>
            <span
              className={`tabular-nums ${
                preview.errorCount > 0 ? "font-medium text-red-700" : "text-ink-500"
              }`}
            >
              · {fmtNum(preview.errorCount)} dòng lỗi
            </span>
            {preview.existingCount > 0 && (
              <span className="text-ink-500 tabular-nums">
                · {fmtNum(preview.existingCount)} dòng đã có tài khoản (bỏ qua)
              </span>
            )}
          </div>

          {preview.fileErrors.length > 0 && (
            <div
              role="alert"
              className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {preview.fileErrors.join(" ")}
            </div>
          )}

          {preview.rows.length > 0 && (
            <>
              <div className="mb-2 flex gap-4 border-b border-ink-200 text-sm">
                {[
                  { on: true, label: `Cần xem (${fmtNum(problems.length)})` },
                  { on: false, label: `Tất cả (${fmtNum(preview.rows.length)})` },
                ].map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    aria-pressed={onlyProblems === t.on}
                    onClick={() => setOnlyProblems(t.on)}
                    className={`-mb-px border-b-2 px-1 py-1.5 font-medium ${
                      onlyProblems === t.on
                        ? "border-brand-600 text-brand-700"
                        : "border-transparent text-ink-500 hover:text-ink-800"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {listed.length === 0 ? (
                <p className="py-3 text-sm text-ink-500">
                  Không có dòng nào sai hay bị bỏ qua — cả{" "}
                  {fmtNum(preview.validCount)} dòng sẽ được tạo.
                </p>
              ) : (
                <div className="table-wrap max-h-[28rem] overflow-y-auto">
                  <table className="tbl tbl-stack">
                    <thead>
                      <tr>
                        <th className="w-16 text-right">Dòng</th>
                        <th>Họ tên · email</th>
                        <th>Vai trò</th>
                        <th>Phòng ban</th>
                        <th>Kết quả kiểm tra</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listed.slice(0, MAX_RENDERED).map((r) => (
                        <tr
                          key={r.rowNumber}
                          className={r.status === "error" ? "bg-red-50/60" : undefined}
                        >
                          <td className="text-right text-xs text-ink-500 tabular-nums">
                            {r.rowNumber}
                          </td>
                          <td data-label="Họ tên · email">
                            <div className="font-medium text-ink-800">
                              {r.fullName || "—"}
                              {r.employeeCode && (
                                <span className="ml-1.5 font-mono text-xs font-normal text-ink-500">
                                  {r.employeeCode}
                                </span>
                              )}
                            </div>
                            <div className="text-xs break-all text-ink-500">
                              {r.email || "—"}
                            </div>
                          </td>
                          <td data-label="Vai trò" className="text-xs text-ink-700">
                            {ROLE_LABEL[r.role] ?? (r.role || "—")}
                            {r.productionRole && (
                              <div className="text-ink-500">
                                Xưởng:{" "}
                                {PRODUCTION_ROLE_LABEL[r.productionRole] ?? r.productionRole}
                              </div>
                            )}
                          </td>
                          <td data-label="Phòng ban" className="text-xs text-ink-700">
                            {r.departmentName ?? (r.departmentCode || "—")}
                          </td>
                          <td data-label="Kết quả">
                            {r.status === "ok" ? (
                              <span className="inline-flex items-center gap-1 text-xs text-leaf-700">
                                <CircleCheck size={14} aria-hidden /> Sẽ được tạo
                              </span>
                            ) : (
                              <ul
                                className={`space-y-0.5 text-xs ${
                                  r.status === "error" ? "text-red-700" : "text-ink-500"
                                }`}
                              >
                                {r.issues.map((i, k) => (
                                  <li key={k}>
                                    {i.column && (
                                      <b className="font-medium" title={i.column}>
                                        {COLUMN_LABEL[i.column] ?? i.column}:{" "}
                                      </b>
                                    )}
                                    {i.message}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <ShowingCount
                shown={Math.min(listed.length, MAX_RENDERED)}
                total={listed.length}
                hint="sửa trong file rồi xem trước lại để thấy các dòng còn lại"
              />
            </>
          )}

          {preview.errorCount > 0 && preview.validCount > 0 && (
            <p className="mt-2 text-xs text-ink-500">
              {fmtNum(preview.errorCount)} dòng lỗi sẽ bị bỏ qua. Sửa trong file
              rồi nạp lại cả file — người đã tạo lần này sẽ tự được bỏ qua.
            </p>
          )}

          {/* Nút đặt NGAY dưới bảng, không dùng StickyActions: form "Thêm tài
              khoản" bên dưới cũng có thanh dính đáy — hai thanh fixed chồng lên
              nhau trên điện thoại, bấm nhầm "Tạo tài khoản" thay vì "Nhập". */}
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn-ghost" onClick={reset} disabled={!!busy}>
              Huỷ
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!canCommit}
              onClick={commit}
            >
              {busy === "commit"
                ? "Đang tạo tài khoản…"
                : preview.validCount > 0
                  ? `Nhập ${fmtNum(preview.validCount)} dòng`
                  : "Không có dòng hợp lệ"}
            </button>
          </div>
        </div>
      )}

      {done && (
        <div role="status" className="mt-3 rounded-md bg-ink-50 p-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-leaf-700">
            <CircleCheck size={16} strokeWidth={2} aria-hidden />
            {done.message ?? `Đã tạo ${fmtNum(done.created)} tài khoản.`}
          </div>
          <p className="mt-1 text-xs text-ink-600">
            Mật khẩu tạm trong file coi như ai cũng biết — người mới bị bắt tự đổi
            ở lần đăng nhập đầu tiên.
          </p>
          <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto text-xs text-ink-700">
            {done.createdUsers.map((u) => (
              <li key={u.email}>
                · {u.fullName} — {u.email}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
