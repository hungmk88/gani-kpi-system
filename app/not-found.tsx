import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="max-w-sm text-center">
        <div className="mb-2 text-5xl font-bold text-brand-600">404</div>
        <h1 className="mb-1 text-lg font-bold text-ink-900">Không tìm thấy trang</h1>
        <p className="mb-5 text-sm text-ink-500">
          Đường dẫn không tồn tại hoặc bạn không có quyền xem nội dung này.
        </p>
        <Link href="/dashboard" className="btn-primary">
          Về bảng điều hành
        </Link>
      </div>
    </main>
  );
}
