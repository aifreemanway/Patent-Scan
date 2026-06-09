// Per-call LLM cost telemetry for the Timeweb gateway.
//
// Every LLM call (via lib/gemini.ts or lib/timeweb.ts) emits one structured
// `[cost]` line AND (best-effort) persists one row to `llm_cost_events`, so
// spend can be reconstructed both from logs and from the /admin cost views:
//   pm2 logs patent-scan | grep '\[cost\]'
// One user-facing novelty search fans out across several calls (gate → extract →
// rank ×N → analyze); sum the lines/rows in that window for the per-search cost.
//
// ANTI-FABRICATION (core project rule): only CONFIRMED prices live here. A model
// with no confirmed Timeweb price logs `rub:null, price:"unconfirmed"` (and
// persists cost_rub=NULL) — we keep the real token counts but never invent a ₽
// figure the user might read as real billing. Fill a price only from a verified
// Timeweb source.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** RUB per 1,000,000 tokens on the Timeweb gateway. */
type Price = { in: number; out: number };

// Confirmed from the Timeweb price page, 2026-05-29 (per-1M-token rates).
// Opus 4.7's ₽ price is not yet confirmed → intentionally absent (logs rub:null
// until a verified price is added here).
const PRICING_RUB_PER_M: Record<string, Price> = {
  "gemini/gemini-2.5-flash": { in: 41, out: 338 },
  "anthropic/claude-sonnet-4-6": { in: 405, out: 2025 },
};

export type LlmUsage = { input: number; output: number };

/** ₽ cost for a call, or null if the model has no confirmed Timeweb price. */
export function llmCostRub(model: string, usage: LlmUsage): number | null {
  const p = PRICING_RUB_PER_M[model];
  if (!p) return null;
  return (usage.input * p.in + usage.output * p.out) / 1_000_000;
}

// ── Best-effort persistence (backs the /admin cost views) ───────────────────
// A dedicated service-role client, lazily created once. We use createClient
// directly (not createSupabaseAdmin) to keep cost.ts free of the next/headers
// import chain — this module is called deep inside the LLM stack. Null when the
// env isn't configured → persistence silently disabled (logs still emit).
let _costClient: SupabaseClient | null | undefined;
function costClient(): SupabaseClient | null {
  if (_costClient !== undefined) return _costClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  _costClient =
    url && key
      ? createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;
  return _costClient;
}

type CostEvent = {
  label: string;
  model: string;
  usage: LlmUsage;
  rub: number | null;
  requestId: string | null;
  userId: string | null;
};

/**
 * Insert one llm_cost_events row. Best-effort and fire-and-forget: a DB outage
 * on the telemetry path must NEVER break the LLM call the user is waiting on, so
 * every error is swallowed. Called un-awaited from logCost.
 */
async function persistCostEvent(e: CostEvent): Promise<void> {
  try {
    const client = costClient();
    if (!client) return;
    await client.from("llm_cost_events").insert({
      request_id: e.requestId,
      user_id: e.userId,
      label: e.label,
      model: e.model,
      tokens_in: e.usage.input,
      tokens_out: e.usage.output,
      cost_rub: e.rub,
    });
  } catch {
    // best-effort — never bubble.
  }
}

/**
 * Emit one `[cost]` telemetry line and best-effort persist it. Never throws
 * (telemetry must not break a call). `requestId`/`userId` are optional: pass
 * them on terminal user-facing calls (analyze verdict, deep, iul, …) for
 * per-request / per-user attribution in /admin; fan-out machinery omits them.
 */
export function logCost(opts: {
  label: string;
  model: string;
  usage: LlmUsage;
  /** search_requests.id — per-request cost attribution (optional). */
  requestId?: string | null;
  /** profiles.id — per-user cost attribution (optional). */
  userId?: string | null;
}): void {
  const { label, model, usage } = opts;
  // llmCostRub is pure arithmetic and never throws — compute before the try so
  // the persisted cost_rub matches the logged one even if serialization fails.
  const rub = llmCostRub(model, usage);
  try {
    console.info(
      "[cost] " +
        JSON.stringify({
          label,
          model,
          in: usage.input,
          out: usage.output,
          rub: rub === null ? null : Math.round(rub * 10000) / 10000,
          ...(rub === null ? { price: "unconfirmed" } : {}),
        })
    );
  } catch {
    // Telemetry log is best-effort — swallow any serialization error.
  }
  // Persist for /admin (separate from the log; un-awaited so it never adds
  // latency to the call). persistCostEvent swallows its own errors.
  void persistCostEvent({
    label,
    model,
    usage,
    rub,
    requestId: opts.requestId ?? null,
    userId: opts.userId ?? null,
  });
}
