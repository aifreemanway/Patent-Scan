// Shared types for the literature-review pipeline (worker side) and the
// intake API route. Kept in one file so both contexts stay in sync.

export type LitReviewIndustry =
  | "metallurgy"
  | "chemistry"
  | "mechanical"
  | "energy"
  | "biotech"
  | "electronics"
  | "agriculture"
  | "other";

export type LitReviewRegion =
  | "RU"
  | "CIS"
  | "CN"
  | "US"
  | "EU"
  | "UK"
  | "JP_KR"
  | "AU_NZ"
  | "LATAM"
  | "ME"
  | "AF"
  | "WORLD";

/** Stored in search_requests.params for type='literature_review'. */
export type LitReviewParams = {
  topic: string;
  industry: LitReviewIndustry;
  regions: LitReviewRegion[];
  periodFrom: number;
  periodTo: number;
  hypotheses?: string;
  /** Storage object keys, not signed URLs (worker re-signs as needed). */
  attachments?: string[];
};

/**
 * How much of the source we could actually read.
 * - `open`          — full text reachable (patent page, OA paper, web page, wiki).
 * - `abstract_only` — only an abstract/annotation was available (paywalled paper).
 * - `unknown`       — no reliable access signal; do NOT claim full text.
 * NORD feedback: closed sources were cited from the abstract — mark it honestly.
 */
export type LitReviewAccessLevel = "open" | "abstract_only" | "unknown";

export type LitReviewSource = {
  /** Numeric reference index in the final report's §5 source list. */
  ref: number;
  title: string;
  url: string;
  /** ISO date when the URL was last reachable; null = archived/broken. */
  reachedAt: string | null;
  /** Access depth we actually had to the source (anti-fab: unknown ≠ full text). */
  accessLevel: LitReviewAccessLevel;
  /** Origin so a reader knows the provenance (PatSearch / Crossref / web / wiki). */
  provenance:
    | "patsearch"
    | "crossref"
    | "openalex"
    | "tavily"
    | "wikipedia"
    | "user_attachment"
    // PR-3.6 source-augmentation resolvers (Tab.1 cell enrichment):
    | "wikipedia_infobox"   // deterministic infobox parse
    | "corp_site"            // company /about LLM narrow-extraction
    | "industry_news"        // whitelist (bloomberg/reuters/argus/iea/irena)
    | "sec_edgar"            // sec.gov filings
    | "hkex";                // hkexnews.hk filings
};

export type LitReviewPatentHit = {
  id: string;
  title: string;
  year: string;
  country: string;
  abstract?: string;
  url: string;
  accessLevel?: LitReviewAccessLevel;
};

export type LitReviewScholarHit = {
  doi?: string;
  title: string;
  authors: string[];
  year: number | null;
  venue?: string;
  url: string;
  abstract?: string;
  accessLevel?: LitReviewAccessLevel;
};

export type LitReviewWebHit = {
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
  accessLevel?: LitReviewAccessLevel;
};

export type LitReviewHarvest = {
  patents: LitReviewPatentHit[];
  scholar: LitReviewScholarHit[];
  web: LitReviewWebHit[];
  /** Wikipedia articles relevant to the topic, deduplicated by URL. */
  wiki: LitReviewWebHit[];
};

/** Final structured report produced by Stages 3–8, fed to markdown.ts. */
export type LitReviewReport = {
  title: string;
  scope: string;
  overview: string;
  /** §1 — 6-10 typed categories with sources. */
  classification: Array<{ name: string; description: string; sourceRefs: number[] }>;
  /** §2 — comparative tables; each is a 2D body keyed by row label. */
  comparativeTables: Array<{
    title: string;
    columns: string[];
    rows: Array<{ label: string; cells: string[]; sourceRefs: number[] }>;
  }>;
  /** §3 — technology types with pros/cons. */
  technologies: Array<{
    name: string;
    description: string;
    pros: string[];
    cons: string[];
    sourceRefs: number[];
  }>;
  /** §4 — 5-7 strategic conclusions, each with source backing. */
  conclusions: Array<{ text: string; sourceRefs: number[] }>;
  /** §5 — flat numbered source list. */
  sources: LitReviewSource[];
  /** §6 — caveats / honest limits. */
  caveats: string[];
};

export const STAGE_LABELS: Record<number, string> = {
  1: "Уточняем поисковые запросы",
  2: "Собираем публикации и патенты",
  3: "Извлекаем сущности",
  4: "Заполняем сравнительные таблицы",
  5: "Классифицируем технологии",
  6: "Формулируем выводы",
  7: "Проверяем источники",
  8: "Готовим раздел оговорок",
  9: "Собираем отчёт",
};
