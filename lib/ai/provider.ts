/**
 * TẦNG GỌI AI — Google Gemini.
 *
 * Gọi thẳng REST API thay vì cài SDK: bớt một gói phụ thuộc nặng, và quan trọng
 * hơn là kiểm soát được timeout, số lần thử lại (thử lại ĐÚNG 1 lần khi Gemini
 * báo quá tải 429 hoặc lỗi 5xx), cùng việc ép định dạng JSON.
 *
 * Khoá API gửi qua header `x-goog-api-key`, KHÔNG gắn vào URL — URL hay bị ghi
 * nguyên văn vào log proxy/log lỗi.
 * Chi tiết lỗi từ Gemini chỉ ghi vào log server; trường `error` trả lên tầng
 * trên luôn là câu chung chung, không chứa nội dung phản hồi gốc.
 *
 * Ba tầng chắn (Guardrail) theo đúng tài liệu thiết kế:
 *   Tầng 1 — Làm sạch đầu vào: cắt độ dài, chặn câu lệnh chèn (prompt injection).
 *   Tầng 2 — Ép định dạng: bắt Gemini trả về đúng JSON Schema, rồi Zod kiểm lại.
 *   Tầng 3 — Người quyết định: nằm ở tầng trên (bảng ai_suggestions), không ở đây.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Model mặc định: nhanh, rẻ, tiếng Việt tốt. Đổi được qua .env bằng GEMINI_MODEL.
 *
 * "gemini-2.0-flash" (số gốc ban đầu) đã ngừng hoạt động hẳn — gọi vào trả
 * 404 "no longer available". Kiểm tra lại danh sách model còn dùng được bằng
 * GET https://generativelanguage.googleapis.com/v1beta/models (header
 * x-goog-api-key: <khoá>) nếu
 * sau này model dưới đây cũng bị Google khai tử.
 */
export const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

export function isAiEnabled() {
  return !!process.env.GEMINI_API_KEY;
}

/* ------------------------------------------------------- TẦNG 1: LÀM SẠCH */

/**
 * Những mẫu câu hay được dùng để bẻ lái AI. Gặp thì cắt bỏ chứ không từ chối cả
 * câu — nhân viên gõ vội có thể vô tình trùng, không nên chặn oan.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /\b(bỏ qua|quên|ignore|disregard|forget)\s+(mọi|tất cả|toàn bộ|all|any|previous|prior|các)\s*(chỉ dẫn|hướng dẫn|lệnh|quy tắc|instruction|rule|prompt)/gi,
  /\b(you are now|from now on|act as|pretend to be|bạn giờ là|từ giờ bạn)\b/gi,
  /\b(system prompt|system message|developer message|prompt gốc)\b/gi,
  /<\|.*?\|>/g,
  /\[\/?(INST|SYS|SYSTEM)\]/gi,
  /```[\s\S]*?```/g,
];

/** Ký tự điều khiển và ký tự vô hình — hay được dùng để giấu lệnh trong văn bản. */
// eslint-disable-next-line no-control-regex
const CONTROL_AND_INVISIBLE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028\u2029\uFEFF]/g;

export const MAX_INPUT_CHARS = 2000;

export function sanitizeInput(raw: string): {
  clean: string;
  flagged: string[];
} {
  const flagged: string[] = [];
  let clean = String(raw ?? "").slice(0, MAX_INPUT_CHARS);

  for (const p of INJECTION_PATTERNS) {
    if (p.test(clean)) {
      flagged.push(p.source.slice(0, 40));
      clean = clean.replace(p, " ");
    }
    p.lastIndex = 0;
  }

  // Gộp khoảng trắng thừa, bỏ ký tự điều khiển
  clean = clean
    // eslint-disable-next-line no-control-regex
    .replace(CONTROL_AND_INVISIBLE, " ")
    .replace(/\s{3,}/g, "  ")
    .trim();

  return { clean, flagged };
}

/* --------------------------------------------- TẦNG 2: ÉP ĐỊNH DẠNG JSON */

export type GeminiSchema = Record<string, unknown>;

export type GeminiResult<T> = {
  ok: boolean;
  data: T | null;
  raw: string | null;
  error: string | null;
  latencyMs: number;
  model: string;
};

/**
 * Gọi Gemini và bắt trả về JSON đúng schema.
 * Không ném lỗi ra ngoài — mọi hỏng hóc đều gói vào kết quả để tầng trên
 * quyết định có rơi về bộ đọc luật cứng hay không.
 */
export async function generateJson<T>(opts: {
  systemInstruction: string;
  prompt: string;
  schema: GeminiSchema;
  temperature?: number;
  timeoutMs?: number;
  model?: string;
}): Promise<GeminiResult<T>> {
  const model = opts.model || DEFAULT_MODEL;
  const started = Date.now();
  const apiKey = process.env.GEMINI_API_KEY;

  const fail = (error: string): GeminiResult<T> => ({
    ok: false,
    data: null,
    raw: null,
    error,
    latencyMs: Date.now() - started,
    model,
  });

  if (!apiKey) return fail("Chưa cấu hình GEMINI_API_KEY trong file .env");

  const requestBody = JSON.stringify({
    systemInstruction: {
      parts: [{ text: opts.systemInstruction }],
    },
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      responseMimeType: "application/json",
      responseSchema: opts.schema,
      // Model dòng "thinking" (gemini-3.x) mặc định nghĩ rất lâu trước khi
      // trả JSON — đo thật: 17.5s ở mức nghĩ mặc định, dễ vượt timeout bên
      // dưới. Hạ xuống "low" thì còn ~6s, JSON vẫn đúng schema, lại rẻ hơn
      // vì bớt hẳn thoughtsTokenCount. Việc ở đây chỉ cần trích xuất/tóm tắt
      // có cấu trúc, không cần suy luận nhiều bước.
      thinkingConfig: { thinkingLevel: "low" },
    },
    safetySettings: [
      "HARM_CATEGORY_HARASSMENT",
      "HARM_CATEGORY_HATE_SPEECH",
      "HARM_CATEGORY_SEXUALLY_EXPLICIT",
      "HARM_CATEGORY_DANGEROUS_CONTENT",
    ].map((category) => ({ category, threshold: "BLOCK_ONLY_HIGH" })),
  });

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? 20000
  );

  try {
    const callOnce = () =>
      fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        signal: controller.signal,
        body: requestBody,
      });

    let res = await callOnce();

    // Thử lại đúng 1 lần khi quá tải / lỗi phía Google. Lỗi 4xx khác (sai
    // khoá, sai schema...) thử lại cũng vô ích nên bỏ qua.
    if (res.status === 429 || res.status >= 500) {
      const firstBody = await res.text().catch(() => "");
      console.warn(
        `[AI] Gemini ${model} trả ${res.status}, thử lại 1 lần:`,
        firstBody.slice(0, 500)
      );
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 3000)
          : 1000;
      await new Promise((r) => setTimeout(r, waitMs));
      res = await callOnce();
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `[AI] Gemini ${model} trả lỗi ${res.status}:`,
        body.slice(0, 1000)
      );
      return fail(`Dịch vụ AI tạm thời không phản hồi (mã ${res.status}).`);
    }

    const json = await res.json();
    const text: string | undefined =
      json?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      const reason = json?.candidates?.[0]?.finishReason ?? "không rõ";
      console.warn(`[AI] Gemini ${model} không trả nội dung, finishReason=${reason}`);
      return fail("Dịch vụ AI không trả về nội dung.");
    }

    try {
      return {
        ok: true,
        data: JSON.parse(text) as T,
        raw: text,
        error: null,
        latencyMs: Date.now() - started,
        model,
      };
    } catch {
      console.warn(`[AI] Gemini ${model} trả chuỗi không phải JSON hợp lệ`);
      return {
        ...fail("Dịch vụ AI trả về dữ liệu không hợp lệ."),
        raw: text,
      };
    }
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      console.warn(`[AI] Gemini ${model} quá thời gian chờ, đã huỷ`);
      return fail("Dịch vụ AI phản hồi quá chậm, đã huỷ sau khi chờ hết giờ.");
    }
    console.error(`[AI] Gọi Gemini ${model} thất bại:`, e);
    return fail("Không kết nối được dịch vụ AI.");
  } finally {
    clearTimeout(timer);
  }
}
