// Deterministic cell hygiene for the comparative tables (design §3 «Гигиена §4A»).
// Pure string transforms — NO network, NO LLM, anti-fab: never invents content,
// only strips markup and normalises empties to a visible placeholder «—».
//
// Why here (lib, shared) and not only in render-html.ts: the canonical table
// model (LitReviewReport.comparativeTables) is serialised to MARKDOWN in
// worker/literature-review/markdown.ts, and that .md is the stored artefact
// (email links to it) AND the input the HTML renderer (`marked`) re-parses.
// So the single correct boundary to clean a cell value is where it becomes
// markdown — markdown.ts — using these helpers. render-html.ts inherits the
// cleaned values for free. The design doc allows this: «или хелпер при сборке
// табличных значений».

/** Visible placeholder for an absent value. Never invent a real value. */
export const EMPTY_CELL = "—";

/**
 * Strip HTML tags and decode the handful of HTML entities Sonnet/Gemini
 * occasionally emit inside structured cell values (`<sub>`, `&nbsp;`, `<br>`,
 * `&amp;`). Anti-fab: this ONLY removes markup / decodes entities — it never
 * adds or rewrites textual content. Whitespace introduced by removed `<br>`
 * tags is collapsed so a cleaned cell stays single-line for a markdown pipe row.
 */
export function stripHtml(s: string): string {
  if (typeof s !== "string") return "";
  let out = s;
  // <br> / <br/> → space (so "A<br>B" doesn't fuse into "AB").
  out = out.replace(/<br\s*\/?>/gi, " ");
  // Drop every remaining tag (incl. <sub>, <sup>, <b>, <span style=…>, …).
  out = out.replace(/<\/?[a-z][^>]*>/gi, "");
  // Decode the common named/numeric entities. Order: named first, then numeric,
  // then &amp; LAST (so "&amp;lt;" → "&lt;" stays literal, not re-decoded).
  out = out
    .replace(/&nbsp;/gi, " ")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_m, code) => {
      const n = Number(code);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    })
    .replace(/&amp;/gi, "&");
  // Collapse runs of whitespace left behind by removed markup.
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Normalise a single table cell value: strip HTML, then map
 * null/undefined/""/whitespace-only → «—». Anti-fab: an empty source value
 * becomes the visible placeholder, NEVER a fabricated value.
 */
export function cleanCell(value: unknown): string {
  if (value === null || value === undefined) return EMPTY_CELL;
  const stripped = stripHtml(String(value));
  return stripped.length > 0 ? stripped : EMPTY_CELL;
}
