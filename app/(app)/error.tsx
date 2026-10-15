"use client";

import { startTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";

/**
 * Lỗi trong một trang của hệ thống: giữ nguyên khung (menu, thanh trên), chỉ
 * thay phần nội dung bằng thông báo dễ hiểu + nút thử lại. Chi tiết kỹ thuật
 * không hiện cho người dùng — đã nằm trong log server (mã digest để đối chiếu).
 *
 * Thử lại = router.refresh() (lấy lại dữ liệu từ server component) + reset()
 * (dựng lại cây con) — chỉ reset() thì lỗi phát sinh khi tải dữ liệu sẽ lặp lại.
 */
export default function AppError({
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
    <div className="card mx-auto mt-10 max-w-lg p-6 text-center">
      <div className="mb-3 flex justify-center text-amber-600">
        <TriangleAlert size={32} strokeWidth={1.75} />
      </div>
      <h1 className="mb-1 text-lg font-bold text-ink-900">Trang này đang gặp lỗi</h1>
      <p className="mb-4 text-sm text-ink-500">
        Thử tải lại. Nếu vẫn lỗi, báo quản trị hệ thống
        {error.digest ? ` kèm mã ${error.digest}` : ""}.
      </p>
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
    </div>
  );
}
