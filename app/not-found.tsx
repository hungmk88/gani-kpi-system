import Link from "next/link";
import Image from "next/image";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="card w-full max-w-sm p-8 text-center">
        <Image
          src="/logo-mark.png"
          alt="GANI FOODY"
          width={48}
          height={48}
          className="mx-auto mb-4"
        />
        <div className="mb-1 text-sm font-medium text-ink-500 tabular-nums">Lỗi 404</div>
        <h1 className="mb-1 text-lg font-bold text-ink-900">Không tìm thấy trang</h1>
        <p className="mb-5 text-sm text-ink-500">
          Đường dẫn không tồn tại hoặc bạn không có quyền xem nội dung này.
        </p>
        <Link href="/dashboard" className="btn-primary">
          Về trang chủ
        </Link>
      </div>
    </main>
  );
}
