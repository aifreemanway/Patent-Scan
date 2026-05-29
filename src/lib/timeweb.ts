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

type ChatResponse = {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

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

  const payload: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText },
    ],
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
  };
  // Opus 4.7 rejects `temperature` with a 400 — only send it for non-opus models.
  if (!model.includes("opus")) payload.temperature = temperature;

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
    throw new TimewebError(
      "network",
      isTimeout
        ? `Timeweb timeout after ${timeoutMs}ms`
        : `Timeweb fetch failed: ${e instanceof Error ? e.message : String(e)}`
    );
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    console.error("[timeweb] upstream non-ok", {
      status: resp.status,
      statusText: resp.statusText,
    });
    throw new TimewebError("upstream_http", `Timeweb returned ${resp.status}`, {
      status: resp.status,
    });
  }

  const raw = (await resp.json()) as ChatResponse;
  const text = raw.choices?.[0]?.message?.content ?? "";
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
    input: raw.usage?.prompt_tokens ?? 0,
    output: raw.usage?.completion_tokens ?? 0,
  };

  logCost({ label: opts.label ?? "timeweb", model, usage });

  return { data, text, usage };
}

/** network timeout → 504, everything else → 502. */
export function timewebErrorToStatus(e: TimewebError): number {
  if (e.code === "network" && e.message.includes("timeout")) return 504;
  return 502;
}
