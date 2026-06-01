// Shared SSE reader for the Timeweb OpenAI-compatible /chat/completions gateway.
//
// WHY STREAMING (verified 2026-06-01): a NON-streamed request to this gateway is
// killed by a ~187s hard server-side deadline — it returns HTTP 408 "The request
// took too long" when a long generation (Deep Analysis over 60 patents → 8k+
// output tokens) exceeds it. The SAME 60-patent payload that 408'd non-streamed
// completed in 112s with `stream:true`: a streamed response is delivered
// token-by-token and is NOT subject to that deadline. Both callTimewebJson
// (Sonnet) and callGeminiJson (Gemini) route through this, so the whole product
// suite (novelty / landscape / deep / literature-review) is freed from the 408.
//
// IDLE timeout, not total wall-clock: we abort only if NO chunk arrives for
// `idleTimeoutMs` (covers a hung connection or a slow time-to-first-token). A
// long-but-progressing generation never trips it, so each caller's existing
// timeout keeps working as the idle budget without needing to be widened for
// every long call. Between-token gaps are sub-second; only TTFT is sizable, so
// the budget is floored well above any realistic first-token latency.

export type LlmStreamErrorKind = "http" | "timeout" | "network";

export class LlmStreamError extends Error {
  readonly kind: LlmStreamErrorKind;
  readonly status?: number;
  constructor(
    kind: LlmStreamErrorKind,
    message: string,
    opts?: { status?: number }
  ) {
    super(message);
    this.name = "LlmStreamError";
    this.kind = kind;
    this.status = opts?.status;
  }
}

export type StreamUsage = { prompt_tokens: number; completion_tokens: number };
export type StreamResult = { content: string; usage: StreamUsage };

type StreamDelta = {
  choices?: { delta?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

// Never abort before the first token: a thinking model on a large prompt can
// take tens of seconds to emit. 60s is comfortably above observed TTFT and far
// below the gateway's own 187s cut, so it never false-fires mid-stream.
const MIN_IDLE_MS = 60_000;

/**
 * POST a chat-completion as an SSE stream and accumulate the assistant content.
 * Adds `stream:true` + `stream_options.include_usage` (verified supported — the
 * gateway emits a final usage chunk). Throws `LlmStreamError` with a `.kind` so
 * callers can map gateway HTTP errors vs idle-timeout vs network to their own
 * error types.
 */
async function streamOnce(opts: {
  url: string;
  apiKey: string;
  /** Payload WITHOUT stream fields — `stream`/`stream_options` are added here. */
  payload: Record<string, unknown>;
  /** Abort if no chunk arrives within this many ms (floored at 60s). */
  idleTimeoutMs: number;
}): Promise<StreamResult> {
  const { url, apiKey, payload, idleTimeoutMs } = opts;
  const idleMs = Math.max(idleTimeoutMs, MIN_IDLE_MS);

  const body = JSON.stringify({
    ...payload,
    stream: true,
    stream_options: { include_usage: true },
  });

  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => ctrl.abort(), idleMs);
  };
  arm();

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body,
      signal: ctrl.signal,
    });
  } catch (e) {
    if (timer) clearTimeout(timer);
    const isAbort = e instanceof DOMException && e.name === "AbortError";
    if (isAbort) {
      throw new LlmStreamError(
        "timeout",
        `stream timeout — no response within ${idleMs}ms`
      );
    }
    throw new LlmStreamError(
      "network",
      `stream fetch failed: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  if (!resp.ok) {
    if (timer) clearTimeout(timer);
    await resp.text().catch(() => ""); // drain so the connection is freed
    throw new LlmStreamError("http", `gateway returned ${resp.status}`, {
      status: resp.status,
    });
  }
  if (!resp.body) {
    if (timer) clearTimeout(timer);
    throw new LlmStreamError("network", "gateway returned no stream body");
  }

  arm(); // fresh idle budget for time-to-first-token

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const usage: StreamUsage = { prompt_tokens: 0, completion_tokens: 0 };

  // Parse one SSE line. Returns true on the terminating `data: [DONE]`.
  const handleLine = (line: string): boolean => {
    const t = line.trim();
    if (!t.startsWith("data:")) return false;
    const data = t.slice(5).trim();
    if (data === "[DONE]") return true;
    try {
      const obj = JSON.parse(data) as StreamDelta;
      const delta = obj.choices?.[0]?.delta?.content;
      if (delta) content += delta;
      if (obj.usage) {
        usage.prompt_tokens = obj.usage.prompt_tokens ?? usage.prompt_tokens;
        usage.completion_tokens =
          obj.usage.completion_tokens ?? usage.completion_tokens;
      }
    } catch {
      // Keep-alive comment or a frame split across reads — the buffer re-joins
      // partial frames on the next chunk, so silently skip unparseable lines.
    }
    return false;
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      arm(); // chunk arrived → reset idle timer
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      let stop = false;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (handleLine(line)) {
          stop = true;
          break;
        }
      }
      if (stop) break;
    }
    // Flush any multibyte tail held by the decoder, then the last bufferless
    // line (a stream may end without a trailing newline). Important for Cyrillic
    // content split across the final chunk boundary.
    buffer += decoder.decode();
    if (buffer.trim()) handleLine(buffer);
  } catch (e) {
    const isAbort = e instanceof DOMException && e.name === "AbortError";
    if (isAbort) {
      throw new LlmStreamError(
        "timeout",
        `stream stalled — no chunk within ${idleMs}ms`
      );
    }
    throw new LlmStreamError(
      "network",
      `stream read failed: ${e instanceof Error ? e.message : String(e)}`
    );
  } finally {
    if (timer) clearTimeout(timer);
    try {
      reader.releaseLock();
    } catch {
      // reader may already be released on abort — ignore.
    }
  }

  if (!content.trim()) {
    throw new LlmStreamError("network", "gateway stream produced empty content");
  }

  return { content, usage };
}

// Transient gateway failures worth a retry: server-side 5xx, rate-limit/timeout
// status codes, and our own idle-timeout / network breaks. The Timeweb gateway
// was observed flapping (408 deadline, 500, stalls) under load — a single blip
// otherwise surfaces to the user as "Analysis service error" on a one-shot call
// (novelty analyze / landscape synthesize have no outer retry). NOT retried:
// other 4xx (400/401/403 — bad payload / auth — a retry can't fix those).
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
function isRetryable(e: LlmStreamError): boolean {
  if (e.kind === "timeout" || e.kind === "network") return true;
  if (e.kind === "http" && e.status != null && RETRYABLE_STATUS.has(e.status)) {
    return true;
  }
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Stream a chat-completion with bounded retry on transient gateway failures.
 * Each attempt re-POSTs from scratch (partial content is discarded and
 * re-accumulated). The happy path is unchanged — attempt 1 succeeds, no delay.
 * Non-retryable errors (4xx auth/payload) throw immediately.
 */
export async function streamChatCompletion(opts: {
  url: string;
  apiKey: string;
  /** Payload WITHOUT stream fields — `stream`/`stream_options` are added here. */
  payload: Record<string, unknown>;
  /** Abort if no chunk arrives within this many ms (floored at 60s). */
  idleTimeoutMs: number;
  /** Total attempts incl. the first (default 3 → up to 2 retries). */
  maxAttempts?: number;
}): Promise<StreamResult> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await streamOnce(opts);
    } catch (e) {
      lastErr = e;
      const retryable = e instanceof LlmStreamError && isRetryable(e);
      if (!retryable || attempt >= maxAttempts) throw e;
      const backoff = Math.min(800 * 2 ** (attempt - 1), 4000); // 800, 1600, …
      const le = e as LlmStreamError;
      console.error(
        `[llm-stream] retryable ${le.kind}${le.status ? " " + le.status : ""} — attempt ${attempt}/${maxAttempts}, backoff ${backoff}ms`
      );
      await sleep(backoff);
    }
  }
  throw lastErr;
}
