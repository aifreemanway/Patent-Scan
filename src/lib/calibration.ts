// Silent-capture calibration metadata.
//
// Every user-facing search already persists its core input→output pair to the
// `search_requests` table. To calibrate the pipeline (recall, IPC targeting,
// genre-fit) we enrich that existing row with a small `calibration` object —
// nested inside the EXISTING `params` jsonb (input-side) and `result` jsonb
// (output-side). No DB migration, no new columns, no schema change.
//
// Per Vsevolod (2026-06): pure silent capture, NO consent UI. The captured
// signal is the user's own input text + derived heuristics — not ПДн under
// 152-ФЗ (no extra personal data beyond the user_id/IP the row already carries).
//
// Everything here is deterministic and side-effect-free; computing it must
// never throw on real input. The write path (search-requests.ts) keeps its
// log-and-continue failure mode, so even an unexpected error never breaks a
// search.

// Minimal stopword set (RU + EN) — high-frequency function words that carry no
// technical signal. Kept deliberately small: the goal is a rough "how many
// distinct content tokens did the user give us" richness proxy, not a real NLP
// tokenizer. Lengthening this list would only shave a few false positives; the
// length≥4 filter already drops most short function words (и, в, на, the, a…).
const STOPWORDS = new Set<string>([
  // Russian
  "этот",
  "того",
  "чтобы",
  "когда",
  "может",
  "если",
  "более",
  "также",
  "после",
  "очень",
  "была",
  "были",
  "было",
  "есть",
  "была",
  "который",
  "которые",
  "которая",
  "будет",
  "своих",
  "свои",
  // English
  "this",
  "that",
  "with",
  "from",
  "have",
  "will",
  "they",
  "their",
  "which",
  "would",
  "there",
  "been",
  "were",
  "into",
  "such",
  "than",
  "then",
  "when",
  "what",
  "your",
]);

export type InputRichness = {
  char_count: number;
  tech_features_count: number;
  has_constructive_details: boolean;
  has_ipc_hints: boolean;
};

/**
 * Deterministic richness heuristics over a free-text invention/topic
 * description. No I/O, no randomness — same input always yields same output.
 *
 * Heuristic for `tech_features_count`: split on any non-letter/digit
 * (Unicode-aware, so Cyrillic words survive), keep distinct lowercased tokens
 * of length ≥ 4 that are not in the small RU/EN stopword set above. This is a
 * coarse proxy for "how many distinct content-bearing words" — not a claim of
 * actual technical features.
 */
export function computeInputRichness(text: string): InputRichness {
  const safe = typeof text === "string" ? text : "";

  // Unicode-aware token split: anything that isn't a letter or digit is a
  // separator. `u` flag + \p{L}/\p{N} keeps Cyrillic and Latin words intact.
  const tokens = safe
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
  const distinct = new Set(tokens);

  // Measurements/materials/construction verbs — a signal the description has
  // concrete constructive detail rather than just a high-level idea.
  const has_constructive_details =
    /\d+\s?(мм|см|м|°|в|а|гц|квт|вт|%)/i.test(safe) ||
    /состоит из|выполнен|содержит/i.test(safe);

  // IPC/CPC class hint, e.g. "G01R", "H04W" — user already speaks classifier.
  const has_ipc_hints = /[A-H]\d{2}[A-Z]/.test(safe);

  return {
    char_count: safe.length,
    tech_features_count: distinct.size,
    has_constructive_details,
    has_ipc_hints,
  };
}

/** Fresh calibration session id. crypto.randomUUID is available in Node ≥ 16. */
export function newSessionId(): string {
  return crypto.randomUUID();
}

export type CalibrationInput = {
  session_id: string;
  input_richness: ReturnType<typeof computeInputRichness>;
  clarifying_qa?: { questions?: string[]; answers?: string[] };
  labeled_case?: string | null;
};
