// Centralized config for Patent-Scan web app.
// Override via env vars where indicated; other values are tuning knobs that
// require a redeploy on change.

// --- Gemini (routed via the Timeweb gateway — see lib/gemini.ts) ---

/** Gemini model id on the Timeweb gateway. Override via env `GEMINI_MODEL`
 *  (e.g. "gemini/gemini-2.5-pro" or a newer flash) without a code change. */
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini/gemini-2.5-flash";

/** Per-route Gemini timeouts (ms). Must be ≤ route's `maxDuration`. */
export const GEMINI_TIMEOUT_MS = {
  analyze: 90_000,
  questions: 30_000,
  assess: 15_000,
  extract: 30_000,
  plan: 30_000,
  synthesize: 50_000,
  rank: 40_000,
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
  // Both landscape and novelty fan out many search calls per run. Novelty's
  // class-sweep probes ~10 IPC groups × 4 region buckets × several phrasings, so
  // one run reaches ~180 calls; this must clear a single run with headroom.
  // Per-user abuse is metered by the auth quota layer, not this per-IP limit.
  landscapeSearch: 200,
  landscapeSynthesize: 5,
  // Novelty's two-pass ranking makes up to ~6 calls per run (chunk maps +
  // reduce), so this must clear a couple of runs/min per IP.
  priorArtRank: 30,
  // Premium Sonnet judge — expensive + metered by the per-account free credit,
  // so the per-IP limit is just an abuse backstop.
  deepAnalysis: 3,
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
