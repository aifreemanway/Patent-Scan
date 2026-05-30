// Data harvesters for the literature-review pipeline (Stage 2). Each function
// is independent and returns its own normalised shape, so the worker can fan
// them out in parallel and merge.
//
// Anti-fabrication: every hit MUST carry a real source URL — if a harvester
// can't produce one, it skips the record. The synthesis stages later cite by
// reference number, so a fabricated source cannot leak into the report.
//
// Coverage trade-off for PR-3 v1: PatSearch + Crossref + Tavily + Wikipedia.
// OpenAlex + Semantic Scholar are deferred to PR-3.5 — POC will tell us if
// the current sources are enough for the Sb₂O3 case.

import { PATSEARCH_URL, TAVILY_URL } from "@/lib/config";
import type {
  LitReviewPatentHit,
  LitReviewScholarHit,
  LitReviewWebHit,
  LitReviewRegion,
} from "./types";

// ── Region → PatSearch datasets mapping ────────────────────────
// Split by language for bilingual neural-search: RU queries → ru_*/cis, EN
// queries → us/ep/cn/jp. PatSearch's qn field is language-aware; mixing breaks
// recall (see novelty search-rospatent for the working pattern).
const REGION_DATASETS_RU: Record<LitReviewRegion, string[]> = {
  RU: ["ru_since_1994", "ru_till_1994"],
  CIS: ["cis"],
  US: [],
  EU: [],
  UK: [],
  CN: [],
  JP_KR: [],
  AU_NZ: [],
  LATAM: [],
  ME: [],
  AF: [],
  WORLD: ["ru_since_1994", "ru_till_1994", "cis"],
};

const REGION_DATASETS_EN: Record<LitReviewRegion, string[]> = {
  RU: [],
  CIS: [],
  US: ["us"],
  EU: ["ep"],
  UK: [],
  CN: ["cn"],
  JP_KR: ["jp"],
  AU_NZ: [],
  LATAM: [],
  ME: [],
  AF: [],
  WORLD: ["us", "ep", "cn", "jp"],
};

export function patsearchDatasetsRuForRegions(regions: LitReviewRegion[]): string[] {
  const set = new Set<string>();
  for (const r of regions) for (const ds of REGION_DATASETS_RU[r] ?? []) set.add(ds);
  return Array.from(set);
}

export function patsearchDatasetsEnForRegions(regions: LitReviewRegion[]): string[] {
  const set = new Set<string>();
  for (const r of regions) for (const ds of REGION_DATASETS_EN[r] ?? []) set.add(ds);
  return Array.from(set);
}

// ── PatSearch (Rospatent) ─────────────────────────────────────
// Real response shape (verified via direct probe, not docs):
//   { total, available, hits: [ { id, common: {...}, snippet: {...} } ] }
// NOT ElasticSearch-style {hits:{hits:[]}}. The PR-3 v1 parser used the wrong
// path and silently returned [] on every call — that's the patents=0 bug.
type PatSearchSnippet = {
  title?: string | { ru?: string; en?: string };
  description?: string | { ru?: string; en?: string };
  lang?: string;
};
type PatSearchCommon = {
  publishing_office?: string;
  document_number?: string;
  publication_date?: string;
};
type PatSearchDoc = {
  id?: string;
  common?: PatSearchCommon;
  snippet?: PatSearchSnippet;
};

type PatSearchResponse = {
  hits?: PatSearchDoc[];
  total?: number;
};

function pickLang(v: PatSearchSnippet["title"]): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  return v.ru || v.en || "";
}

function ipcSubclasses(codes: string[]): string[] {
  const out: string[] = [];
  for (const c of codes) {
    const head = c.trim().split(/[/\s]/, 1)[0];
    if (head && !out.includes(head)) out.push(head);
  }
  return out;
}

export async function harvestPatSearch(opts: {
  token: string;
  query: string;
  datasets: string[];
  limit?: number;
  ipcCodes?: string[];
}): Promise<LitReviewPatentHit[]> {
  if (!opts.token || opts.datasets.length === 0 || !opts.query.trim()) return [];

  // Drop date filter: PatSearch's publication_date index is sparse — the prior
  // implementation returned 0 hits across all 6 queries on the Sb₂O₃ POC.
  // novelty/search-rospatent doesn't filter by date either; the period bound
  // is a soft preference baked into the topic/queries, not a hard cutoff.
  const subclasses = opts.ipcCodes && opts.ipcCodes.length > 0 ? ipcSubclasses(opts.ipcCodes) : [];
  const filter = subclasses.length > 0
    ? { "classification.ipc_subclass": { values: subclasses } }
    : undefined;

  const body: Record<string, unknown> = {
    qn: opts.query,
    limit: Math.min(opts.limit ?? 25, 50),
    offset: 0,
    datasets: opts.datasets,
    include_facets: false,
  };
  if (filter) body.filter = filter;

  try {
    const resp = await fetch(PATSEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.token}`,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const bodyText = await resp.text().catch(() => "");
      console.error("[litreview/patsearch] non-ok", {
        status: resp.status,
        body: bodyText.slice(0, 300),
        qn: opts.query.slice(0, 100),
      });
      return [];
    }
    const data = (await resp.json()) as PatSearchResponse;
    const hits = Array.isArray(data.hits) ? data.hits : [];
    console.log("[litreview/patsearch] ok", {
      qn: opts.query.slice(0, 60),
      datasets: opts.datasets.join(","),
      total: data.total ?? 0,
      hits: hits.length,
    });
    return hits.flatMap((d) => {
      const id = d.id ?? d.common?.document_number;
      if (!id) return [];
      const country = d.common?.publishing_office ?? "";
      const title = pickLang(d.snippet?.title);
      // publication_date format: "YYYY.MM.DD" (note dots, not dashes)
      const year = (d.common?.publication_date ?? "").slice(0, 4);
      return [{
        id,
        title,
        year,
        country,
        abstract: pickLang(d.snippet?.description) || undefined,
        url: `https://searchplatform.rospatent.gov.ru/patent/${encodeURIComponent(id)}`,
      }];
    });
  } catch (e) {
    console.error("[litreview/patsearch] error", {
      message: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

// ── Crossref (scholarly literature) ───────────────────────────
// Public API, no key required. Generous rate limit if you set a polite UA.
type CrossrefItem = {
  DOI?: string;
  title?: string[];
  author?: Array<{ given?: string; family?: string }>;
  issued?: { "date-parts"?: number[][] };
  "container-title"?: string[];
  URL?: string;
  abstract?: string;
};

// Crossref scores by keyword match — single-term queries pull in noise (e.g.
// "share" matches stock-market papers when the topic is "antimony market share").
// `requireTerms` enforces a post-filter: keep only hits whose title or abstract
// contains at least one of the supplied topical terms (case-insensitive). The
// caller passes in the topic's core keywords; the filter drops irrelevant hits
// before they reach the synthesis stage.
function matchesAnyTerm(text: string, terms: string[]): boolean {
  if (!terms.length) return true;
  const lower = text.toLowerCase();
  return terms.some((t) => t.length >= 3 && lower.includes(t.toLowerCase()));
}

export async function harvestCrossref(opts: {
  query: string;
  rows?: number;
  periodFrom: number;
  periodTo: number;
  requireTerms?: string[];
}): Promise<LitReviewScholarHit[]> {
  const params = new URLSearchParams({
    query: opts.query,
    rows: String(opts.rows ?? 15),
    "filter": `from-pub-date:${opts.periodFrom},until-pub-date:${opts.periodTo}`,
    "select": "DOI,title,author,issued,container-title,URL,abstract",
  });
  const url = `https://api.crossref.org/works?${params}`;

  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Patent-Scan/1.0 (mailto:support@patent-scan.com)",
      },
    });
    if (!resp.ok) {
      console.error("[litreview/crossref] non-ok", { status: resp.status });
      return [];
    }
    const data = (await resp.json()) as { message?: { items?: CrossrefItem[] } };
    const items = data.message?.items ?? [];
    const terms = opts.requireTerms ?? [];
    return items.flatMap((it) => {
      const title = it.title?.[0]?.trim();
      const url = it.URL || (it.DOI ? `https://doi.org/${it.DOI}` : undefined);
      if (!title || !url) return [];
      if (terms.length && !matchesAnyTerm(`${title} ${it.abstract ?? ""}`, terms)) {
        return [];
      }
      const year = it.issued?.["date-parts"]?.[0]?.[0] ?? null;
      const authors = (it.author ?? [])
        .map((a) => [a.given, a.family].filter(Boolean).join(" "))
        .filter(Boolean);
      return [{
        doi: it.DOI,
        title,
        authors,
        year,
        venue: it["container-title"]?.[0],
        url,
        abstract: it.abstract,
      }];
    });
  } catch (e) {
    console.error("[litreview/crossref] error", {
      message: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

// ── OpenAlex (academic, free, no key) ─────────────────────────
// 200M+ scholarly works — broader than Crossref alone. Polite pool requires
// mailto= in the query string. Abstracts are returned as an inverted index;
// we reconstruct the word order so the synth stage can read them.
type OpenAlexAuthorship = { author?: { display_name?: string } };
type OpenAlexLocation = { source?: { display_name?: string } };
type OpenAlexWork = {
  id?: string;
  doi?: string;
  title?: string;
  display_name?: string;
  publication_year?: number;
  authorships?: OpenAlexAuthorship[];
  abstract_inverted_index?: Record<string, number[]>;
  primary_location?: OpenAlexLocation;
};

function reconstructAbstract(idx: Record<string, number[]> | undefined): string | undefined {
  if (!idx) return undefined;
  const positions: string[] = [];
  for (const [word, indices] of Object.entries(idx)) {
    for (const i of indices) positions[i] = word;
  }
  const out = positions.filter(Boolean).join(" ").trim();
  return out.length > 0 ? out : undefined;
}

export async function harvestOpenAlex(opts: {
  query: string;
  perPage?: number;
  periodFrom: number;
  periodTo: number;
  requireTerms?: string[];
}): Promise<LitReviewScholarHit[]> {
  const params = new URLSearchParams({
    search: opts.query,
    "per-page": String(opts.perPage ?? 15),
    filter: `publication_year:${opts.periodFrom}-${opts.periodTo}`,
    mailto: "support@patent-scan.com",
  });
  const url = `https://api.openalex.org/works?${params}`;
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Patent-Scan/1.0 (mailto:support@patent-scan.com)",
        "Accept": "application/json",
      },
    });
    if (!resp.ok) {
      console.error("[litreview/openalex] non-ok", { status: resp.status });
      return [];
    }
    const data = (await resp.json()) as { results?: OpenAlexWork[] };
    const items = data.results ?? [];
    const terms = opts.requireTerms ?? [];
    return items.flatMap((it) => {
      const title = (it.title ?? it.display_name)?.trim();
      const doi = it.doi?.replace(/^https?:\/\/doi\.org\//, "");
      const url = doi
        ? `https://doi.org/${doi}`
        : it.id;
      if (!title || !url) return [];
      const abstract = reconstructAbstract(it.abstract_inverted_index);
      if (terms.length && !matchesAnyTerm(`${title} ${abstract ?? ""}`, terms)) {
        return [];
      }
      const authors = (it.authorships ?? [])
        .map((a) => a.author?.display_name)
        .filter((n): n is string => typeof n === "string");
      return [{
        doi,
        title,
        authors,
        year: it.publication_year ?? null,
        venue: it.primary_location?.source?.display_name,
        url,
        abstract,
      }];
    });
  } catch (e) {
    console.error("[litreview/openalex] error", {
      message: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

// ── Tavily (web/news) ─────────────────────────────────────────
type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string;
};

export async function harvestTavily(opts: {
  apiKey: string;
  query: string;
  maxResults?: number;
}): Promise<LitReviewWebHit[]> {
  if (!opts.apiKey) return [];
  try {
    const resp = await fetch(TAVILY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: opts.apiKey,
        query: opts.query,
        max_results: opts.maxResults ?? 10,
        search_depth: "advanced",
      }),
    });
    if (!resp.ok) {
      console.error("[litreview/tavily] non-ok", { status: resp.status });
      return [];
    }
    const data = (await resp.json()) as { results?: TavilyResult[] };
    return (data.results ?? []).flatMap((r) => {
      if (!r.title || !r.url) return [];
      return [{
        title: r.title,
        url: r.url,
        snippet: r.content?.slice(0, 400),
        publishedAt: r.published_date,
      }];
    });
  } catch (e) {
    console.error("[litreview/tavily] error", {
      message: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

// ── Wikipedia (REST, public, no key) ──────────────────────────
// Real Wikipedia REST shape (verified via direct probe — docs say "pageid"
// but the API actually returns "id"; "extract" is "excerpt"). PR-3 v1 used
// the docs-listed field names and got wiki=0 silently.
type WikiSearchPage = {
  id: number;
  title: string;
  description?: string;
  excerpt?: string;
};

export async function harvestWikipedia(query: string): Promise<LitReviewWebHit[]> {
  const url =
    "https://ru.wikipedia.org/w/rest.php/v1/search/page?" +
    new URLSearchParams({ q: query, limit: "5" });
  try {
    // Wikipedia REST API blocks anonymous traffic (429) — a polite UA gets us
    // into the regular shared pool. Caller must still throttle (Stage 2 runs
    // these sequentially with a 300ms gap).
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Patent-Scan/1.0 (https://patent-scan.com; support@patent-scan.com)",
        "Accept": "application/json",
      },
    });
    if (!resp.ok) {
      console.error("[litreview/wikipedia] non-ok", { status: resp.status });
      return [];
    }
    const data = (await resp.json()) as { pages?: WikiSearchPage[] };
    return (data.pages ?? []).flatMap((p) => {
      if (!p.title || !p.id) return [];
      return [{
        title: p.title,
        url: `https://ru.wikipedia.org/?curid=${p.id}`,
        snippet: p.description || p.excerpt,
      }];
    });
  } catch (e) {
    console.error("[litreview/wikipedia] error", {
      message: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

// ── HEAD-check a URL (Stage 7 source verification) ────────────
export async function isUrlReachable(url: string, timeoutMs = 5000): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { method: "HEAD", signal: ctrl.signal });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}
