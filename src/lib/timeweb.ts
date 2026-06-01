// Timeweb LLM gateway caller (OpenAI-compatible /chat/completions). Used by the
// premium Deep Analysis judge (Sonnet), distinct from lib/gemini.ts (the standard
// free-tier judge). Mirrors gemini.ts's structured-error + JSON contract.
//
// Gateway gotchas (verified on api.timeweb.ai):
//  - Opus models REJECT a `temperature` field → 400. We omit it for opus.
//  - `response_format: json_object` is unreliable here, so we always defensively
//    extract the first '{' … last '}' substring before JSON.parse, rather than
//    trusting clean JSON.

import { TIMEWEB_URL } from "./config";
import { logCost } from "./cost";
import { streamChatCompletion, LlmStreamError } from "./llm-stream";

export type TimewebModel =
  | "anthropic/claude-sonnet-4-6"
  | "anthropic/claude-opus-4-7"
  | "openai/gpt-4o";

export type TimewebErrorCode =
  | "network"
  | "upstream_http"
  | "empty_response"
  | "invalid_json";

export class TimewebError extends Error {
  readonly code: TimewebErrorCode;
  readonly status?: number;
  constructor(code: TimewebErrorCode, message: string, opts?: { status?: number }) {
    super(message);
    this.name = "TimewebError";
    this.code = code;
    this.status = opts?.status;
  }
}

export type TimewebUsage = { input: number; output: number };
export type TimewebJsonResult<T> = { data: T; text: string; usage: TimewebUsage };

/**
 * Call the Timeweb gateway expecting a JSON object back. `temperature` is
 * silently dropped for opus models (they 400 on it). Throws `TimewebError`
 * with a `.code` so callers can map to 504 (timeout) vs 502 (other).
 */
export async function callTimewebJson<T>(opts: {
  apiKey: string;
  model: TimewebModel;
  systemPrompt: string;
  userText: string;
  /** 0.0–1.0; ignored for opus models. Default 0.3. */
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Short call-site tag for the `[cost]` telemetry line. */
  label?: string;
}): Promise<TimewebJsonResult<T>> {
  const {
    apiKey,
    model,
    systemPrompt,
    userText,
    temperature = 0.3,
    maxTokens = 8192,
    timeoutMs = 120_000,
  } = opts;

  // NOTE: we STREAM the response (see lib/llm-stream.ts). A non-streamed call to
  // this gateway is killed by a ~187s server-side deadline (HTTP 408) on long
  // Sonnet generations; streaming is not subject to it. `response_format:
  // json_object` is intentionally omitted in streaming mode — the model wraps
  // the object in a ```json fence / prose, which the brace-slice below extracts.
  const payload: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText },
    ],
    max_tokens: maxTokens,
  };
  // Opus 4.7 rejects `temperature` with a 400 — only send it for non-opus models.
  if (!model.includes("opus")) payload.temperature = temperature;

  let text: string;
  let usageRaw: { prompt_tokens: number; completion_tokens: number };
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
        console.error("[timeweb] upstream non-ok", { status: e.status });
        throw new TimewebError("upstream_http", `Timeweb returned ${e.status}`, {
          status: e.status,
        });
      }
      // timeout/network → "network" code; keep "timeout" in the message so
      // timewebErrorToStatus maps an idle-timeout to 504.
      const msg =
        e.kind === "timeout"
          ? `Timeweb timeout after ${timeoutMs}ms`
          : `Timeweb fetch failed: ${e.message}`;
      console.error("[timeweb] network error", {
        model,
        timeoutMs,
        isTimeout: e.kind === "timeout",
      });
      throw new TimewebError("network", msg);
    }
    throw e;
  }

  if (!text.trim()) {
    console.error("[timeweb] empty response");
    throw new TimewebError("empty_response", "Timeweb returned empty content");
  }

  // Defensive JSON extraction — json_object is unreliable on this gateway, so the
  // model may wrap the object in prose or a markdown fence.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const slice = start >= 0 && end > start ? text.slice(start, end + 1) : text.trim();

  let data: T;
  try {
    data = JSON.parse(slice) as T;
  } catch {
    console.error("[timeweb] invalid JSON", { len: slice.length });
    throw new TimewebError(
      "invalid_json",
      `Timeweb returned invalid JSON (len=${slice.length})`
    );
  }

  const usage: TimewebUsage = {
    input: usageRaw.prompt_tokens ?? 0,
    output: usageRaw.completion_tokens ?? 0,
  };

  logCost({ label: opts.label ?? "timeweb", model, usage });

  return { data, text, usage };
}

/** network timeout → 504, everything else → 502. */
export function timewebErrorToStatus(e: TimewebError): number {
  if (e.code === "network" && e.message.includes("timeout")) return 504;
  return 502;
}
