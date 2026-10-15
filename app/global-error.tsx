"use client";

/** Lỗi ở tầng ngoài cùng (layout gốc) — phải tự dựng <html>, không dùng CSS của app. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="vi">
      <body style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "4rem 1rem" }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Hệ thống đang gặp lỗi</h1>
        <p style={{ color: "#555", marginBottom: 16 }}>Vui lòng thử lại sau ít phút.</p>
        <button onClick={reset} style={{ padding: "8px 16px", cursor: "pointer" }}>
          Thử lại
        </button>
      </body>
    </html>
  );
}
