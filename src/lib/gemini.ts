// Unified Gemini generateContent caller with AbortController timeout,
// markdown-fence cleanup, shape validation, and structured error codes.
// Every Gemini-using file in this repo should go through this helper.

import { GEMINI_URL } from "./config";

type GeminiResponseRaw = {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
    };
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
};

export type GeminiUsage = {
  input: number;
  output: number;
  thinking: number;
};

export type GeminiJsonResult<T> = {
  data: T;
  text: string;
  usage: GeminiUsage;
};

export type GeminiErrorCode =
  | "network"
  | "upstream_http"
  | "empty_response"
  | "invalid_json";

export class GeminiError extends Error {
  readonly code: GeminiErrorCode;
  readonly traceId?: string;
  readonly status?: number;
  constructor(
    code: GeminiErrorCode,
    message: string,
    opts?: { traceId?: string; status?: number }
  ) {
    super(message);
    this.name = "GeminiError";
    this.code = code;
    this.traceId = opts?.traceId;
    this.status = opts?.status;
  }
}

export type CallGeminiJsonOptions = {
  apiKey: string;
  systemPrompt: string;
  userText: string;
  /** 0.0–1.0, default 0.3 */
  temperature?: number;
  /** thinking tokens budget, default 512 */
  thinkingBudget?: number;
  /** Client-side abort timeout, default 30s */
  timeoutMs?: number;
  /** Caller-supplied ID for correlating logs across a user flow */
  traceId?: string;
};

/**
 * Call Gemini `generateContent` expecting JSON response.
 *
 * Behavior:
 * - Sends x-goog-api-key header (never URL query — keeps secrets out of logs/Referer).
 * - Aborts the request after `timeoutMs`.
 * - Strips ```json``` fence if Gemini wraps the response in markdown.
 * - Parses JSON with try/catch; throws `GeminiError("invalid_json")` on bad shape.
 * - Distinguishes network timeout vs HTTP error vs empty response vs bad JSON
 *   via `GeminiError.code`, so callers can surface 504 vs 502 vs 500 correctly.
 * - Logs only status/preview in errors — never user payload (prevents PII leak).
 * - Returns `usage` in tokens for future billing accounting.
 */
export async function callGeminiJson<T>(
  opts: CallGeminiJsonOptions
): Promise<GeminiJsonResult<T>> {
  const {
    apiKey,
    systemPrompt,
    userText,
    temperature = 0.3,
    thinkingBudget = 512,
    timeoutMs = 30_000,
    traceId,
  } = opts;

  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget },
    },
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let resp: Response;
  try {
    resp = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } catch (e) {
    const isTimeout = e instanceof DOMException && e.name === "AbortError";
    throw new GeminiError(
      "network",
      isTimeout
        ? `Gemini timeout after ${timeoutMs}ms`
        : `Gemini fetch failed: ${e instanceof Error ? e.message : String(e)}`,
      { traceId }
    );
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    console.error("[gemini] upstream non-ok", {
      traceId,
      status: resp.status,
      statusText: resp.statusText,
    });
    throw new GeminiError("upstream_http", `Gemini returned ${resp.status}`, {
      traceId,
      status: resp.status,
    });
  }

  const raw = (await resp.json()) as GeminiResponseRaw;

  const text = raw.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text.trim()) {
    console.error("[gemini] empty response", {
      traceId,
      rawPreview: JSON.stringify(raw).slice(0, 300),
    });
    throw new GeminiError("empty_response", "Gemini returned empty text", {
      traceId,
    });
  }

  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");

  let data: T;
  try {
    data = JSON.parse(cleaned) as T;
  } catch {
    console.error("[gemini] invalid JSON", {
      traceId,
      cleanedPreview: cleaned.slice(0, 200),
    });
    throw new GeminiError(
      "invalid_json",
      `Gemini returned invalid JSON (len=${cleaned.length})`,
      { traceId }
    );
  }

  const usage: GeminiUsage = {
    input: raw.usageMetadata?.promptTokenCount ?? 0,
    output: raw.usageMetadata?.candidatesTokenCount ?? 0,
    thinking: raw.usageMetadata?.thoughtsTokenCount ?? 0,
  };

  return { data, text, usage };
}

/**
 * Maps a GeminiError to an appropriate HTTP status for API responses.
 * network (timeout) → 504, upstream_http → 502, invalid_json/empty → 502.
 */
export function geminiErrorToStatus(e: GeminiError): number {
  if (e.code === "network" && e.message.includes("timeout")) return 504;
  return 502;
}
