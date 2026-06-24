// Runtime patent-link validator — enforces source-link-invariant AC п.4 /
// BUG-AC-2: every customer-facing patent link must RESOLVE; a dead link is
// treated as "no link" (the report then shows «источник не определён»).
//
// Why this is non-trivial (verified empirically 2026-06-24):
//   • Google Patents `/patent/{pn}` (foreign): 200 for a real patent, 404 for a
//     missing one → HTTP status is a reliable signal.
//   • ФИПС registers-doc-view (RU): returns 200 EVEN FOR A MISSING DOC, but the
//     stub is tiny (~37 bytes) vs a real doc (~25 KB) → use Content-Length.
//   • Search urls (Google `/?q=`, Espacenet `/patent/search`): always 200 and
//     resolve the number to its document → never need checking.
// HEAD requests give both signals (status + Content-Length) without downloading
// the page body, so validating even a 396-patent landscape stays cheap.
//
// Anti-fab discipline: we only REMOVE/downgrade a link we KNOW is dead
// (definitive 404 / tiny ФИПС stub). A link we merely couldn't verify (timeout,
// network blip, 5xx, HEAD unsupported) is KEPT as-is — the patent came from a
// real PatSearch hit via verified url rules, so a transient fetch failure must
// not strip a good link (else a ФИПС outage would blank every RU source).

import { googleSearchUrl } from "./patsearch-normalize";

type Verdict = "ok" | "broken" | "unverified";

type CacheEntry = { verdict: Verdict; expires: number };

// A patent's existence is stable, so a known verdict caches for a week. We do
// NOT cache "unverified" (transient) — retry it next time.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

const TIMEOUT_MS = 8_000;
const CONCURRENCY = 12;
// ФИПС missing-doc stub observed at 37 bytes; a real doc is tens of KB. 800 is a
// safe floor well above any error stub and far below a real document.
const FIPS_MIN_BYTES = 800;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Search-form urls always resolve — skip the network check entirely. */
export function isAlwaysResolvable(url: string): boolean {
  if (!url) return false;
  return (
    url.includes("patents.google.com/?q=") ||
    url.includes("worldwide.espacenet.com/patent/search")
  );
}

function isFips(url: string): boolean {
  return url.includes("new.fips.ru/");
}

/** Verify one patent url. Pure aside from the module cache; never throws. */
export async function checkPatentUrl(url: string): Promise<Verdict> {
  if (!url) return "broken";
  if (isAlwaysResolvable(url)) return "ok";

  const cached = cache.get(url);
  if (cached && cached.expires > Date.now()) return cached.verdict;

  let verdict: Verdict = "unverified";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": BROWSER_UA },
      signal: ctrl.signal,
      redirect: "follow",
    });

    if (isFips(url)) {
      // ФИПС: 200 always; the doc's existence shows in the body size.
      if (!resp.ok) {
        verdict = "unverified"; // non-200 from ФИПС is unusual → don't punish
      } else {
        const clenHeader = resp.headers.get("content-length");
        if (clenHeader != null) {
          verdict = Number(clenHeader) >= FIPS_MIN_BYTES ? "ok" : "broken";
        } else {
          // No Content-Length on HEAD — fall back to a tiny ranged GET.
          const g = await fetch(url, {
            method: "GET",
            headers: { "User-Agent": BROWSER_UA, Range: "bytes=0-2047" },
            signal: ctrl.signal,
          });
          const text = await g.text();
          verdict = g.ok && text.length >= FIPS_MIN_BYTES ? "ok" : "broken";
        }
      }
    } else {
      // Google Patents direct (and other direct doc pages): status is reliable.
      // 404/410 → definitively gone; other non-2xx → transient/unverified.
      if (resp.ok) verdict = "ok";
      else if (resp.status === 404 || resp.status === 410) verdict = "broken";
      else verdict = "unverified";
    }
  } catch {
    verdict = "unverified"; // timeout / network / abort
  } finally {
    clearTimeout(timer);
  }

  // Only cache definitive verdicts; let "unverified" be retried next time.
  if (verdict !== "unverified") {
    cache.set(url, { verdict, expires: Date.now() + TTL_MS });
  }
  return verdict;
}

export type LinkedHit = { id: string; country: string; url: string };

/**
 * Validate every hit's link (concurrency-limited) and apply the AC invariant:
 *   • ok / unverified → keep the link unchanged;
 *   • DEFINITIVELY broken →
 *       – foreign: downgrade the dead `/patent/{pn}` link to a Google SEARCH
 *         url, which always resolves and lands on the right document;
 *       – RU/SU: clear the link (ФИПС is the authoritative first source and AC
 *         #1 forbids Google as the primary RU source) → the report shows
 *         «источник не определён».
 * Returns a NEW array of shallow-copied hits; inputs are not mutated.
 */
export async function validatePatentLinks<T extends LinkedHit>(
  hits: T[]
): Promise<T[]> {
  const out = hits.map((h) => ({ ...h }));
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < out.length) {
      const h = out[cursor++];
      if (!h.url || isAlwaysResolvable(h.url)) continue;
      const verdict = await checkPatentUrl(h.url);
      if (verdict !== "broken") continue;
      const cc = (h.country || "").toUpperCase();
      h.url = cc === "RU" || cc === "SU" ? "" : googleSearchUrl(h.id);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, out.length) }, () => worker())
  );
  return out;
}
