// Industrial Usage — Stage 1 (assignee extraction) and Stage 2 (harvest).
// PatSearch's GET /docs returns rich bibliographic data (biblio.en.patentee[],
// biblio.en.applicant[], abstract, claims) — that's our primary source of the
// canonical assignee. We then fan out across Tavily / Wikipedia for company
// profile, product mentions, and competitor mapping.

import { PATSEARCH_URL, TAVILY_URL } from "@/lib/config";
import type { IUStageHarvest } from "./types";

// ── Stage 1 — assignee extraction from PatSearch ──────────────
type PatSearchPatentee = { name?: string };
type PatSearchBiblio = {
  en?: { patentee?: PatSearchPatentee[]; applicant?: PatSearchPatentee[]; title?: string };
  ru?: { patentee?: PatSearchPatentee[]; applicant?: PatSearchPatentee[]; title?: string };
};
type PatSearchDocResponse = {
  id?: string;
  common?: { publishing_office?: string; publication_date?: string };
  biblio?: PatSearchBiblio;
  abstract?: string | { en?: string; ru?: string };
  snippet?: { title?: string | { en?: string; ru?: string } };
};

export type PatentMeta = {
  /** PatSearch internal id, e.g. "US0006322610B1_20011127". */
  id: string;
  /** Best-available title (EN preferred). */
  title: string;
  /** 2-letter country code of the patent office, e.g. "US". */
  country: string;
  /** YYYY of publication. */
  year: string;
  /** Distinct patentee names, canonicalised (longest variant wins as canonical). */
  patentees: string[];
  /** Best-guess single canonical assignee — picks the most "company-like" patentee. */
  canonicalAssignee: string;
  /** Patent abstract (EN preferred, RU fallback) for context. */
  abstract: string;
};

function getPatSearchDocUrl(id: string): string {
  // GET /docs/{id} — different base path than /search; build from the share URL root.
  const base = PATSEARCH_URL.replace(/\/search\/?$/, "");
  return `${base}/docs/${encodeURIComponent(id)}`;
}

function pickLang(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && v !== null) {
    const o = v as { en?: string; ru?: string };
    return (o.en ?? o.ru ?? "").trim();
  }
  return "";
}

/** Picks the most "company-like" patentee from a list.
 *  Heuristic: drop names that look like personal names (e.g. "Milorad Pavlicevic"),
 *  prefer entries with Inc/Ltd/Oyj/OY/GmbH/SpA/Corp markers, fall back to the
 *  longest entry. Returns "" if no patentees were supplied. */
function pickCanonicalAssignee(patentees: string[]): string {
  if (patentees.length === 0) return "";
  const COMPANY_MARKERS = /\b(inc|ltd|llc|corp|gmbh|oyj|oy|spa|sa|ag|sas|sarl|kk|co\b|company|group|holding|technologies|industries|materials|mining|metals|pharmaceuticals|systems)\b/i;
  const PERSON_RE = /^[A-ZА-ЯЁ][a-zа-яё]+( [A-ZА-ЯЁ]\.?)+( [A-ZА-ЯЁ][a-zа-яё]+)?$/;
  const candidates = patentees.filter((p) => !PERSON_RE.test(p));
  if (candidates.length === 0) return patentees[0];
  // RU-facing product: ФИПС /docs returns BOTH the Cyrillic original
  // (biblio.ru.patentee) and a Latin transliteration (biblio.en.patentee). The
  // transliteration is longer, so the longest-fallback below would pick
  // "OAO NIITKD" over "ОАО НИИТКД". Prefer the Cyrillic original when present.
  const cyrillic = candidates.filter((p) => /[А-Яа-яЁё]/.test(p));
  const pool = cyrillic.length > 0 ? cyrillic : candidates;
  const withMarker = pool.find((p) => COMPANY_MARKERS.test(p));
  if (withMarker) return withMarker;
  return pool.reduce((longest, p) => (p.length > longest.length ? p : longest), pool[0]);
}

function dedupeNames(names: string[]): string[] {
  const seen = new Map<string, string>();
  for (const n of names) {
    const key = n.trim().toLowerCase().replace(/[^a-z0-9а-яё ]/gi, "").replace(/\s+/g, " ");
    if (!key) continue;
    const existing = seen.get(key);
    if (!existing || n.length > existing.length) seen.set(key, n.trim());
  }
  return Array.from(seen.values());
}

export async function fetchPatentMeta(
  patsearchToken: string,
  patentId: string
): Promise<PatentMeta | null> {
  if (!patsearchToken || !patentId) return null;
  try {
    const resp = await fetch(getPatSearchDocUrl(patentId), {
      headers: { Authorization: `Bearer ${patsearchToken}` },
    });
    if (!resp.ok) {
      console.error("[iu/patsearch-doc] non-ok", { status: resp.status, patentId });
      return null;
    }
    const data = (await resp.json()) as PatSearchDocResponse;
    const en = data.biblio?.en;
    const ru = data.biblio?.ru;
    const rawPatentees = [
      ...(en?.patentee?.map((p) => p?.name).filter(Boolean) ?? []),
      ...(ru?.patentee?.map((p) => p?.name).filter(Boolean) ?? []),
    ] as string[];
    const patentees = dedupeNames(rawPatentees);
    return {
      id: data.id ?? patentId,
      title: pickLang(data.snippet?.title) || en?.title || ru?.title || "",
      country: data.common?.publishing_office ?? "",
      year: (data.common?.publication_date ?? "").slice(0, 4),
      patentees,
      canonicalAssignee: pickCanonicalAssignee(patentees),
      abstract: pickLang(data.abstract).slice(0, 2000),
    };
  } catch (e) {
    console.error("[iu/patsearch-doc] error", {
      patentId,
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

// ── Stage 2 — Tavily fan-out for company / product / competitors ──
type TavilyResult = { title?: string; url?: string; content?: string };
type TavilyResponse = { results?: TavilyResult[] };

async function tavilySearch(
  apiKey: string,
  query: string,
  maxResults: number
): Promise<Array<{ title: string; url: string; snippet?: string }>> {
  if (!apiKey) return [];
  try {
    const resp = await fetch(TAVILY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        search_depth: "basic",
      }),
    });
    if (!resp.ok) {
      console.error("[iu/tavily] non-ok", { status: resp.status, query: query.slice(0, 60) });
      return [];
    }
    const data = (await resp.json()) as TavilyResponse;
    return (data.results ?? []).flatMap((r) => {
      if (!r.title || !r.url) return [];
      return [{ title: r.title, url: r.url, snippet: r.content?.slice(0, 400) }];
    });
  } catch (e) {
    console.error("[iu/tavily] error", {
      message: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

export async function harvestStage2(
  tavilyKey: string,
  meta: PatentMeta
): Promise<IUStageHarvest> {
  const company = meta.canonicalAssignee || meta.patentees[0] || "";
  const titleHint = meta.title.split(/[\s,;:.()\[\]]+/).filter((w) => w.length > 4).slice(0, 5).join(" ");

  // One company-profile query is enough; two for competitors casts a wider net
  // (one against the company, one against the technology area) so we reliably
  // get ≥2 distinct competitors even when Tavily returns sparse matches on the
  // first.
  const [companyPages, productPages, comp1, comp2] = await Promise.all([
    company
      ? tavilySearch(tavilyKey, `"${company}" company profile industry headquarters`, 5)
      : Promise.resolve([]),
    company && titleHint
      ? tavilySearch(tavilyKey, `"${company}" ${titleHint} products technology`, 6)
      : Promise.resolve([]),
    company && titleHint
      ? tavilySearch(tavilyKey, `competitors of "${company}" ${titleHint}`, 6)
      : Promise.resolve([]),
    titleHint
      ? tavilySearch(tavilyKey, `leading suppliers ${titleHint} market share companies`, 6)
      : Promise.resolve([]),
  ]);

  // Dedupe competitor pages — the two queries often overlap on big players.
  const seenComp = new Set<string>();
  const competitorPages = [...comp1, ...comp2].filter((p) => {
    if (seenComp.has(p.url)) return false;
    seenComp.add(p.url);
    return true;
  });

  return { companyPages, productPages, competitorPages };
}
