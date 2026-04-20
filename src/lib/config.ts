// Centralized config for Patent-Scan web app.
// Override via env vars where indicated; other values are tuning knobs that
// require a redeploy on change.

// --- Gemini ---

/** Gemini generateContent endpoint. Override via env `GEMINI_URL` (e.g. to switch model). */
export const GEMINI_URL =
  process.env.GEMINI_URL ??
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

/** Per-route Gemini timeouts (ms). Must be ≤ route's `maxDuration`. */
export const GEMINI_TIMEOUT_MS = {
  analyze: 90_000,
  questions: 30_000,
  assess: 15_000,
  extract: 30_000,
  plan: 30_000,
  synthesize: 50_000,
} as const;

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
export const MAX_PATENTS_ANALYZE = 30;
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
  landscapeSearch: 20,
  landscapeSynthesize: 5,
} as const;

// --- Per-user quotas (month, by tier) ---
//
// Must stay in sync with `public.increment_usage()` function in
// supabase/migrations/0001_auth_and_quotas.sql. If you change numbers here,
// update the migration (and run it) too. This constant is for reference only;
// enforcement happens in Postgres for atomicity.

export const QUOTA_LIMITS = {
  free: {
    search: 3,
    landscape: 3,
    analyze: 3,
    questions: Infinity, // cheap, unquota'd
  },
  pro: {
    search: 500,
    landscape: 100,
    analyze: 500,
    questions: Infinity,
  },
  enterprise: {
    search: Infinity,
    landscape: Infinity,
    analyze: Infinity,
    questions: Infinity,
  },
} as const;
