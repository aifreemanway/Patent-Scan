// PR-3.5 fix-list: source sanitization layer.
//
// Two independent passes catch different failure modes:
//
//   1. Domain blacklist (cheap, deterministic) — strips known-garbage hosts
//      that Tavily returns on noisy queries: gaming/MMO worlds, classroom
//      learning tools, PHP/code decoders, content farms. Verified offenders
//      from BUG-LIT-1: unphp.net, evemaps.dotlan.net (EVE Online corp pages),
//      classtools.net (fishbone diagrams, learning games).
//
//   2. LLM relevance filter (Gemini Flash, batched) — culls sources that pass
//      the domain check but are topically off (BUG-LIT-2: лит-ион батареи
//      в обзоре про H2-электролизёры — both на электрохимии, both от
//      authoritative source like rospatent.gov.ru, blacklist won't help).
//
// Together: blacklist drops ~5% (the obvious junk); LLM filter drops 20-40%
// more (the «топик-смежно» noise). Final sources list reaches synth clean.

import { callGeminiJson } from "@/lib/gemini";

// ── Pass 1: domain blacklist ──────────────────────────────────
// Categorised so a future addition is obvious; the runtime check just unions
// all entries into one Set. Subdomains match via .endsWith() — so
// "fandom.com" catches "fallout.fandom.com" too.

const BLACKLISTED_HOSTS: ReadonlyArray<string> = [
  // BUG-LIT-1 GLP-1 sample: garbage URLs in §5
  "unphp.net",
  "evemaps.dotlan.net",
  "classtools.net",

  // Gaming / MMO ecosystems — wiki/forum/tool subdomains drift in via
  // ambient web search on technical terms (EVE Online has "industry",
  // "minerals", "transport" pages that score on metallurgy queries).
  "eveonline.com",
  "warthunder.com",
  "stockfish.online",

  // Wiki / fandom networks — usually not authoritative for science/eng.
  // Wikipedia REST is harvested separately and IS allowed.
  "fandom.com",
  "wikia.com",
  "gamepedia.com",

  // Learning-tool / template hosts
  "classroom.google.com",
  "kahoot.com",
  "quizizz.com",
  "miro.com",

  // Aggregator / spam / clone hosts
  "scribd.com",
  "academia.edu",          // requires login wall, abstracts often missing
  "researchgate.net",      // same — login wall, anti-fab fail-mode
  "z-lib.org",
  "libgen",
  "annas-archive",

  // Code/PHP decoders / pastebins
  "pastebin.com",
  "hastebin.com",
  "ghostbin.co",
  "phpdecoder",
  "decode.online",

  // Social platforms (rarely citable in a litreview; if they show up they're
  // usually a content-marketing rehash of a real source).
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "reddit.com",
  "vk.com",
  "ok.ru",
  "t.me",
  "telegram.me",

  // Marketplaces — same logic
  "ozon.ru",
  "wildberries.ru",
  "amazon.com",
  "ebay.com",
  "aliexpress.com",
];

const BLACKLIST_SET = new Set(BLACKLISTED_HOSTS.map((h) => h.toLowerCase()));

/**
 * Parse a URL's lowercased hostname. Returns null on malformed input so
 * callers can decide the fail-mode (blacklist treats null as "block").
 * Shared so source-tier.ts uses the exact same host extraction.
 */
export function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Suffix / exact / substring domain match — the same mechanism the blacklist
 * uses, extracted so source-tier.ts (TIER_MAP) reuses one matcher.
 *
 * - Exact host match against an entry.
 * - Subdomain match: any parent-domain suffix in the set (".endsWith"-style),
 *   so "elibrary.ru" catches "www.elibrary.ru".
 * - Substring match for dotless partial entries like "studfile", "libgen".
 *
 * `host` must already be lowercased (use hostFromUrl).
 */
export function hostMatchesSet(host: string, set: Set<string>): boolean {
  // Direct match
  if (set.has(host)) return true;
  // Subdomain match: check progressively shorter suffixes
  const parts = host.split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    const suffix = parts.slice(i).join(".");
    if (set.has(suffix)) return true;
  }
  // Substring match for partial entries like "phpdecoder", "libgen"
  for (const entry of set) {
    if (!entry.includes(".") && host.includes(entry)) return true;
  }
  return false;
}

/** True if the URL's host (or any parent domain) is in the blacklist. */
export function isBlacklistedUrl(url: string): boolean {
  const host = hostFromUrl(url);
  // Malformed URL = treat as blacklisted (can't be a real source).
  if (host === null) return true;
  return hostMatchesSet(host, BLACKLIST_SET);
}

// ── Pass 2: LLM relevance filter ──────────────────────────────
// We give Gemini a topic + a batch of (ref, title, snippet) entries and ask
// it to return refs that are CLEARLY off-topic. Conservative bias: «keep
// unless obviously irrelevant» — false positives on relevance kill recall
// (the whole point of a litreview is broad coverage), false negatives on
// noise just embarrass us. The synth stage is the safety net for borderline.

const RELEVANCE_PROMPT = `Ты — фильтр релевантности для литературного обзора. На вход — тема обзора и список найденных источников. Найди источники, которые ЯВНО НЕ ОТНОСЯТСЯ к теме (отбросить нужно ТОЛЬКО очевидно не-в-тему — спорные оставляем).

Примеры явной нерелевантности:
- Тема "водородные электролизёры" + источник про литий-тионилхлоридные батареи (другая электрохимия)
- Тема "GLP-1 агонисты" + источник про игру EVE Online или учебную диаграмму fishbone
- Тема "LFP батареи" + источник про nonwoven композитные ткани

Правила:
- Спорные оставляем (false positives критичны: убьём recall)
- Если источник про смежную область, но с реальной связью с темой — оставляем
- Если источник на тему-омоним (например "share" как доля рынка vs "share" как акция) — отбрасываем

Верни СТРОГО валидный JSON:
{
  "irrelevantRefs": [3, 17, 42],
  "reasonByRef": {
    "3": "литий-батареи в обзоре про H2-электролизёры",
    "17": "EVE Online не имеет отношения к GLP-1",
    "42": "nonwoven ткани, не водород"
  }
}`;

type RelevanceItem = { ref: number; title: string; snippet?: string };
type RelevanceOutput = {
  irrelevantRefs?: number[];
  reasonByRef?: Record<string, string>;
};

const RELEVANCE_BATCH_SIZE = 50;
const SNIPPET_TRIM = 300;

export type RelevanceFilterResult = {
  keptRefs: Set<number>;
  droppedRefs: Map<number, string>;
};

export async function filterByRelevance(opts: {
  apiKey: string;
  topic: string;
  items: RelevanceItem[];
}): Promise<RelevanceFilterResult> {
  if (!opts.apiKey || opts.items.length === 0) {
    return { keptRefs: new Set(opts.items.map((i) => i.ref)), droppedRefs: new Map() };
  }

  const allRefs = new Set(opts.items.map((i) => i.ref));
  const dropped = new Map<number, string>();

  // Batch (Gemini Flash 8k output cap; 50 items × ~80 chars each = 4k input — safe).
  for (let i = 0; i < opts.items.length; i += RELEVANCE_BATCH_SIZE) {
    const batch = opts.items.slice(i, i + RELEVANCE_BATCH_SIZE);
    const userText = [
      `ТЕМА ОБЗОРА: ${opts.topic}`,
      ``,
      `ИСТОЧНИКИ (${batch.length}):`,
      JSON.stringify(
        batch.map((it) => ({
          ref: it.ref,
          title: it.title.slice(0, 200),
          snippet: it.snippet?.slice(0, SNIPPET_TRIM),
        })),
        null,
        2
      ),
    ].join("\n");

    try {
      const { data } = await callGeminiJson<RelevanceOutput>({
        apiKey: opts.apiKey,
        label: "litreview/relevance-filter",
        systemPrompt: RELEVANCE_PROMPT,
        userText,
        timeoutMs: 60_000,
      });
      const irrelevantRefs = Array.isArray(data.irrelevantRefs) ? data.irrelevantRefs : [];
      for (const ref of irrelevantRefs) {
        if (typeof ref !== "number") continue;
        const reason = data.reasonByRef?.[String(ref)] ?? "off-topic";
        dropped.set(ref, reason);
      }
    } catch (e) {
      // Filter failure shouldn't block synthesis — log + skip this batch.
      // Worst case: a few off-topic sources slip through (recoverable; the
      // domain blacklist already caught the worst).
      console.error("[litreview/relevance] batch failed", {
        batchStart: i,
        batchSize: batch.length,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const kept = new Set([...allRefs].filter((r) => !dropped.has(r)));
  return { keptRefs: kept, droppedRefs: dropped };
}
