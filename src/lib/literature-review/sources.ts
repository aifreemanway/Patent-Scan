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
const REGION_DATASETS: Record<LitReviewRegion, string[]> = {
  RU: ["ru_since_1994", "ru_till_1994"],
  CIS: ["cis"],
  US: ["us"],
  EU: ["ep"],
  UK: [],
  CN: ["cn"],
  JP_KR: ["jp"],
  AU_NZ: [],
  LATAM: [],
  ME: [],
  AF: [],
  WORLD: ["ru_since_1994", "us", "ep", "cn", "jp"],
};

export function patsearchDatasetsForRegions(regions: LitReviewRegion[]): string[] {
  const set = new Set<string>();
  for (const r of regions) for (const ds of REGION_DATASETS[r] ?? []) set.add(ds);
  return Array.from(set);
}

// ── PatSearch (Rospatent) ─────────────────────────────────────
type PatSearchDoc = {
  id?: string;
  publication_number?: string;
  publication_date?: string;
  title?: { ru?: string; en?: string } | string;
  abstract?: { ru?: string; en?: string } | string;
  country?: { code?: string } | string;
};

type PatSearchResponse = {
  hits?: { hits?: PatSearchDoc[] };
  total?: number;
};

function pickLang(v: PatSearchDoc["title"]): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  return v.ru || v.en || "";
}

export async function harvestPatSearch(opts: {
  token: string;
  query: string;
  datasets: string[];
  limit?: number;
  periodFrom: number;
  periodTo: number;
}): Promise<LitReviewPatentHit[]> {
  if (!opts.token || opts.datasets.length === 0) return [];

  const body = {
    qn: opts.query,
    limit: Math.min(opts.limit ?? 25, 50),
    offset: 0,
    datasets: opts.datasets,
    filter: {
      publication_date: {
        gte: `${opts.periodFrom}-01-01`,
        lte: `${opts.periodTo}-12-31`,
      },
    },
  };

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
      console.error("[litreview/patsearch] non-ok", { status: resp.status });
      return [];
    }
    const data = (await resp.json()) as PatSearchResponse;
    const hits = data.hits?.hits ?? [];
    return hits.flatMap((d) => {
      const id = d.id ?? d.publication_number;
      if (!id) return [];
      const country =
        typeof d.country === "object" && d.country?.code
          ? d.country.code
          : (typeof d.country === "string" ? d.country : "");
      return [{
        id,
        title: pickLang(d.title),
        year: (d.publication_date ?? "").slice(0, 4),
        country,
        abstract: pickLang(d.abstract) || undefined,
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

export async function harvestCrossref(opts: {
  query: string;
  rows?: number;
  periodFrom: number;
  periodTo: number;
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
    return items.flatMap((it) => {
      const title = it.title?.[0]?.trim();
      const url = it.URL || (it.DOI ? `https://doi.org/${it.DOI}` : undefined);
      if (!title || !url) return [];
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
type WikiSearchPage = {
  pageid: number;
  title: string;
  description?: string;
  extract?: string;
};

export async function harvestWikipedia(query: string): Promise<LitReviewWebHit[]> {
  const url =
    "https://ru.wikipedia.org/w/rest.php/v1/search/page?" +
    new URLSearchParams({ q: query, limit: "5" });
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error("[litreview/wikipedia] non-ok", { status: resp.status });
      return [];
    }
    const data = (await resp.json()) as { pages?: WikiSearchPage[] };
    return (data.pages ?? []).flatMap((p) => {
      if (!p.title) return [];
      return [{
        title: p.title,
        url: `https://ru.wikipedia.org/?curid=${p.pageid}`,
        snippet: p.description || p.extract,
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
