// Design §4 — verify strategy for unreachable DOIs / source links.
//
// This is NETWORK code that runs in the worker (Stage 7) for EVERY paid
// literature review. The hard invariant is FAIL-OPEN: any failure of this
// module (timeout / network / API error / thrown exception) leaves the source
// IN the list with its accessLevel NO WORSE than before. §4 only IMPROVES
// metadata — it never breaks the review and never deletes a source.
//
// Anti-fab: an unreachable DOI is a real primary work (T1). Unreachable ≠
// non-existent. We mark it `unreachable`, we do NOT drop it, and we only ever
// swap its URL to a *really found* open-access mirror of the SAME DOI.

import type { LitReviewAccessLevel } from "./types";

// ── HTTP status → access classification (pure, deterministic) ──────────────
//
// Applied ONLY to the result of a real probe. Callers must NOT downgrade an
// already-correct accessLevel blindly: if the probe never ran (fail-open), the
// existing accessLevel is preserved by the orchestrator, not by this function.
export type ProbeOutcome =
  | { kind: "status"; status: number }   // got an HTTP response
  | { kind: "network" };                 // timeout / DNS / connection reset / abort

/**
 * Map a probe outcome to an accessLevel.
 *   - 2xx                → "open"
 *   - 401 / 403 / 451    → "abstract_only" (paywall / auth-gated)
 *   - 404 / 410          → "unreachable"
 *   - other 4xx/5xx      → "unreachable" (the link does not serve the doc now)
 *   - network/timeout    → "unreachable"
 * Deterministic, no network. Never returns "unknown" — a probe that ran always
 * yields a concrete signal; "unknown" is reserved for "no probe was made".
 */
export function classifyAccess(outcome: ProbeOutcome): LitReviewAccessLevel {
  if (outcome.kind === "network") return "unreachable";
  const s = outcome.status;
  if (s >= 200 && s < 300) return "open";
  if (s === 401 || s === 403 || s === 451) return "abstract_only";
  // 404/410 explicitly, plus any other non-2xx (incl. 5xx) → the link does not
  // resolve to the document at verify time. Honest, conservative.
  return "unreachable";
}

// ── Single-URL probe (GET, hard timeout, fail-open) ────────────────────────
//
// Returns a ProbeOutcome. NEVER throws — an abort/network error becomes
// { kind: "network" }. Uses GET (not HEAD): some DOI resolvers / publishers
// return 405 or misleading codes for HEAD. We do not read the body.
export async function probeUrl(
  url: string,
  timeoutMs = 7000
): Promise<ProbeOutcome> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
    });
    return { kind: "status", status: resp.status };
  } catch {
    // timeout (abort), DNS, connection reset, etc. → treat as network failure.
    return { kind: "network" };
  } finally {
    clearTimeout(t);
  }
}

// ── DOI reroll: find an OA mirror of the SAME work ─────────────────────────
//
// On `unreachable` + a DOI present, try to locate an open-access copy of the
// exact same DOI: OpenAlex first (best_oa_location / oa_url / is_oa), then
// Crossref. If found, the caller swaps `url` and sets accessLevel → "open"
// while KEEPING tier (same primary source). All network is behind a short
// timeout and try/catch — any failure returns null (stays unreachable).

type FetchJson = (url: string, timeoutMs: number) => Promise<unknown>;

/** Default JSON fetcher with hard timeout. Returns null on any failure. */
export async function fetchJsonSafe(
  url: string,
  timeoutMs = 6000
): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Patent-Scan/1.0 (mailto:support@patent-scan.com)",
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function isHttpUrl(u: unknown): u is string {
  return typeof u === "string" && /^https?:\/\//i.test(u);
}

/**
 * Try to find an open-access URL for `doi`. Returns the OA url string, or null
 * if no reachable OA mirror was found. NEVER throws.
 *
 * `fetchJson` is injectable for tests (mock the network). Production passes
 * `fetchJsonSafe`.
 */
export async function rerollOaUrl(
  doi: string,
  fetchJson: FetchJson = fetchJsonSafe,
  timeoutMs = 6000
): Promise<string | null> {
  const bare = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
  if (!bare) return null;

  // 1) OpenAlex by DOI — richest OA signal.
  try {
    const data = (await fetchJson(
      `https://api.openalex.org/works/doi:${encodeURIComponent(bare)}?mailto=support@patent-scan.com`,
      timeoutMs
    )) as
      | {
          open_access?: { is_oa?: boolean; oa_url?: string | null };
          best_oa_location?: { pdf_url?: string | null; landing_page_url?: string | null } | null;
        }
      | null;
    if (data) {
      const oaUrl = data.open_access?.oa_url;
      if (data.open_access?.is_oa && isHttpUrl(oaUrl)) return oaUrl;
      const best = data.best_oa_location;
      if (best) {
        if (isHttpUrl(best.pdf_url)) return best.pdf_url;
        if (isHttpUrl(best.landing_page_url)) return best.landing_page_url;
      }
    }
  } catch {
    // fall through to Crossref
  }

  // 2) Crossref — link array sometimes carries an OA full-text URL.
  try {
    const data = (await fetchJson(
      `https://api.crossref.org/works/${encodeURIComponent(bare)}`,
      timeoutMs
    )) as
      | { message?: { link?: Array<{ URL?: string; "content-type"?: string }> } }
      | null;
    const links = data?.message?.link ?? [];
    for (const l of links) {
      if (isHttpUrl(l.URL)) return l.URL;
    }
  } catch {
    // no OA mirror found
  }

  return null;
}
