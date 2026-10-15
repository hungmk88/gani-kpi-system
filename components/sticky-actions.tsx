/**
 * THANH HÀNH ĐỘNG DÍNH ĐÁY — nút chính của biểu mẫu / màn chi tiết luôn trong
 * tầm ngón cái trên điện thoại (nằm ngay trên thanh điều hướng dưới), thay vì
 * phải cuộn hết trang mới thấy nút Lưu. Từ sm trở lên là một hàng nút bình
 * thường cuối khối, căn phải.
 *
 * Đặt các nút theo thứ tự: phụ trước, chính sau (nút chính nằm bên phải /
 * dưới cùng). Phần đệm phía dưới được tự chèn để nội dung cuối trang không
 * bị thanh che.
 */
export default function StickyActions({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <>
      <div className="h-16 sm:hidden" aria-hidden />
      <div
        className={`fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-20 flex gap-2 border-t border-ink-200 bg-white/95 px-4 py-2.5 backdrop-blur sm:static sm:mt-4 sm:justify-end sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none print:hidden [&>*]:flex-1 sm:[&>*]:flex-none ${className}`}
      >
        {children}
      </div>
    </>
  );
}
