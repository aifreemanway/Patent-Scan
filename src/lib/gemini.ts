// Unified Gemini caller — routes every Gemini-model request through the Timeweb
// gateway (OpenAI-compatible /chat/completions), with AbortController timeout,
// markdown-fence cleanup, shape validation, and structured error codes.
// Every Gemini-using file in this repo should go through this helper.

import { TIMEWEB_URL, GEMINI_MODEL } from "./config";
import { logCost } from "./cost";

type ChatResponseRaw = {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
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
  /** Accepted for source compatibility but ignored: the OpenAI-compatible gateway
   *  exposes no thinking-budget control (gemini-2.5-flash reasons at its default). */
  thinkingBudget?: number;
  /** Client-side abort timeout, default 30s */
  timeoutMs?: number;
  /** Caller-supplied ID for correlating logs across a user flow */
  traceId?: string;
  /** Short call-site tag for the `[cost]` telemetry line (e.g. "analyze", "rank"). */
  label?: string;
};

/**
 * Call Gemini (via the Timeweb gateway) expecting a JSON response.
 *
 * Behavior:
 * - Sends an `Authorization: Bearer` header (gateway auth; keeps the key out of the URL).
 * - Aborts the request after `timeoutMs`.
 * - Strips a ```json``` fence if the model wraps the response in markdown, then
 *   falls back to a first-'{' … last-'}' slice before giving up.
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
    timeoutMs = 30_000,
    traceId,
  } = opts;

  // OpenAI-compatible chat payload for the gateway.
  // - `thinkingBudget` (in opts) is intentionally NOT sent: the gateway has no
  //   thinking-budget control; gemini-2.5-flash reasons at the gateway default.
  // - `max_tokens` is intentionally omitted: the prior Google-direct calls set no
  //   output cap, and large landscape syntheses (≤150 patents) must not truncate
  //   (verified: the gateway returns finish_reason "stop", not "length", uncapped).
  const payload = {
    model: GEMINI_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText },
    ],
    temperature,
    response_format: { type: "json_object" },
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let resp: Response;
  try {
    resp = await fetch(TIMEWEB_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } catch (e) {
    const isTimeout = e instanceof DOMException && e.name === "AbortError";
    const msg = isTimeout
      ? `Gemini timeout after ${timeoutMs}ms`
      : `Gemini fetch failed: ${e instanceof Error ? e.message : String(e)}`;
    // Log BEFORE throwing — same reason as timeweb.ts: otherwise a Gemini
    // network timeout is silent in pm2 logs and looks like nothing happened.
    console.error("[gemini] network error", {
      label: opts.label,
      timeoutMs,
      isTimeout,
      traceId,
    });
    throw new GeminiError("network", msg, { traceId });
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

  const raw = (await resp.json()) as ChatResponseRaw;

  const text = raw.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) {
    console.error("[gemini] empty response", {
      traceId,
      rawPreview: JSON.stringify(raw).slice(0, 300),
    });
    throw new GeminiError("empty_response", "Gemini returned empty text", {
      traceId,
    });
  }

  // Strip a ```json fence if present; if that still won't parse, fall back to the
  // first '{' … last '}' slice (the gateway's json_object mode can wrap in prose).
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  let data: T;
  try {
    data = JSON.parse(cleaned) as T;
  } catch {
    const s = cleaned.indexOf("{");
    const e = cleaned.lastIndexOf("}");
    const slice = s >= 0 && e > s ? cleaned.slice(s, e + 1) : "";
    try {
      data = JSON.parse(slice) as T;
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
  }

  const usage: GeminiUsage = {
    input: raw.usage?.prompt_tokens ?? 0,
    output: raw.usage?.completion_tokens ?? 0,
    thinking: 0, // gateway doesn't report a separate thinking-token count
  };

  logCost({ label: opts.label ?? "gemini", model: GEMINI_MODEL, usage });

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
