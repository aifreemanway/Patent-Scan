// Unified Gemini caller — routes every Gemini-model request through the Timeweb
// gateway (OpenAI-compatible /chat/completions), with AbortController timeout,
// markdown-fence cleanup, shape validation, and structured error codes.
// Every Gemini-using file in this repo should go through this helper.

import { TIMEWEB_URL, GEMINI_MODEL } from "./config";
import { logCost } from "./cost";
import { streamChatCompletion, LlmStreamError } from "./llm-stream";

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
  /** Gemini "thinking" control via the gateway's OpenAI-compatible `reasoning_effort`
   *  field. VERIFIED on api.timeweb.ai (2026-06-08 probe): "none" drops reasoning
   *  tokens — ~75% of output on extraction tasks — with no quality loss, cutting
   *  ~73% of a call's ₽. (The native nested thinkingConfig / thinking_budget forms
   *  are silently IGNORED by this gateway — only reasoning_effort works.) Omit to
   *  keep the model's default thinking. Use "none" ONLY on calls whose output does
   *  NOT feed retrieval (recall is the beta-blocker — see cofounder guardrail). */
  reasoningEffort?: "none" | "low" | "medium" | "high";
  /** Client-side abort timeout, default 30s */
  timeoutMs?: number;
  /** Caller-supplied ID for correlating logs across a user flow */
  traceId?: string;
  /** Short call-site tag for the `[cost]` telemetry line (e.g. "analyze", "rank"). */
  label?: string;
  /** Optional cost-attribution IDs forwarded to logCost → llm_cost_events
   *  (per-request / per-user views in /admin). Omit on fan-out machinery. */
  requestId?: string | null;
  userId?: string | null;
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
    reasoningEffort,
    timeoutMs = 30_000,
    traceId,
  } = opts;

  // OpenAI-compatible chat payload for the gateway. We STREAM the response (see
  // lib/llm-stream.ts): a non-streamed call is killed by the gateway's ~187s
  // server-side deadline (HTTP 408) on long generations — e.g. a landscape
  // synthesis over ≤150 patents — while a streamed response is not.
  // - `reasoning_effort` (from opts.reasoningEffort) controls Gemini thinking via
  //   the gateway's OpenAI-compatible field — "none" cuts ~73% of a call's ₽ with
  //   no quality loss on extraction. Omitted ⇒ model's default thinking stays on.
  // - `max_tokens` is intentionally omitted so large syntheses don't truncate
  //   (and it's UNSAFE while thinking is on: thinking eats the budget first → the
  //   answer truncates — verified. Only cap output together with reasoning_effort).
  // - `response_format: json_object` IS sent (verified to work with stream on
  //   this gateway): it steers the model to emit a bare, valid JSON object even
  //   on a large/messy synthesis, cutting the "invalid JSON" failures we hit
  //   without it. The fence-strip / brace-slice cleanup below stays as a belt.
  const payload = {
    model: GEMINI_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText },
    ],
    temperature,
    response_format: { type: "json_object" },
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
  };

  // Parse a streamed response into T, or null if it isn't valid JSON. Strips a
  // ```json fence, then falls back to a first-'{' … last-'}' slice.
  const tryParse = (raw: string): T | null => {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      const s = cleaned.indexOf("{");
      const e = cleaned.lastIndexOf("}");
      if (s < 0 || e <= s) return null;
      try {
        return JSON.parse(cleaned.slice(s, e + 1)) as T;
      } catch {
        return null;
      }
    }
  };

  // A streamed response can come back truncated (a transient mid-stream cut by
  // the gateway) → incomplete, unparseable JSON. streamChatCompletion only
  // retries STREAM-level errors (5xx/timeout); a "successful" stream with a bad
  // body slips past it. So retry the whole call on a parse miss (or an empty
  // body): a fresh generation almost always closes the JSON. Stream-level errors
  // are already retried inside streamChatCompletion and surface here terminally.
  const PARSE_ATTEMPTS = 2;
  let text = "";
  let usageRaw: { prompt_tokens: number; completion_tokens: number } = {
    prompt_tokens: 0,
    completion_tokens: 0,
  };
  let data: T | null = null;

  for (let attempt = 1; attempt <= PARSE_ATTEMPTS; attempt++) {
    try {
      const r = await streamChatCompletion({
        url: TIMEWEB_URL,
        apiKey,
        payload,
        idleTimeoutMs: timeoutMs,
      });
      text = r.content;
      usageRaw = r.usage;
    } catch (e) {
      if (e instanceof LlmStreamError) {
        if (e.kind === "http") {
          console.error("[gemini] upstream non-ok", { traceId, status: e.status });
          throw new GeminiError("upstream_http", `Gemini returned ${e.status}`, {
            traceId,
            status: e.status,
          });
        }
        // timeout/network → "network" code; keep "timeout" in the message so
        // geminiErrorToStatus maps an idle-timeout to 504.
        const msg =
          e.kind === "timeout"
            ? `Gemini timeout after ${timeoutMs}ms`
            : `Gemini fetch failed: ${e.message}`;
        console.error("[gemini] network error", {
          label: opts.label,
          timeoutMs,
          isTimeout: e.kind === "timeout",
          traceId,
        });
        throw new GeminiError("network", msg, { traceId });
      }
      throw e;
    }

    const parsed = text.trim() ? tryParse(text) : null;
    if (parsed !== null) {
      data = parsed;
      break;
    }
    console.error("[gemini] unusable response", {
      traceId,
      label: opts.label,
      attempt,
      len: text.length,
      empty: !text.trim(),
      preview: text.slice(0, 200),
    });
    if (attempt < PARSE_ATTEMPTS) continue; // re-stream — likely a truncated body
    throw new GeminiError(
      text.trim() ? "invalid_json" : "empty_response",
      text.trim()
        ? `Gemini returned invalid JSON (len=${text.length})`
        : "Gemini returned empty text",
      { traceId }
    );
  }

  const usage: GeminiUsage = {
    input: usageRaw.prompt_tokens ?? 0,
    output: usageRaw.completion_tokens ?? 0,
    thinking: 0, // gateway doesn't report a separate thinking-token count
  };

  logCost({
    label: opts.label ?? "gemini",
    model: GEMINI_MODEL,
    usage,
    requestId: opts.requestId,
    userId: opts.userId,
  });

  return { data: data as T, text, usage };
}

/**
 * Maps a GeminiError to an appropriate HTTP status for API responses.
 * network (timeout) → 504, upstream_http → 502, invalid_json/empty → 502.
 */
export function geminiErrorToStatus(e: GeminiError): number {
  if (e.code === "network" && e.message.includes("timeout")) return 504;
  return 502;
}
