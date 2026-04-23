// Single source of truth for the feedback survey. Both the API route (for
// validation) and the client form (for rendering) import from here — so
// schema drift between client and server is impossible.

export const FEEDBACK_Q1_OPTIONS = [
  "nothing",
  "patent_attorney",
  "google_patents",
  "espacenet",
  "fips",
  "other",
] as const;

export const FEEDBACK_Q2_OPTIONS = [
  "before_patent_reg",
  "competitive_analysis",
  "academic",
  "due_diligence",
  "other",
] as const;

export const FEEDBACK_Q3_OPTIONS = [
  "free_only",
  "under_1000_rub",
  "1000_2500_rub",
  "2500_5000_rub",
  "over_5000_rub",
  "custom",
] as const;

export const FEEDBACK_OPERATIONS = ["analyze", "search", "landscape"] as const;

export const FEEDBACK_FREE_TEXT_MAX = 2000;
export const FEEDBACK_CUSTOM_PRICE_MAX = 100;

export type FeedbackAnswers = {
  q1: (typeof FEEDBACK_Q1_OPTIONS)[number];
  q2: (typeof FEEDBACK_Q2_OPTIONS)[number];
  q3: (typeof FEEDBACK_Q3_OPTIONS)[number];
  q3_custom?: string;
  free_text?: string;
};

export type FeedbackOperation = (typeof FEEDBACK_OPERATIONS)[number];

export type FeedbackValidation =
  | { ok: true; answers: FeedbackAnswers; operation: FeedbackOperation }
  | { ok: false; reason: string };

/**
 * Validate raw body from POST /api/feedback. Caller should pass the parsed
 * JSON body. On success, returns the cleaned/typed payload ready for RPC.
 */
export function validateFeedbackPayload(raw: unknown): FeedbackValidation {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "invalid_payload" };
  }
  const body = raw as Record<string, unknown>;

  const operation = body.operation;
  if (
    typeof operation !== "string" ||
    !(FEEDBACK_OPERATIONS as readonly string[]).includes(operation)
  ) {
    return { ok: false, reason: "invalid_operation" };
  }

  const q1 = body.q1;
  const q2 = body.q2;
  const q3 = body.q3;
  if (
    typeof q1 !== "string" ||
    !(FEEDBACK_Q1_OPTIONS as readonly string[]).includes(q1)
  ) {
    return { ok: false, reason: "invalid_q1" };
  }
  if (
    typeof q2 !== "string" ||
    !(FEEDBACK_Q2_OPTIONS as readonly string[]).includes(q2)
  ) {
    return { ok: false, reason: "invalid_q2" };
  }
  if (
    typeof q3 !== "string" ||
    !(FEEDBACK_Q3_OPTIONS as readonly string[]).includes(q3)
  ) {
    return { ok: false, reason: "invalid_q3" };
  }

  let q3_custom: string | undefined;
  if (q3 === "custom") {
    if (typeof body.q3_custom !== "string" || !body.q3_custom.trim()) {
      return { ok: false, reason: "missing_q3_custom" };
    }
    q3_custom = body.q3_custom.trim().slice(0, FEEDBACK_CUSTOM_PRICE_MAX);
  }

  let free_text: string | undefined;
  if (body.free_text !== undefined && body.free_text !== null) {
    if (typeof body.free_text !== "string") {
      return { ok: false, reason: "invalid_free_text" };
    }
    const trimmed = body.free_text.trim();
    if (trimmed.length > FEEDBACK_FREE_TEXT_MAX) {
      return { ok: false, reason: "free_text_too_long" };
    }
    if (trimmed.length > 0) free_text = trimmed;
  }

  return {
    ok: true,
    operation: operation as FeedbackOperation,
    answers: {
      q1: q1 as FeedbackAnswers["q1"],
      q2: q2 as FeedbackAnswers["q2"],
      q3: q3 as FeedbackAnswers["q3"],
      ...(q3_custom !== undefined ? { q3_custom } : {}),
      ...(free_text !== undefined ? { free_text } : {}),
    },
  };
}
