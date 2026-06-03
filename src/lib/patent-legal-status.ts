// RU patent legal-status fetcher (Этап 1, RU-only).
//
// SOURCE OF TRUTH: the ФИПС registers-doc-view HTML page. PatSearch /docs does
// NOT carry legal status. The page is server-rendered (HTTP 200, browser UA, no
// JS, no auth) in **windows-1251** encoding and contains a clean status block:
//   "Статус: действует (последнее изменение статуса: 24.10.2025) ...
//    Пошлина: учтена за 5 год ..."
//
// ANTI-FAB (RISK-CRITICAL — legally significant, customer-facing):
//   - Never guess. Never infer status from the patent's age/year.
//   - No legal interpretation ("можно использовать") — factual status only.
//   - ANY fetch error / non-200 / parse miss / ambiguous phrase / non-RU number
//     resolves to "не определён" (the safe fallback) — NOT to "действует".
//   - Always carry an extraction date (today) + a link to the ФИПС page itself.

// 5 badge states. Russian phrasing matches the PRD chips.
export type LegalStatusState =
  | "действует"
  | "не действует"
  | "восстановим"
  | "истёк"
  | "не определён";

export type LegalStatus = {
  state: LegalStatusState;
  /** Raw "Статус: ..." phrase from ФИПС (factual, untranslated), or null on miss. */
  statusText: string | null;
  /** "(последнее изменение статуса: DD.MM.YYYY)" date, or null. */
  lastChangeDate: string | null;
  /** The "Пошлина: ..." line (fee/maintenance info), or null. */
  feeInfo: string | null;
  /** ISO date (YYYY-MM-DD) the status was extracted — always today. */
  extractedAt: string;
  /** Link to the ФИПС registers-doc-view page (the source — NOT Google Patents). */
  sourceUrl: string;
};

// In-memory module-level cache. STABLE statuses (действует / не действует /
// истёк) change ~1x/year, so a 14-day TTL is safe and keeps a 400-patent
// landscape from re-fetching ФИПС every load. TRANSITIONAL statuses (восстановим
// = ФИПС "может прекратить" — a fee window in flux — and не определён) are
// time-sensitive and can flip within days as a deadline passes, so they get a
// short 1-day TTL: the cache never outlives the window (ba qgate 2026-06-03).
// Etap1 deliberately stays in-memory (no Upstash); a restart re-warms it.
const TTL_STABLE_MS = 14 * 24 * 60 * 60 * 1000;
const TTL_TRANSITIONAL_MS = 24 * 60 * 60 * 1000;
function ttlFor(state: LegalStatusState): number {
  return state === "восстановим" || state === "не определён"
    ? TTL_TRANSITIONAL_MS
    : TTL_STABLE_MS;
}
const cache = new Map<string, { value: LegalStatus; expires: number }>();

const FETCH_TIMEOUT_MS = 12_000;
const MAX_CONCURRENCY = 8;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Strip the trailing region/kind chars off an id and keep only digits. */
function digitsOnly(ruNumber: string): string {
  return String(ruNumber ?? "").replace(/\D/g, "");
}

export function fipsUrl(numericNumber: string): string {
  return (
    "https://new.fips.ru/registers-doc-view/fips_servlet?DB=RUPAT&DocNumber=" +
    numericNumber +
    "&TypeFile=html"
  );
}

// De-tag the windows-1251 HTML into a single whitespace-normalized text run.
function deTag(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// Labels that terminate the "Статус:" value on the ФИПС page. We cut the status
// phrase at the first of these so we don't swallow the whole fee paragraph.
const STATUS_TERMINATORS = [
  "Начисление",
  "Пошлина:",
  "Извещения",
  "Адрес для переписки",
  "Дата прекращения",
];

type Parsed = {
  statusText: string;
  lastChangeDate: string | null;
  feeInfo: string | null;
};

// Pull the "Статус: <phrase> (последнее изменение статуса: DD.MM.YYYY)" block
// and the "Пошлина: <...>" line out of the de-tagged text. Returns null on miss.
function parseStatusBlock(clean: string): Parsed | null {
  const m = /Статус\s*:\s*/.exec(clean);
  if (!m) return null;
  const after = clean.slice(m.index + m[0].length);
  if (!after) return null;

  // Cut at the earliest terminator label (keeps the parenthetical date in).
  let end = after.length;
  for (const term of STATUS_TERMINATORS) {
    const i = after.indexOf(term);
    if (i >= 0 && i < end) end = i;
  }
  const statusText = after.slice(0, end).trim();
  if (!statusText) return null;

  const dateMatch = /последнее изменение статуса\s*:\s*(\d{2}\.\d{2}\.\d{4})/.exec(
    statusText
  );
  const lastChangeDate = dateMatch ? dateMatch[1] : null;

  // Fee line: "Пошлина: ..." up to the next sentence/label, capped.
  let feeInfo: string | null = null;
  const feeM = /Пошлина\s*:\s*/.exec(after);
  if (feeM) {
    const feeRaw = after.slice(feeM.index + feeM[0].length, feeM.index + feeM[0].length + 600);
    const trimmed = feeRaw.replace(/\s+Извещения[\s\S]*$/, "").trim();
    if (trimmed) feeInfo = trimmed.slice(0, 400);
  }

  return { statusText, lastChangeDate, feeInfo };
}

// Map the factual ФИПС status phrase to one of the 5 badge states.
// Order matters: negatives/restoration are checked before the bare "действует".
export function mapStatusToState(phrase: string): LegalStatusState {
  const s = phrase.toLowerCase();

  // Term expiry — 20-year statutory term ran out.
  if (/истек\w* срок действия|истёк\w* срок действия|срок действия .*истек/.test(s)) {
    return "истёк";
  }

  // Restoration window / "may cease" — yellow. ФИПС phrasings:
  //   "может прекратить свое действие", "прекратил действие ... может быть восстановлен".
  const restorable =
    /может быть восстановл/.test(s) ||
    /может прекратить/.test(s) ||
    /восстановлен\w* действие/.test(s);
  if (restorable) return "восстановим";

  // Lapsed / ceased without a restoration note — grey.
  if (
    /прекратил\w* действие/.test(s) ||
    /прекращен/.test(s) ||
    /не действует/.test(s)
  ) {
    return "не действует";
  }

  // Active — only if it positively says "действует" and none of the above hit.
  if (/действует/.test(s)) return "действует";

  // Anything unmapped / ambiguous → safe fallback (anti-fab).
  return "не определён";
}

function notDetermined(numericNumber: string): LegalStatus {
  return {
    state: "не определён",
    statusText: null,
    lastChangeDate: null,
    feeInfo: null,
    extractedAt: todayIso(),
    sourceUrl: fipsUrl(numericNumber),
  };
}

/**
 * Fetch + parse + map the legal status of a single RU patent from ФИПС.
 * Pure (no shared mutation beyond the cache); never logs secrets.
 * ANY failure mode → state "не определён" (still carries sourceUrl + extractedAt).
 */
export async function fetchRuLegalStatus(ruNumber: string): Promise<LegalStatus> {
  const num = digitsOnly(ruNumber);
  if (!num) return notDetermined(num);

  const cached = cache.get(num);
  if (cached && cached.expires > Date.now()) return cached.value;

  const url = fipsUrl(num);
  let result: LegalStatus;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
      signal: controller.signal,
    });
    if (!resp.ok) {
      result = notDetermined(num);
    } else {
      // ФИПС serves windows-1251 — decode explicitly or "Статус" is mojibake.
      const buf = await resp.arrayBuffer();
      const html = new TextDecoder("windows-1251").decode(buf);
      const clean = deTag(html);
      const parsed = parseStatusBlock(clean);
      if (!parsed) {
        result = notDetermined(num);
      } else {
        const state = mapStatusToState(parsed.statusText);
        result = {
          state,
          statusText: parsed.statusText.slice(0, 300),
          lastChangeDate: parsed.lastChangeDate,
          feeInfo: parsed.feeInfo,
          extractedAt: todayIso(),
          sourceUrl: url,
        };
      }
    }
  } catch {
    // Timeout / network / decode error — anti-fab fallback, no secret logging.
    result = notDetermined(num);
  } finally {
    clearTimeout(timer);
  }

  cache.set(num, { value: result, expires: Date.now() + ttlFor(result.state) });
  return result;
}

/**
 * Concurrency-limited batch over fetchRuLegalStatus (max ~8 in flight), for the
 * landscape (up to ~400 patents). Reuses the module cache. Keyed by the numeric
 * RU number string. Non-RU / blank inputs are skipped by the caller.
 */
export async function fetchRuLegalStatuses(
  ruNumbers: string[]
): Promise<Record<string, LegalStatus>> {
  // De-dupe by numeric key while keeping a map back to the requested keys.
  const out: Record<string, LegalStatus> = {};
  const unique = Array.from(
    new Set(ruNumbers.map((n) => digitsOnly(n)).filter(Boolean))
  );

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < unique.length) {
      const num = unique[cursor++];
      out[num] = await fetchRuLegalStatus(num);
    }
  }

  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENCY, unique.length) },
    () => worker()
  );
  await Promise.all(workers);
  return out;
}
