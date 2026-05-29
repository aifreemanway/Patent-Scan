// Per-call LLM cost telemetry for the Timeweb gateway.
//
// Every LLM call (via lib/gemini.ts or lib/timeweb.ts) emits one structured
// `[cost]` line, so spend can be reconstructed from logs without a DB:
//   pm2 logs patent-scan | grep '\[cost\]'
// One user-facing novelty search fans out across several calls (gate → extract →
// rank ×N → analyze); sum the lines in that window to get the per-search cost.
//
// ANTI-FABRICATION (core project rule): only CONFIRMED prices live here. A model
// with no confirmed Timeweb price logs `rub:null, price:"unconfirmed"` — we log
// the real token counts but never invent a ₽ figure the user might read as real
// billing. Fill a price in only from a verified Timeweb source.

/** RUB per 1,000,000 tokens on the Timeweb gateway. */
type Price = { in: number; out: number };

// Confirmed from the Timeweb price page, 2026-05-29 (gemini-2.5-flash).
// Sonnet 4.6 / Opus 4.7 ₽ prices on Timeweb are NOT yet confirmed → intentionally
// absent (they log rub:null until a verified price is added here).
const PRICING_RUB_PER_M: Record<string, Price> = {
  "gemini/gemini-2.5-flash": { in: 41, out: 338 },
};

export type LlmUsage = { input: number; output: number };

/** ₽ cost for a call, or null if the model has no confirmed Timeweb price. */
export function llmCostRub(model: string, usage: LlmUsage): number | null {
  const p = PRICING_RUB_PER_M[model];
  if (!p) return null;
  return (usage.input * p.in + usage.output * p.out) / 1_000_000;
}

/** Emit one `[cost]` telemetry line. Never throws (telemetry must not break a call). */
export function logCost(opts: {
  label: string;
  model: string;
  usage: LlmUsage;
}): void {
  try {
    const { label, model, usage } = opts;
    const rub = llmCostRub(model, usage);
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
    // Telemetry is best-effort — swallow any serialization error.
  }
}
