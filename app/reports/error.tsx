"use client";

import { startTransition, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";

/**
 * Lỗi trong trang báo cáo (/reports/* nằm ngoài nhóm (app) nên không có khung
 * menu). Hiện thông báo dễ hiểu + nút thử lại + đường về hệ thống; chi tiết kỹ
 * thuật chỉ nằm trong log server (mã digest để đối chiếu).
 *
 * Thử lại = router.refresh() (lấy lại dữ liệu từ server component) + reset()
 * (dựng lại cây con) — chỉ reset() thì lỗi phát sinh khi tải dữ liệu sẽ lặp lại.
 */
export default function ReportsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-start justify-center bg-ink-50 px-4">
      <div className="card mx-auto mt-16 w-full max-w-lg p-6 text-center">
        <div className="mb-3 flex justify-center text-amber-600">
          <TriangleAlert size={32} strokeWidth={1.75} />
        </div>
        <h1 className="mb-1 text-lg font-bold text-ink-900">Báo cáo đang gặp lỗi</h1>
        <p className="mb-4 text-sm text-ink-500">
          Thử tải lại. Nếu vẫn lỗi, báo quản trị hệ thống
          {error.digest ? ` kèm mã ${error.digest}` : ""}.
        </p>
        <div className="flex justify-center gap-2">
          <button
            className="btn-primary"
            onClick={() =>
              startTransition(() => {
                router.refresh();
                reset();
              })
            }
          >
            Thử lại
          </button>
          <Link href="/dashboard" className="btn-ghost">
            Về trang chủ
          </Link>
        </div>
      </div>
    </main>
  );
}
