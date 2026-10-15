"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ImportResult = {
  accepted: boolean;
  totalRows: number;
  created: number;
  errors: string[];
  createdUsers: { email: string; fullName: string; role: string }[];
  message?: string;
};

/**
 * Nạp nhân sự hàng loạt.
 *
 * Điểm khác biệt so với phần nạp số KPI: ở đây sai một dòng là hỏng cả file, nên
 * giao diện phải liệt kê ĐỦ các dòng sai để người quản trị sửa một lượt, chứ
 * không rút gọn kiểu "và 12 lỗi khác".
 */
export default function UserImport() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/users/import", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as ImportResult & {
        message?: string;
      };
      // Lỗi từ server (file quá lớn, sai định dạng, hết phiên...) không có
      // danh sách dòng — hiện thông báo thay vì vẽ bảng kết quả rỗng rồi vỡ.
      if (!res.ok) {
        setError(data.message ?? "Nạp file thất bại.");
        return;
      }
      setResult(data);
      if (data.accepted) router.refresh();
    } catch {
      setError("Không gửi được file lên máy chủ.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="card mb-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-ink-800">
            Nạp nhân sự hàng loạt từ Excel
          </div>
          <p className="mt-0.5 text-xs text-ink-500">
            Dùng khi thêm nhiều người một lúc. Sai một dòng là cả file bị từ chối,
            không ai được tạo — để không rơi vào cảnh nạp nửa chừng.
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/api/admin/users/template" className="btn btn-sm">
            Tải file mẫu
          </a>
          <button
            className="btn-primary btn-sm"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? "Đang nạp…" : "Chọn file để nạp"}
          </button>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={onUpload}
      />

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {result && result.accepted && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <div className="text-sm font-medium text-emerald-800">
            Đã tạo {result.created} tài khoản.
          </div>
          <p className="mt-1 text-xs text-emerald-700">
            Tất cả đều bị bắt tự đổi mật khẩu ở lần đăng nhập đầu tiên — mật khẩu
            tạm trong file coi như ai cũng biết.
          </p>
          <ul className="mt-2 space-y-0.5 text-xs text-emerald-800">
            {result.createdUsers.map((u) => (
              <li key={u.email}>
                · {u.fullName} — {u.email}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result && !result.accepted && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
          <div className="text-sm font-medium text-red-800">
            File bị từ chối — {result.errors.length} chỗ sai, chưa tài khoản nào
            được tạo.
          </div>
          <ul className="mt-2 max-h-64 space-y-0.5 overflow-y-auto text-xs text-red-700">
            {result.errors.map((e, i) => (
              <li key={i}>· {e}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-red-700">
            Sửa đúng những dòng trên trong file rồi nạp lại.
          </p>
        </div>
      )}
    </div>
  );
}
