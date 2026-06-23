// Centralized config for Patent-Scan web app.
// Override via env vars where indicated; other values are tuning knobs that
// require a redeploy on change.

// --- Feature flags (compile-time, BILLING_LIVE pattern) ---

/** Expert Field-View / retrieval-v2 master switch.
 *  When ON, the search flow uses the v2 retrieval (novelty-retrieval-v2) and the
 *  report stores the full classified pool (`_field`) so the report page can offer
 *  the two-mode Verdict/Field expert view. When OFF, the flow stays on v1 and the
 *  report is verdict-only (current prod behaviour). Kept FALSE on prod until the
 *  recall-v2 hold is lifted; flip to true on the recall-v2-hold branch for QA.
 *  Read from the client bundle (the retrieval call runs in the browser), so the
 *  override MUST be a NEXT_PUBLIC_ var — it's inlined at build/dev start. Default
 *  OFF: prod (main) never sets it. QA enables WITHOUT touching code via
 *    $env:NEXT_PUBLIC_RETRIEVAL_V2_ENABLED=1; npm run dev   (PowerShell)
 *  See [[project_recall_pivot_expert_field_view]]. */
export const RETRIEVAL_V2_ENABLED =
  process.env.NEXT_PUBLIC_RETRIEVAL_V2_ENABLED === "1";

// --- Gemini (routed via the Timeweb gateway — see lib/gemini.ts) ---

/** Gemini model id on the Timeweb gateway. Override via env `GEMINI_MODEL`
 *  (e.g. "gemini/gemini-2.5-pro" or a newer flash) without a code change. */
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini/gemini-2.5-flash";

// Per-route gateway timeouts (ms). These are now IDLE timeouts, not total
// wall-clock: every call streams (lib/llm-stream.ts), so the value bounds the
// max SILENCE between chunks — a streaming response resets it on every chunk.
// Generous values are therefore safe: they only cover slow time-to-first-token
// and ride out transient gateway stalls. `synthesize` (≤150-patent landscape)
// gets the most headroom — a 60s budget tripped it during a gateway stall.
// Keep each ≤ its route's `maxDuration`.
export const GEMINI_TIMEOUT_MS = {
  analyze: 90_000,
  questions: 30_000,
  assess: 15_000,
  extract: 30_000,
  plan: 30_000,
  facet: 30_000,
  synthesize: 120_000,
  rank: 60_000,
} as const;

// --- Timeweb LLM gateway (Deep Analysis) ---

/** Timeweb OpenAI-compatible chat-completions endpoint. Override via `TIMEWEB_URL`. */
export const TIMEWEB_URL =
  process.env.TIMEWEB_URL ?? "https://api.timeweb.ai/v1/chat/completions";

/** Deep Analysis judge model (premium, transactional). Routed via Timeweb gateway. */
export const DEEP_ANALYSIS_MODEL = "anthropic/claude-sonnet-4-6";

/** Literature-review synthesis model. Opus 4.7 (1M context) over Sonnet 4.6
 *  because the synth stage feeds 80+ sources and is expected to produce ≥4
 *  structured tables; Sonnet hit Timeweb's 408 ceiling repeatedly on this
 *  workload (POC #2-3). Opus is ~3-5x dearer per token but the bill stays
 *  under ₽110/report — see [[project_pricing_lit_review_pilot_target]]. */
export const LIT_REVIEW_SYNTH_MODEL = "anthropic/claude-opus-4-7";

/** Deep Analysis is a long claim-by-claim + cross-check pass.
 *  120s was too tight (verified: Sonnet via Timeweb on ~60 patents repeatedly
 *  overran, killed by the AbortController, refund + 504). Bumped to 300s so the
 *  hard ceiling matches a generous real-world tail. Nginx proxy_read_timeout
 *  MUST stay > this (currently 310s in deploy/nginx/patent-scan.conf). */
export const DEEP_ANALYSIS_TIMEOUT_MS = 300_000;

// --- Rospatent PatSearch ---

/** PatSearch endpoint. Override via env `PATSEARCH_URL`. */
export const PATSEARCH_URL =
  process.env.PATSEARCH_URL ??
  "https://searchplatform.rospatent.gov.ru/patsearch/v0.2/search";

/** Timeout for PatSearch calls. Includes network + their internal latency. */
export const PATSEARCH_TIMEOUT_MS = 30_000;

/** Abstract char cap per context. Synthesize is tighter to fit 150 patents in Gemini prompt. */
export const PATSEARCH_ABSTRACT_LIMIT = {
  search: 600,
  landscape: 400,
} as const;

/** Datasets grouped for bilingual search (see search-rospatent/route.ts). */
export const PATSEARCH_DATASETS_RU = ["ru_since_1994", "ru_till_1994", "cis"] as const;
export const PATSEARCH_DATASETS_EN = ["us", "ep", "jp", "cn"] as const;
export const PATSEARCH_DATASETS_ALL: readonly string[] = [
  ...PATSEARCH_DATASETS_RU,
  ...PATSEARCH_DATASETS_EN,
];
export const PATSEARCH_DATASETS_ALLOWED = new Set<string>(PATSEARCH_DATASETS_ALL);

// --- Tavily (web search) ---

export const TAVILY_URL = "https://api.tavily.com/search";
export const TAVILY_TIMEOUT_MS = 30_000;

// --- Input limits (user-facing validation) ---

/** Generic long-form description limit. Analyze/questions/landscape-plan/synthesize/search-rospatent. */
export const MAX_DESCRIPTION_LEN = 50_000;
/** Short processed-query limit for landscape/search (qn is already compressed by Gemini). */
export const MAX_QN_LEN = 10_000;
/** Web-search short query (Tavily) — no reason to accept a long description here. */
export const MAX_WEB_QUERY_LEN = 2_000;

/** Clarifying answers array size and per-answer char cap. */
export const MAX_ANSWERS = 20;
export const MAX_ANSWER_LEN = 5_000;

/** Patents passed into Gemini prompts — tuned to token budget. */
// Raised from 30: novelty now retrieves a wide multi-query union (landscape
// parity), so analyze needs a deeper window to see region-balanced prior-art.
export const MAX_PATENTS_ANALYZE = 60;
export const MAX_PATENTS_SYNTHESIZE = 150;

// --- Rate limit ---

/** Window for all IP-based rate limits (1 min). Paid tier will move to per-user quotas. */
export const RATE_WINDOW_MS = 60_000;

/** Per-route max requests per window. Tune by cost-to-serve. */
export const RATE_MAX = {
  analyze: 5,
  questions: 20,
  searchRospatent: 5,
  searchWeb: 5,
  gate: 30,
  landscapePlan: 5,
  // Decompose a verbose invention into atomic facet queries (one LLM call) — the
  // facet stage of full-depth novelty retrieval. Same backstop rationale as plan.
  facetDecompose: 5,
  // Both landscape and novelty fan out many search calls per run. Novelty's
  // class-sweep probes ~10 IPC groups × 4 region buckets × several phrasings, so
  // a lite run reaches ~180 calls. Full-depth retrieval (v2) adds facet queries
  // (~10 facets) plus offset-pagination of high-value subclasses (depth 90–150),
  // pushing a single run to ~400 calls; this ceiling must clear one full run with
  // headroom. Per-user abuse is metered by the auth quota layer, not this per-IP
  // limit — so a generous backstop is safe.
  landscapeSearch: 500,
  landscapeSynthesize: 5,
  // Novelty's two-pass ranking makes up to ~6 calls per run (chunk maps +
  // reduce), so this must clear a couple of runs/min per IP.
  priorArtRank: 30,
  // Premium Sonnet judge — expensive + metered by the per-account free credit,
  // so the per-IP limit is just an abuse backstop.
  deepAnalysis: 3,
  // RU legal-status badges: one report/landscape load batches all RU numbers in
  // a single POST, so the per-IP ceiling is per-load, not per-patent. Generous
  // because the work is free (ФИПС HTML) and cached 14d server-side.
  legalStatus: 60,
} as const;

// --- Auth / anti-abuse ---

/** Turnstile siteverify endpoint. Override only for testing. */
export const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Per-IP signup/login throttle — 3 magic-link requests per 24h from one IP. */
export const SIGNUP_IP_LIMIT = {
  windowMs: 24 * 60 * 60 * 1000,
  max: 3,
} as const;

// --- Per-user quotas (month, by tier) ---
//
// Reference only — enforcement is in Postgres `quota_limit()` /
// `increment_usage()` (supabase/migrations/0002_subscription_tiers.sql) for
// atomicity. Keep these numbers in sync with that migration.
//
// Semantics: `search` = one user-facing novelty search (charged once at
// /api/analyze, NOT per internal fan-out call); `landscape` = one landscape
// build (charged at /api/landscape/synthesize). `questions` is unquota'd.
// Deep Analysis is a separate transactional counter, not part of these tiers.

export const QUOTA_LIMITS = {
  free: { search: 3, landscape: 3, questions: Infinity },
  starter: { search: 20, landscape: 10, questions: Infinity },
  team: { search: 60, landscape: 30, questions: Infinity },
  enterprise: { search: Infinity, landscape: Infinity, questions: Infinity },
} as const;

// --- Per-user daily LLM spend budget (СЛОЙ-2, ₽/day, MSK) ---
//
// An anti-ABUSE ceiling, NOT a quota. Operational quota (QUOTA_LIMITS) charges
// per user-facing search/landscape; but the unquota'd LLM routes (questions /
// gate / facet-decompose / prior-art-rank / landscape-plan / search-rospatent /
// industrial-usage) can be looped per-user without touching quota, burning ₽.
// lib/spend-guard.ts `perUserSpendGuard` trips a per-user 503 once a user's
// confirmed LLM spend today (MSK) exceeds their tier's budget. The global
// breaker (#115, env LLM_DAILY_BUDGET_RUB) stays as the aggregate backstop.
//
// Reference: per-product LLM COGS ≈ Поиск ₽17 / Deep ₽13 / Скрининг ₽10 /
// Ландшафт ₽6 — so even free's 200₽/day is ~12 searches' worth, generous for
// real use and only bites loop-abuse. Values are start points (Vsevolod
// 2026-06-23); make tunable from /admin/costs later. enterprise = no per-user
// cap (Infinity) — trusted accounts; the global breaker still covers aggregate.
// Tiers mirror the DB profiles_tier_check set (free/starter/team/enterprise);
// team_plus is mapped ahead of its billing rollout so it is never capped at free.
export const LLM_DAILY_BUDGET_RUB_BY_TIER: Record<string, number> = {
  free: 200,
  starter: 600,
  team: 1500,
  team_plus: 3000,
  enterprise: Infinity,
};

/**
 * Resolve a tier string to its daily per-user ₽ budget. Unknown / missing tier
 * → the most conservative (free) budget: an anti-abuse default that never leaves
 * a user uncapped because their tier string didn't match a known key.
 */
export function dailyBudgetRubForTier(tier: string | null | undefined): number {
  if (tier && Object.prototype.hasOwnProperty.call(LLM_DAILY_BUDGET_RUB_BY_TIER, tier)) {
    return LLM_DAILY_BUDGET_RUB_BY_TIER[tier];
  }
  return LLM_DAILY_BUDGET_RUB_BY_TIER.free;
}
