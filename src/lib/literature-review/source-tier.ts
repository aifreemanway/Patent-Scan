// Deterministic source-tier scoring — design: Antepatent/quality-control/
// source-tier-design-2026-06-04.md (§2, approved by cofounder).
//
// Sits between harvest and the LLM relevance pass. Every harvested source gets
// a tier T1–T4 from a domain/feature TABLE (no network, no LLM). The harvest
// uses it for (a) ORDER (authoritative first, before ref numbering) and (b) a
// VISIBLE threshold (drop only explicit T4 by default).
//
// ANTI-FAB GUARDRAILS (non-negotiable):
//   - Unknown web domain defaults to T3 — we never blind-penalise a niche
//     industry source (glencore / outotec / metso / СО РАН / sibran / usgs-like
//     must stay). T4 is an explicit negative-marker list, NOT a blacklist of
//     everything-not-whitelisted.
//   - tier never creates or alters source data — only sorts + applies a
//     visible threshold. Unreachable handling is §4, NOT here.

import { hostFromUrl, hostMatchesSet } from "./source-sanitizer";

export type SourceTier = 1 | 2 | 3 | 4;

// ─────────────────────────────────────────────────────────────
// NEWS_WHITELIST — single source of truth (T2 authoritative news/agency).
// source-augmentation.ts re-imports this so there is exactly one list.
// ─────────────────────────────────────────────────────────────
export const NEWS_WHITELIST: ReadonlyArray<string> = [
  "bloomberg.com",
  "reuters.com",
  "electrive.com",
  "evlithium.com",
  "argusmedia.com",
  "asianmetal.com",
  "iea.org",
  "irena.org",
  "mining.com",
  "benchmarkminerals.com",
  "fastmarkets.com",
  "spglobal.com",
];

// ─────────────────────────────────────────────────────────────
// TIER_MAP — data, not code. Add a domain by appending one entry.
// Matching reuses the blacklist mechanism (exact host + suffix subdomain +
// dotless substring), via hostMatchesSet. First matching entry wins, and the
// list is ordered most-authoritative → most-negative so a T1 publisher beats
// a coincidental substring lower down.
// ─────────────────────────────────────────────────────────────
export const TIER_MAP: ReadonlyArray<{ domains: string[]; tier: SourceTier }> = [
  // ── T1 — primary / verified: DOI resolvers, academic publishers,
  // eLibrary, dissertations, RU scientific library. ────────────────
  {
    tier: 1,
    domains: [
      "doi.org",
      "dx.doi.org",
      "link.springer.com",
      "mdpi.com",
      "sciencedirect.com",
      "onlinelibrary.wiley.com",
      "tandfonline.com",
      "nature.com",
      "elibrary.ru",
      "cyberleninka.ru",
      "dissercat.com",
      "rusneb.ru",
    ],
  },
  // ── T2 — authoritative secondary: whitelist news/agencies, intl.
  // bodies, academies, gov/edu/academic-suffix institutions. ───────
  {
    tier: 2,
    domains: [
      ...NEWS_WHITELIST,
      "iea.org",
      "irena.org",
      "ras.ru",
      // Academic suffixes — these have a dot, so the suffix matcher handles them
      // safely. gov/edu/mil are matched by SEGMENT in scoreTier (NOT as dotless
      // substrings — "gov" must never match "novgorod.ru").
      "ac.uk",
      "ac.jp",
      "ac.ru",
      "ac.cn",
      "ac.in",
    ],
  },
  // ── T4 — low authority: aggregator rehashes, student dumps,
  // dictionary aggregators, forums, narod/ucoz. Explicit only. ─────
  {
    tier: 4,
    domains: [
      "narod.ru",
      "studfile",
      "studopedia",
      "studwood",
      "ngpedia",
      "dic.academic.ru",
      "chipmaker.ru",
      "ucoz",
    ],
  },
];

// Pre-build per-tier sets once (module init).
const TIER_SETS: Array<{ set: Set<string>; tier: SourceTier }> = TIER_MAP.map((e) => ({
  set: new Set(e.domains.map((d) => d.toLowerCase())),
  tier: e.tier,
}));

const DOI_PATH_RE = /\/10\.\d{4,}/;
const DOI_RESOLVER_HOSTS = new Set(["doi.org", "dx.doi.org"]);

/**
 * Score a source's authority tier deterministically. Pure: no network, no LLM.
 *
 * Priority of signals (first decisive one wins):
 *   1. provenance floor — patsearch→T1; crossref/openalex with DOI→T1, w/o→T2;
 *      wikipedia→T2; tavily→resolved by domain below.
 *   2. DOI / resolver in URL — doi.org host OR /10.\d{4,}/ path → T1.
 *   3. TIER_MAP domain match (suffix) — T1 / T2 / T4 list.
 *   4. Default unknown web domain (incl. unmatched tavily) → T3. ⚠ GUARDRAIL.
 */
export function scoreTier(
  url: string,
  provenance: string,
  meta?: { doi?: string | null; accessLevel?: string }
): SourceTier {
  const host = hostFromUrl(url);

  // 1. provenance floor (highest-confidence signal).
  switch (provenance) {
    case "patsearch":
      return 1; // patent from API = verified by definition
    case "crossref":
    case "openalex":
      return meta?.doi ? 1 : 2; // scholarly w/ DOI is a primary source
    case "wikipedia":
    case "wikipedia_infobox":
      return 2; // background, not primary, but not junk
    // "tavily" + everything else → fall through to domain resolution
  }

  // 2. DOI / resolver in URL (independent of provenance).
  if (host) {
    if (DOI_RESOLVER_HOSTS.has(host)) return 1;
  }
  if (DOI_PATH_RE.test(url)) return 1;

  // 2b. Government / academic by TLD SEGMENT → T2. Exact segment match, never
  //     substring: "gov" matches nih.gov / usgs.gov but NOT "novgorod.ru".
  if (host) {
    const segs = host.split(".");
    if (segs.includes("gov") || segs.includes("edu") || segs.includes("mil")) {
      return 2;
    }
  }

  // 3. TIER_MAP domain match. Ordered T1→T2→T4; first match wins so an
  //    authoritative publisher is never demoted by a later substring entry.
  if (host) {
    for (const { set, tier } of TIER_SETS) {
      if (hostMatchesSet(host, set)) return tier;
    }
  }

  // Forum marker in the path (any host) → T4. Kept separate from host lists
  // because it is a path heuristic, not a domain.
  try {
    if (/\/forum\//i.test(new URL(url).pathname)) return 4;
  } catch {
    // malformed URL — let the default handle it
  }

  // 4. ⚠ GUARDRAIL: unknown web domain defaults to T3, NOT T4. Niche industry
  //    sources (glencore/outotec/metso/СО РАН) must survive.
  return 3;
}
