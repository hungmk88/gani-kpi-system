"use client";

/**
 * Lỗi ở tầng ngoài cùng (layout gốc) — phải tự dựng <html>, không dùng CSS của
 * app. Màu viết tay theo hệ thiết kế GANI: chữ ink-900/ink-500, nút brand-600.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="vi">
      <body
        style={{
          fontFamily: '"Be Vietnam Pro", "Segoe UI", system-ui, sans-serif',
          textAlign: "center",
          padding: "4rem 1rem",
          background: "#f7f7f4",
          color: "#22231f",
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
          Hệ thống đang gặp lỗi
        </h1>
        <p style={{ color: "#66665c", marginBottom: 16, fontSize: 14 }}>
          Vui lòng thử lại sau ít phút.
        </p>
        <button
          onClick={reset}
          style={{
            minHeight: 40,
            padding: "8px 16px",
            cursor: "pointer",
            border: 0,
            borderRadius: 6,
            background: "#176ca3",
            color: "#fff",
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          Thử lại
        </button>
      </body>
    </html>
  );
}
