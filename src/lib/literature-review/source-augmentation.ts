// PR-3.6: source-augmentation for §2 comparative tables («tables-of-players»).
//
// v1 hydrogen + LFP samples showed: SYNTH_TABLES_PROMPT structurally builds
// the right table (companies × HQ/founded/products/capacity/share/...), but
// cells come back mostly "—" because the LLM cannot fabricate (correctly so)
// and the harvest snippets rarely contain HQ/founding-year data in a form
// it can extract. This module fills the gap deterministically:
//
//   For each company column × each row (HQ, founded, products, capacity,
//   market share, customers, IPO/status), tries 4 resolvers in priority order:
//
//     1. Wikipedia infobox parse (deterministic regex, no LLM)
//     2. Corp /about page LLM narrow-extraction
//     3. Industry news whitelist (Bloomberg/Reuters/Argus/IEA/IRENA, via Tavily
//        with site-restriction) + LLM narrow-extraction
//     4. SEC EDGAR / HKEX filings (via Tavily site:sec.gov / site:hkexnews.hk)
//        + LLM narrow-extraction
//
// Every extracted value MUST pass anti-fab validation: substring-match in the
// source text + field-specific format regex (year = 4 digits, capacity =
// "<n> GWh|MWh|т/год", market share = "<n>%", IPO ticker = "EXCH: code").
// Generic statements ("производит батареи", "major player") are hard-banned.
//
// Augmented cells are formatted as "<value> [N]" where [N] is the new ref
// added to §5 sources. Per-row sourceRefs is also extended.
//
// Acceptance (per ap-ba ТЗ 2026-05-31):
//   - Hydrogen Tab.1 (~5 companies × 7 rows = 35 cells) → ≥ 21 filled (60%)
//   - LFP Tab.1 (~4 companies × 7 rows = 28 cells) → ≥ 17 filled (60%)
//   - Each filled cell has a footnote URL.
//   - 10% spot-check: extracted value substring-matches the cited URL's text.

import { callGeminiJson } from "@/lib/gemini";
import { TAVILY_URL } from "@/lib/config";
import type { LitReviewReport, LitReviewSource } from "./types";

// Polite UA — same one we use for Wikipedia REST in sources.ts.
const UA = "Patent-Scan/1.0 (https://patent-scan.com; support@patent-scan.com)";

// ─────────────────────────────────────────────────────────────
// Player-field classification (row label → known field kind)
// ─────────────────────────────────────────────────────────────
// The SYNTH_TABLES_PROMPT mandates a tables-of-players first table with
// rows labelled in Russian. Different industries phrase them slightly
// differently, so we use loose regex matching rather than exact strings.

export type PlayerField =
  | "hq"        // HQ / страна / штаб-квартира / location
  | "founded"   // год основания / foundation year
  | "product"   // основной продукт / технология
  | "capacity"  // объём производства / capacity
  | "share"     // доля рынка (% only)
  | "revenue"   // выручка / revenue ($ / млн / млрд only) — split from share in v2.2
  | "customers" // ключевые клиенты / партнёрства
  | "status";   // статус / IPO / ownership

function classifyRow(label: string): PlayerField | null {
  const l = label.toLowerCase();
  // PR-3.6.1.2 (ap-ba v2.1 review issue #3): split share vs revenue. v2.1 had
  // LFP «Выручка 2025» row filled with market share %; values passed share-
  // format check because classifier collapsed both into one field. Revenue
  // wants currency tokens; share wants %. Order: revenue match runs FIRST so
  // «доля выручки» (rare) collapses to revenue, but plain «доля рынка» →
  // share.
  if (/(выручк|revenue|оборот|sales|товарооб)/.test(l)) return "revenue";
  if (/(дол[ья].*рынк|market\s*share|share\b)/.test(l)) return "share";
  if (/(объ[её]м|capacity|выпуск|production\s+(volume|capacity)|производит|производственн)/.test(l)) return "capacity";
  if (/(ключев[ые]?\s+клиент|customer|партн|partner|потребител)/.test(l)) return "customers";
  if (/(статус|status|ipo|owner|ownership|listing|listed|акцион|публичн)/.test(l)) return "status";
  if (/(основан|founded|foundation|year\s+founded|год\s+(основ|выход|создан))/.test(l)) return "founded";
  if (/(hq|штаб|headquart|местоположен|location|страна|country)/.test(l)) return "hq";
  if (/(основ.+продукт|основ.+техно|product|technolog|outputs?\b)/.test(l)) return "product";
  return null;
}

// ─────────────────────────────────────────────────────────────
// Player-table detection (which of report.comparativeTables is the players table?)
// ─────────────────────────────────────────────────────────────
// Heuristic: a table is the players table when ≥3 of its rows classify as
// known player-fields (HQ, founded, product, capacity, share, customers,
// status). Skip the first column if it's "Параметр"-like.

export function findPlayerTable(report: LitReviewReport): {
  tableIdx: number;
  companyCols: { col: number; name: string }[];
  fieldRows: { row: number; field: PlayerField }[];
} | null {
  for (let t = 0; t < report.comparativeTables.length; t++) {
    const table = report.comparativeTables[t];
    if (table.columns.length < 2 || table.rows.length < 3) continue;

    const fieldRows = table.rows.flatMap((r, idx) => {
      const f = classifyRow(r.label);
      return f ? [{ row: idx, field: f }] : [];
    });
    if (fieldRows.length < 3) continue;

    // First "column" in the schema is the row-label header (e.g. "Параметр").
    // Actual company columns live in row.cells[0..]. cells.length should match
    // columns.length - 1 (header is the row label, not a cell).
    // Defensive: derive company names from columns[1..].
    const companyCols = table.columns.slice(1).flatMap((name, i) => {
      const n = name.trim();
      // Skip empty / generic column headers — they're not company-bearing.
      if (!n || /^параметр$/i.test(n) || /^value$/i.test(n)) return [];
      return [{ col: i, name: n }];
    });
    if (companyCols.length < 2) continue;

    return { tableIdx: t, companyCols, fieldRows };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Anti-fab validators
// ─────────────────────────────────────────────────────────────

function normalizeForSubstring(s: string): string {
  return s
    .toLowerCase()
    .replace(/[«»""''`.,;:!?()\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Substring-match in source text, normalized for punctuation/whitespace. */
export function substringMatches(value: string, sourceText: string): boolean {
  const v = normalizeForSubstring(value);
  if (v.length < 2) return false;
  const s = normalizeForSubstring(sourceText);
  return s.includes(v);
}

// Generic phrases we hard-ban — these are model padding, not data.
const BANNED_PATTERNS: RegExp[] = [
  /\bпроизводит\b/i,
  /\bвыпускает\b/i,
  /\bпредлагает\b/i,
  /\bvarious\b/i,
  /\bmultiple\b/i,
  /\bwide range\b/i,
  /\bразнообразн/i,
  /\bразные\b/i,
  /\bмного\b/i,
  /\bmajor player\b/i,
  /\bключевой\s+игрок/i,
  /\bодин\s+из\s+(крупн|ведущ|основн)/i,
];

// PR-3.6.1 (ap-ba v2 review 2026-05-31 — confirmed 40% LLM-cell hallucination
// rate): per-field max length cuts off prose drift. «Blade Battery запущена
// в марте 2020» (60 chars) is a product-launch sentence, not a founding year
// — even though it matches the year-digit regex. A 30-char cap rejects it.
const MAX_LEN: Record<PlayerField, number> = {
  hq: 120,
  founded: 30,
  product: 200,
  capacity: 120,
  share: 120,
  revenue: 120,
  customers: 250,
  status: 180,
};

/** Validate an extracted value against field-specific format + bans. */
export function validateValue(value: string, field: PlayerField): boolean {
  const v = value.trim();
  if (v.length < 2 || v.length > MAX_LEN[field]) return false;
  if (/^[—\-–.\s?]+$/.test(v)) return false;
  if (BANNED_PATTERNS.some((re) => re.test(v))) return false;

  switch (field) {
    case "founded":
      // 4-digit year, optionally "с 1897" / "since 2011" / range "1897-2011"
      return /\b(1[89]\d{2}|20[0-2]\d)\b/.test(v);
    case "capacity":
      return /\d+\s*(GWh|MWh|MW|GW|kWh|т\/год|тонн|tons?|tonnes?|tpy|млн\.?\s*т|units?\/year|шт)/i.test(v);
    case "share":
      return /\d+(\.\d+)?\s*%/.test(v);
    case "revenue":
      // PR-3.6.1.2 (ap-ba v2.1 review #3): Revenue field requires currency
      // tokens or revenue-word; bare percentages are market share, not money.
      return /(\$|₽|€|¥|₸|млрд|млн|billion|million|тыс\.?\s+руб|revenue|выручк|оборот|sales)/i.test(v) &&
        /\d/.test(v);
    case "status":
      // IPO ticker, or "private", "state-owned", year of listing
      return /([A-Z]{2,6}\s*[:.\s]\s*[A-Z\d.]{3,8})|\b(IPO|publicly listed|traded|state-owned|госуд|частн|частная|public)\b/i.test(v) ||
        /\b(20\d{2}|19\d{2})\b/.test(v);
    case "hq":
      // PR-3.6.1.2 (ap-ba v2.1 review #4): v2.1 LFP regressed to «Китай»×4
      // (LLM put single-word generic, anti-fab passed it since it has caps).
      // Force specificity: ≥1 of {comma-separated location} OR {2+ cap words}.
      // «Китай» → fail. «Ningde, Fujian, China» → pass. «Latham, New York» → pass.
      if (!/[A-ZА-ЯЁ]/.test(v)) return false;
      if (v.includes(",")) return true;
      // Count capital-leading words (proper nouns).
      return ((v.match(/\b[A-ZА-ЯЁ][a-zа-яё]{2,}/g) ?? []).length) >= 2;
    case "product":
    case "customers":
      // Free-form, but must have at least one capitalized word (proper noun)
      // or Cyrillic capital. Pure-lowercase prose fails.
      return /[A-ZА-ЯЁ]/.test(v);
  }
}

// ─────────────────────────────────────────────────────────────
// Footnote helper — register new source, return its ref index
// ─────────────────────────────────────────────────────────────

export type AugmentationContext = {
  report: LitReviewReport;
  /** url → ref (dedupe so two cells citing the same news article share one ref). */
  newRefsByUrl: Map<string, number>;
};

function registerSource(
  ctx: AugmentationContext,
  url: string,
  title: string,
  provenance: LitReviewSource["provenance"]
): number {
  if (!url) return 0;
  const existing = ctx.newRefsByUrl.get(url);
  if (existing) return existing;

  // Also check against the original sources list — Wikipedia harvest may have
  // already added the same page during Stage 2; reuse that ref if so.
  for (const s of ctx.report.sources) {
    if (s.url === url) {
      ctx.newRefsByUrl.set(url, s.ref);
      return s.ref;
    }
  }

  const ref = ctx.report.sources.length > 0
    ? Math.max(...ctx.report.sources.map((s) => s.ref)) + 1
    : 1;
  ctx.report.sources.push({
    ref,
    title: title.slice(0, 300),
    url,
    reachedAt: null, // stage 7 verifies later
    // All augmentation resolvers (infobox / corp site / industry news / SEC /
    // HKEX) read full public documents → open access.
    accessLevel: "open",
    provenance,
  });
  ctx.newRefsByUrl.set(url, ref);
  return ref;
}

// ─────────────────────────────────────────────────────────────
// Resolver 1 — Wikipedia infobox (deterministic regex parse, no LLM)
// ─────────────────────────────────────────────────────────────

type WikiInfobox = {
  pageTitle: string;
  pageUrl: string;
  fields: Map<string, string>;
};

async function fetchWikipediaInfobox(company: string): Promise<WikiInfobox | null> {
  try {
    // 1. Find the most likely English-Wikipedia page for the company.
    const searchUrl =
      "https://en.wikipedia.org/w/rest.php/v1/search/page?" +
      new URLSearchParams({ q: company, limit: "3" });
    const sResp = await fetch(searchUrl, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
    });
    if (!sResp.ok) return null;
    const sData = (await sResp.json()) as {
      pages?: Array<{ key?: string; title?: string; description?: string }>;
    };
    const pages = sData.pages ?? [];
    if (pages.length === 0) return null;

    // Pick first page whose title/description looks company-ish.
    const companyLc = company.toLowerCase();
    const pick = pages.find((p) => {
      const tl = (p.title ?? "").toLowerCase();
      const dl = (p.description ?? "").toLowerCase();
      const titleMatches = tl.includes(companyLc.split(" ")[0]);
      const descCompany = /\b(company|corporation|manufacturer|conglomerate|enterprise|компания|корпорация|производител|концерн|предприятие)\b/.test(
        dl
      );
      return titleMatches && (descCompany || dl.length === 0);
    }) ?? pages[0];

    const pageTitle = pick.key ?? pick.title ?? "";
    if (!pageTitle) return null;
    const pageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g, "_"))}`;

    // 2. Get raw wikitext to parse the infobox.
    const parseUrl =
      "https://en.wikipedia.org/w/api.php?" +
      new URLSearchParams({
        action: "parse",
        page: pageTitle,
        prop: "wikitext",
        format: "json",
        formatversion: "2",
      });
    const pResp = await fetch(parseUrl, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
    });
    if (!pResp.ok) return null;
    const pData = (await pResp.json()) as { parse?: { wikitext?: string } };
    const wikitext = pData.parse?.wikitext ?? "";
    if (!wikitext) return null;

    // 3. Extract the infobox block. Wikipedia infobox syntax is {{Infobox <kind>|...}}
    // — match brace-balanced. We accept any infobox (company is the common one but
    // some pages use Infobox manufacturer / Infobox brand).
    const fields = parseInfoboxFields(wikitext);
    if (fields.size === 0) return null;

    return { pageTitle, pageUrl, fields };
  } catch (e) {
    console.error("[litreview/augment] wiki fetch failed", {
      company,
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** Parse `{{Infobox ...|key=value|...}}` into a key→value map. */
export function parseInfoboxFields(wikitext: string): Map<string, string> {
  const map = new Map<string, string>();
  const start = wikitext.search(/\{\{\s*Infobox\b/i);
  if (start < 0) return map;

  // Walk forward counting braces to find the matching `}}`.
  let depth = 0;
  let end = -1;
  for (let i = start; i < wikitext.length - 1; i++) {
    if (wikitext[i] === "{" && wikitext[i + 1] === "{") {
      depth++;
      i++;
    } else if (wikitext[i] === "}" && wikitext[i + 1] === "}") {
      depth--;
      i++;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return map;
  let body = wikitext.slice(start, end);

  // Strip nested {{template|...}} expressions BEFORE splitting on `|` (they
  // contain pipes that would corrupt the split). Replace with a placeholder
  // so we don't lose surrounding text.
  body = stripNestedTemplates(body);
  // Strip ref tags.
  body = body.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "").replace(/<ref[^/]*\/>/gi, "");
  // Strip HTML comments.
  body = body.replace(/<!--[\s\S]*?-->/g, "");

  // Now split on top-level `|` separators (which are now safe).
  const parts = body.split(/\n\s*\|/);
  for (const p of parts) {
    const eqIdx = p.indexOf("=");
    if (eqIdx < 0) continue;
    const key = p.slice(0, eqIdx).trim().toLowerCase().replace(/[\s_]+/g, "_");
    let value = p.slice(eqIdx + 1).trim();
    // Strip wiki links [[Target|Display]] → Display, [[Target]] → Target.
    value = value.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
    value = value.replace(/\[\[([^\]]+)\]\]/g, "$1");
    // Strip external links [https://... display] → display, [url] → url.
    value = value.replace(/\[(https?:\/\/\S+)\s+([^\]]+)\]/g, "$2");
    value = value.replace(/\[(https?:\/\/\S+)\]/g, "$1");
    // Strip bold/italic.
    value = value.replace(/'{2,5}/g, "");
    // Strip <br>, <small>, etc. tags but keep their text.
    value = value.replace(/<\/?(br|small|sub|sup|span|p|div)[^>]*>/gi, " ");
    // Collapse whitespace.
    value = value.replace(/\s+/g, " ").trim();
    // Trim trailing `}}` if it's the last field.
    value = value.replace(/\}\}\s*$/, "").trim();
    if (key && value) map.set(key, value);
  }
  return map;
}

function stripNestedTemplates(s: string): string {
  // Replace `{{...}}` (single-level nested) with their inner text after `|`
  // for known display templates like {{nowrap|X}} or {{flagicon|US}} → keep
  // a sensible substring. For everything else, drop.
  let prev: string;
  let cur = s;
  do {
    prev = cur;
    cur = cur.replace(/\{\{([^{}|]+)\|([^{}]*?)\}\}/g, (_m, name: string, args: string) => {
      const n = name.toLowerCase().trim();
      if (n === "nowrap" || n === "nobr" || n === "lang" || n === "lang-ru" || n === "lang-en") {
        return args.split("|").pop() ?? "";
      }
      if (n === "flag" || n === "flagicon" || n === "flagcountry" || n === "flagu") {
        return args.split("|")[0] ?? "";
      }
      if (n === "ublist" || n === "unbulleted list" || n === "plainlist" || n === "hlist") {
        return args.split("|").filter((x) => x.trim()).join(", ");
      }
      if (n === "url") {
        const u = args.split("|")[0]?.trim() ?? "";
        return u;
      }
      if (n === "start date" || n === "start date and age" || n === "birth date") {
        return args.split("|").slice(0, 3).join("-"); // YYYY-MM-DD
      }
      if (n === "ill" || n === "interlanguage link") {
        return args.split("|")[0] ?? "";
      }
      // Drop unknown templates entirely.
      return "";
    });
    // Drop any remaining {{...}} without `|`.
    cur = cur.replace(/\{\{[^{}]*?\}\}/g, "");
  } while (cur !== prev);
  return cur;
}

const WIKI_FIELD_KEYS: Record<PlayerField, string[]> = {
  hq: ["headquarters", "hq_location", "hq_location_city", "hq_location_country", "location", "location_country", "location_city"],
  founded: ["founded", "foundation", "founding_date", "foundation_date", "established", "formation", "inception", "date_of_incorporation"],
  product: ["products", "production_output_article", "production"],
  capacity: ["production_output_article", "production"],
  share: ["market_share"],
  revenue: ["revenue", "net_income", "operating_income"],
  customers: [], // not typically in infobox
  status: ["traded_as", "type", "owner", "owners", "parent", "isin"],
};

function pickWikiField(infobox: WikiInfobox, field: PlayerField): string | null {
  for (const key of WIKI_FIELD_KEYS[field]) {
    const v = infobox.fields.get(key);
    if (v && v.length > 0) return v;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Resolver 2 — Corp site /about (LLM narrow-extraction)
// ─────────────────────────────────────────────────────────────

async function resolveCorpHomepage(
  company: string,
  infobox: WikiInfobox | null
): Promise<string | null> {
  // Prefer Wikipedia infobox `homepage` field if present.
  const hp = infobox?.fields.get("homepage") || infobox?.fields.get("website");
  if (hp) {
    const m = hp.match(/https?:\/\/[^\s<>]+/);
    if (m) return m[0].replace(/[)\]}>,;.]+$/, "");
  }
  // Otherwise we don't try to guess (would risk wrong-company /about pages).
  // PR-3.6 keeps this conservative; corp resolver requires a Wiki-verified URL.
  return null;
}

async function fetchCorpAbout(homepage: string): Promise<{ url: string; text: string } | null> {
  const candidates = [
    new URL("/about", homepage).toString(),
    new URL("/en/company", homepage).toString(),
    new URL("/about-us", homepage).toString(),
    new URL("/company", homepage).toString(),
    homepage, // last resort — homepage itself often has key facts
  ];
  for (const url of candidates) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const resp = await fetch(url, {
        headers: { "User-Agent": UA, "Accept": "text/html,*/*" },
        signal: ctrl.signal,
        redirect: "follow",
      });
      clearTimeout(timer);
      if (!resp.ok) continue;
      const html = await resp.text();
      if (html.length < 200) continue;
      const text = htmlToText(html);
      if (text.length < 200) continue;
      return { url, text };
    } catch {
      continue;
    }
  }
  return null;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12000); // cap input — Gemini extraction doesn't need more
}

const FIELD_RU_LABEL: Record<PlayerField, string> = {
  hq: "штаб-квартира (город и страна, например 'Ningde, Fujian Province, China')",
  founded: "год основания (только год, 4 цифры)",
  product: "ключевой продукт / технология (конкретное название, должно относиться к теме обзора)",
  capacity: "объём производства (например, '500 GWh/год' или '20 000 т/год')",
  share: "доля рынка (например, '38%')",
  revenue: "выручка / revenue в денежных единицах (например, '$61 млрд USD 2025' или '423.7 млрд юаней')",
  customers: "ключевые клиенты / партнёры (конкретные названия)",
  status: "статус / IPO / тикер (например, 'SHE 300750' или 'public, Nasdaq: PLUG')",
};

const NARROW_EXTRACT_PROMPT = `Ты — narrow-extractor для литературного обзора. На вход — название компании, искомое поле, и source text (фрагмент веб-страницы или новости).
Найди ТОЛЬКО дословное упоминание искомого поля в source text. Если упоминания нет — верни NONE.

Правила:
- Возвращай дословный фрагмент из source text (минимально необходимый, обычно 2-15 слов).
- НЕ перефразируй, НЕ суммаризуй, НЕ добавляй контекст.
- Если в тексте нет упоминания искомого поля — верни {"value": "NONE"}.
- Если есть несколько кандидатов — выбери самый специфичный (с цифрами, датой, конкретным именем).
- Generic statements ("производит батареи", "major player") = NONE.

Верни СТРОГО валидный JSON:
{"value": "<extracted fragment OR NONE>"}`;

type NarrowExtractOutput = { value?: string };

// PR-3.6.1.2 (ap-ba v2.1 review issue #2): "topic-keyword constraint".
// v2.1 augmenter picked source pages про Siemens Digital Logistics (Dubai
// airports HQ) и Siemens Mobile (GSM 3G product) because Tavily site:sec.gov
// for "Siemens electrolyzer" surfaces ALL Siemens filings — substring-match
// passes but the page isn't about H2 at all. Topic-keyword guard: any source
// text considered must mention ≥1 topic-relevant term (electrolyzer, PEM,
// hydrogen for H2; LFP, LiFePO4, cathode for LFP). For non-topic-coupled
// fields (HQ, founded, IPO) the guard is skipped — Siemens's HQ city is
// objective regardless of which subsidiary's filing names it.
const TOPIC_GUARDED_FIELDS = new Set<PlayerField>([
  "product",
  "capacity",
  "share",
  "revenue",
  "customers",
]);

function sourceMentionsTopic(sourceText: string, topicKeywords: string[]): boolean {
  if (topicKeywords.length === 0) return true; // no list = no filter
  const lc = sourceText.toLowerCase();
  return topicKeywords.some((k) => k.length >= 3 && lc.includes(k.toLowerCase()));
}

async function narrowExtract(opts: {
  apiKey: string;
  company: string;
  field: PlayerField;
  sourceText: string;
  sourceUrl: string;
  label: string;
  topicKeywords: string[];
}): Promise<string | null> {
  // Topic-keyword pre-gate (PR-3.6.1.2): skip the LLM call entirely when
  // the source text doesn't mention the topic at all, for fields where the
  // value MUST be topic-coupled.
  if (
    TOPIC_GUARDED_FIELDS.has(opts.field) &&
    !sourceMentionsTopic(opts.sourceText, opts.topicKeywords)
  ) {
    return null;
  }
  const userText = [
    `КОМПАНИЯ: ${opts.company}`,
    `ИСКОМОЕ ПОЛЕ: ${FIELD_RU_LABEL[opts.field]}`,
    opts.topicKeywords.length > 0 && TOPIC_GUARDED_FIELDS.has(opts.field)
      ? `КОНТЕКСТ ТЕМЫ: значение должно относиться к теме обзора — ключевые термины темы: ${opts.topicKeywords.slice(0, 15).join(", ")}. Если найденное упоминание про другую business unit / subsidiary / product line (не связан с темой) — верни NONE.`
      : "",
    `SOURCE URL: ${opts.sourceUrl}`,
    `SOURCE TEXT (первые 12k символов):`,
    opts.sourceText.slice(0, 12000),
  ].filter(Boolean).join("\n\n");

  try {
    const { data } = await callGeminiJson<NarrowExtractOutput>({
      apiKey: opts.apiKey,
      label: opts.label,
      systemPrompt: NARROW_EXTRACT_PROMPT,
      userText,
      timeoutMs: 45_000,
    });
    const v = (data.value ?? "").trim();
    if (!v || v === "NONE") return null;
    // Defense in depth: re-validate substring match against the source text.
    if (!substringMatches(v, opts.sourceText)) return null;
    if (!validateValue(v, opts.field)) return null;
    return v;
  } catch (e) {
    console.error("[litreview/augment] narrow-extract failed", {
      company: opts.company,
      field: opts.field,
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Resolver 3 — Industry news (whitelist via Tavily site-restriction)
// ─────────────────────────────────────────────────────────────

const NEWS_WHITELIST = [
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

const FIELD_NEWS_QUERY: Record<PlayerField, string> = {
  hq: "headquarters location",
  founded: "founded history",
  product: "products technology",
  capacity: "production capacity GWh tons annual",
  share: "market share percentage",
  revenue: "revenue annual financial billion million",
  customers: "customers partnership supply contract",
  status: "IPO listed ticker traded",
};

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
};

async function tavilyHarvest(opts: {
  apiKey: string;
  query: string;
  includeDomains?: string[];
  maxResults?: number;
}): Promise<Array<{ url: string; title: string; content: string }>> {
  if (!opts.apiKey) return [];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    const body: Record<string, unknown> = {
      api_key: opts.apiKey,
      query: opts.query,
      max_results: opts.maxResults ?? 5,
      search_depth: "advanced",
    };
    if (opts.includeDomains && opts.includeDomains.length > 0) {
      body.include_domains = opts.includeDomains;
    }
    const resp = await fetch(TAVILY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return [];
    const data = (await resp.json()) as { results?: TavilyResult[] };
    return (data.results ?? []).flatMap((r) =>
      r.url && r.title && r.content ? [{ url: r.url, title: r.title, content: r.content }] : []
    );
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// Resolver 4 — SEC/HKEX filings (Tavily site-restricted)
// ─────────────────────────────────────────────────────────────
// Direct EDGAR Full-Text Search would require an EDGAR client + 10-K HTML
// parsing — out of PR-3.6 scope. Site-restricted Tavily gives us a working
// approximation: any SEC/HKEX page mentioning <company> + <field> qualifies.

const FILINGS_DOMAINS = ["sec.gov", "hkexnews.hk", "investor.gov", "www1.hkexnews.hk"];

// ─────────────────────────────────────────────────────────────
// Main orchestrator: augment one cell with the 4-resolver chain
// ─────────────────────────────────────────────────────────────

type ResolverHit = {
  value: string;
  url: string;
  title: string;
  provenance: LitReviewSource["provenance"];
};

async function resolveCell(opts: {
  apiKey: string;
  tavilyKey: string;
  company: string;
  field: PlayerField;
  infobox: WikiInfobox | null;
  corpText: { url: string; text: string } | null;
  topicKeywords: string[];
}): Promise<ResolverHit | null> {
  const { company, field, infobox, corpText, topicKeywords } = opts;

  // 1. Wikipedia infobox (deterministic).
  if (infobox) {
    const raw = pickWikiField(infobox, field);
    if (raw && validateValue(raw, field)) {
      return {
        value: raw.length > 120 ? raw.slice(0, 117) + "..." : raw,
        url: infobox.pageUrl,
        title: `Wikipedia — ${infobox.pageTitle}`,
        provenance: "wikipedia_infobox",
      };
    }
  }

  // 2. Corp /about LLM extract (only if we have a verified homepage page).
  if (corpText) {
    const v = await narrowExtract({
      apiKey: opts.apiKey,
      company,
      field,
      sourceText: corpText.text,
      sourceUrl: corpText.url,
      label: "litreview/augment-corp",
      topicKeywords,
    });
    if (v) {
      return {
        value: v,
        url: corpText.url,
        title: `${company} — official site (/about)`,
        provenance: "corp_site",
      };
    }
  }

  // 3. Industry news whitelist via Tavily.
  if (opts.tavilyKey) {
    const newsHits = await tavilyHarvest({
      apiKey: opts.tavilyKey,
      query: `"${company}" ${FIELD_NEWS_QUERY[field]}`,
      includeDomains: NEWS_WHITELIST,
      maxResults: 3,
    });
    for (const hit of newsHits) {
      const v = await narrowExtract({
        apiKey: opts.apiKey,
        company,
        field,
        sourceText: hit.content,
        sourceUrl: hit.url,
        label: "litreview/augment-news",
        topicKeywords,
      });
      if (v) {
        return {
          value: v,
          url: hit.url,
          title: hit.title,
          provenance: "industry_news",
        };
      }
    }
  }

  // 4. SEC / HKEX filings via Tavily site-restriction.
  if (opts.tavilyKey) {
    const filingHits = await tavilyHarvest({
      apiKey: opts.tavilyKey,
      query: `"${company}" ${FIELD_NEWS_QUERY[field]}`,
      includeDomains: FILINGS_DOMAINS,
      maxResults: 3,
    });
    for (const hit of filingHits) {
      const v = await narrowExtract({
        apiKey: opts.apiKey,
        company,
        field,
        sourceText: hit.content,
        sourceUrl: hit.url,
        label: "litreview/augment-filing",
        topicKeywords,
      });
      if (v) {
        return {
          value: v,
          url: hit.url,
          title: hit.title,
          provenance: hit.url.includes("hkex") ? "hkex" : "sec_edgar",
        };
      }
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// Top-level entry — mutates report.comparativeTables + report.sources
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// PR-3.6.3 — pre-render cell-count assert (ap-ba v2 review issue #3)
// ─────────────────────────────────────────────────────────────
// LLM occasionally emits row.cells.length > columns.length-1 (e.g. v2 H2
// Tab.1 HQ row had 6 cells for 5 column headers; LFP HQ 7 for 6). The extra
// cells shift downstream alignment and produce ghost "Россия | Россия" tails.
// We collapse to expected count (drop tail) or pad with "—" if short.

export function normalizeTableCellCounts(report: LitReviewReport): {
  fixedRows: number;
  droppedCells: number;
  paddedCells: number;
} {
  let fixedRows = 0;
  let droppedCells = 0;
  let paddedCells = 0;
  for (const table of report.comparativeTables) {
    const expected = Math.max(0, table.columns.length - 1);
    if (expected === 0) continue;
    for (const row of table.rows) {
      if (row.cells.length === expected) continue;
      fixedRows++;
      if (row.cells.length > expected) {
        droppedCells += row.cells.length - expected;
        row.cells = row.cells.slice(0, expected);
      } else {
        const pad = expected - row.cells.length;
        paddedCells += pad;
        for (let i = 0; i < pad; i++) row.cells.push("—");
      }
    }
  }
  return { fixedRows, droppedCells, paddedCells };
}

// ─────────────────────────────────────────────────────────────
// PR-3.6.1 — LLM-cell anti-fab validation (ap-ba v2 review issue #2c)
// ─────────────────────────────────────────────────────────────
// Augmenter validates its own outputs (substring + format regex). LLM-filled
// cells (those in the synth-emitted table before augmenter runs) had NO
// validation. ap-ba v2 spot-check: 2/5 sampled LLM cells = hallucinations
// (Plug Power HQ = "Китай (Сиань)" mis-attributed from Longi's row; LFP
// "Российские проекты" share = "14% Q2 2025" actually citing an LNG export
// article). 40% fail rate.
//
// Fix: for each non-empty LLM cell, require either substring-match in the
// snippets of its cited sourceRefs, OR pass the field-format validator.
// Strict: BOTH the substring AND the field-format must hold (anti-fab is the
// product's core promise — over-rejecting is preferable to over-passing).
// Failing cells reset to "—" so the augmenter's resolver chain gets a second
// shot.

export function validateLLMCells(opts: {
  report: LitReviewReport;
  enrichmentSnippets: Map<string, string>;
}): { resetCount: number; checkedCount: number } {
  const player = findPlayerTable(opts.report);
  if (!player) return { resetCount: 0, checkedCount: 0 };

  const table = opts.report.comparativeTables[player.tableIdx];
  // ref → snippet text (concat URL → snippet for quick row-level lookup).
  const refToSnippet = new Map<number, string>();
  for (const s of opts.report.sources) {
    const snip = opts.enrichmentSnippets.get(s.url);
    if (snip) refToSnippet.set(s.ref, snip);
  }

  let resetCount = 0;
  let checkedCount = 0;
  for (const fieldRow of player.fieldRows) {
    const row = table.rows[fieldRow.row];
    for (const companyCol of player.companyCols) {
      const cellIdx = companyCol.col;
      const cellRaw = row.cells[cellIdx] ?? "";
      if (EMPTY_CELL_RE.test(cellRaw)) continue;
      // Already augmented? Augmenter writes `value [N]` with a trailing ref.
      // Trust augmenter's own validation, skip re-check.
      if (/\[\d+\]\s*$/.test(cellRaw.trim())) continue;

      checkedCount++;
      // Strip any inline [N] refs for value-only checks (LLM may have added
      // them inline copying our augmenter style).
      const valueClean = cellRaw.replace(/\s*\[\d+(?:,\s*\d+)*\]\s*/g, "").trim();
      if (!valueClean) {
        row.cells[cellIdx] = "—";
        resetCount++;
        continue;
      }

      // Field-format regex (length + content shape) — required.
      const fmtOk = validateValue(valueClean, fieldRow.field);
      if (!fmtOk) {
        row.cells[cellIdx] = "—";
        resetCount++;
        continue;
      }

      // Substring match — required when we have cited refs to check against.
      // If no refs cited (LLM didn't attribute), we can't verify → fail safe.
      const refs = Array.isArray(row.sourceRefs) ? row.sourceRefs : [];
      const sourceText = refs.map((r) => refToSnippet.get(r) ?? "").join(" ");
      if (!sourceText.trim()) {
        row.cells[cellIdx] = "—";
        resetCount++;
        continue;
      }
      if (!substringMatches(valueClean, sourceText)) {
        row.cells[cellIdx] = "—";
        resetCount++;
      }
    }
  }
  return { resetCount, checkedCount };
}

export type AugmentationStats = {
  cellsAttempted: number;
  cellsFilled: number;
  byProvenance: Record<string, number>;
  byField: Record<PlayerField, { attempted: number; filled: number }>;
};

const EMPTY_CELL_RE = /^[—\-–.\s?]*$/;

export async function augmentReportTables(opts: {
  apiKey: string;
  tavilyKey: string;
  report: LitReviewReport;
  /** PR-3.6.1.2 (ap-ba v2.1 review issue #2): topic-relevant terms used to
   *  gate the narrow-extract LLM call. If a source page mentions none of
   *  these, augmenter skips it — prevents "Siemens HQ = airports Dubai"
   *  (Siemens Digital Logistics filing) and similar wrong-subsidiary picks. */
  topicKeywords?: string[];
}): Promise<AugmentationStats> {
  const stats: AugmentationStats = {
    cellsAttempted: 0,
    cellsFilled: 0,
    byProvenance: {},
    byField: {
      hq: { attempted: 0, filled: 0 },
      founded: { attempted: 0, filled: 0 },
      product: { attempted: 0, filled: 0 },
      capacity: { attempted: 0, filled: 0 },
      share: { attempted: 0, filled: 0 },
      revenue: { attempted: 0, filled: 0 },
      customers: { attempted: 0, filled: 0 },
      status: { attempted: 0, filled: 0 },
    },
  };

  const player = findPlayerTable(opts.report);
  if (!player) {
    console.info("[litreview/augment] no players table detected — skipping");
    return stats;
  }

  const table = opts.report.comparativeTables[player.tableIdx];
  const ctx: AugmentationContext = { report: opts.report, newRefsByUrl: new Map() };

  // Per-company prefetch: one Wiki call + one corp /about fetch reused across
  // all that company's cells. This is the difference between 5-resolver-calls
  // and 5×7=35 — we share the heavy fetch.
  const perCompany = new Map<string, { infobox: WikiInfobox | null; corpText: { url: string; text: string } | null }>();
  for (const c of player.companyCols) {
    const infobox = await fetchWikipediaInfobox(c.name);
    // Politeness: 300ms between Wikipedia calls (sources.ts uses the same).
    await delay(300);
    const homepage = await resolveCorpHomepage(c.name, infobox);
    const corpText = homepage ? await fetchCorpAbout(homepage) : null;
    perCompany.set(c.name, { infobox, corpText });
  }

  // For each (company, field) where cell is empty, run the resolver chain.
  for (const fieldRow of player.fieldRows) {
    const row = table.rows[fieldRow.row];
    for (const companyCol of player.companyCols) {
      const cellIdx = companyCol.col;
      const current = row.cells[cellIdx] ?? "";
      if (!EMPTY_CELL_RE.test(current)) continue; // already filled by LLM — leave alone

      stats.cellsAttempted++;
      stats.byField[fieldRow.field].attempted++;
      const prefetch = perCompany.get(companyCol.name);
      if (!prefetch) continue;

      const hit = await resolveCell({
        apiKey: opts.apiKey,
        tavilyKey: opts.tavilyKey,
        company: companyCol.name,
        field: fieldRow.field,
        infobox: prefetch.infobox,
        corpText: prefetch.corpText,
        topicKeywords: opts.topicKeywords ?? [],
      });
      if (!hit) continue;

      const ref = registerSource(ctx, hit.url, hit.title, hit.provenance);
      row.cells[cellIdx] = `${hit.value} [${ref}]`;
      if (!row.sourceRefs.includes(ref)) row.sourceRefs.push(ref);
      stats.cellsFilled++;
      stats.byField[fieldRow.field].filled++;
      stats.byProvenance[hit.provenance] = (stats.byProvenance[hit.provenance] ?? 0) + 1;
    }
  }

  console.info("[litreview/augment] complete", {
    tableIdx: player.tableIdx,
    companies: player.companyCols.length,
    fieldRows: player.fieldRows.length,
    cellsAttempted: stats.cellsAttempted,
    cellsFilled: stats.cellsFilled,
    fillRatePct: stats.cellsAttempted
      ? Math.round((stats.cellsFilled / stats.cellsAttempted) * 100)
      : 0,
    byProvenance: stats.byProvenance,
  });

  return stats;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────
// Topic-keyword extraction (used by augmentReportTables guard)
// ─────────────────────────────────────────────────────────────
// Heuristic: tokenize a corpus of (topic + hypotheses + Stage-1 queries),
// drop common stopwords, return de-duped >=3-char tokens. We don't need
// perfect keyword extraction here — the guard is a coarse filter ("does this
// SEC filing mention anything about the topic?") not a relevance scorer.

const STOPWORDS = new Set<string>([
  // Russian high-freq
  "что", "это", "для", "или", "как", "при", "под", "над", "из", "от",
  "обзор", "обзора", "обзоре", "мира", "мире", "мировой", "мировая",
  "мировые", "россии", "россия", "рынка", "рынке", "рынок", "годы",
  "года", "году", "также", "более", "менее", "является", "являются",
  "может", "могут", "должн", "необходимо", "включает", "также",
  // English high-freq
  "the", "and", "for", "with", "from", "this", "that", "are", "was",
  "were", "have", "has", "had", "will", "would", "world", "global",
  "review", "industry", "market", "company", "companies", "year",
  "years", "production", "manufacturer",
]);

export function deriveTopicKeywords(opts: {
  topic: string;
  hypotheses?: string;
  extraQueries?: string[];
}): string[] {
  const blob = [
    opts.topic,
    opts.hypotheses ?? "",
    ...(opts.extraQueries ?? []),
  ].join(" ").toLowerCase();
  const tokens = blob
    .split(/[^\wЀ-ӿ]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
  return Array.from(new Set(tokens));
}
