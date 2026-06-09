// Helpers around the unified `search_requests` table — the foundation of
// /account/history (PR-2), the literature-review async pipeline (PR-3) and
// any per-request analytics. Every user-facing search route inserts one row
// here on entry and marks it completed/error on exit.
//
// All writes use the service-role client (RLS bypassed) so the existing routes
// don't need to thread a user-scoped Supabase client through every call site.
//
// Failure-mode: every helper SWALLOWS its error and logs to console — a DB
// outage on the history-logging path must never break the actual search a user
// is waiting on. The history will just miss that row.

import { createSupabaseAdmin } from "@/lib/supabase-server";
import type { CalibrationInput } from "@/lib/calibration";

export type SearchType =
  | "novelty"
  | "landscape"
  | "deep_analysis"
  | "literature_review";

export type SearchStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "error"
  | "cancelled";

const TOPIC_MAX = 500;

/** Trim and clip to 500 chars for the listings/search index. */
export function deriveTopic(source: string): string {
  const trimmed = source.trim().replace(/\s+/g, " ");
  if (!trimmed) return "(без темы)";
  if (trimmed.length <= TOPIC_MAX) return trimmed;
  return trimmed.slice(0, TOPIC_MAX - 1) + "…";
}

type CreateOpts = {
  userId: string;
  type: SearchType;
  topic: string;
  description?: string | null;
  params?: Record<string, unknown> | null;
  /**
   * For synchronous routes (analyze/landscape/deep-analysis) the request is
   * processed in the same HTTP call, so we start at 'in_progress' and flip to
   * completed/error in the same path. The async literature-review worker is
   * the only caller that should start at 'pending'.
   */
  status?: Extract<SearchStatus, "pending" | "in_progress">;
  /**
   * Silent-capture calibration metadata (input-side). Nested under
   * `params.calibration` so no schema change is needed. Fully optional —
   * absent on legacy/non-instrumented call-sites. See lib/calibration.ts.
   */
  calibration?: CalibrationInput;
};

/**
 * Insert a new request row and return its id. Returns null on failure so the
 * caller can swallow-and-continue (logging is best-effort, never blocking).
 */
export async function createSearchRequest(
  opts: CreateOpts
): Promise<{ id: string } | null> {
  const admin = createSupabaseAdmin();
  const status = opts.status ?? "in_progress";
  const now = new Date().toISOString();

  // Nest calibration metadata inside the existing params jsonb (no schema
  // change). Spread the caller's params first so an explicit `calibration`
  // key in params is preserved unless the dedicated arg is supplied.
  const params: Record<string, unknown> = {
    ...(opts.params ?? {}),
    ...(opts.calibration ? { calibration: opts.calibration } : {}),
  };

  const { data, error } = await admin
    .from("search_requests")
    .insert({
      user_id: opts.userId,
      type: opts.type,
      status,
      topic: opts.topic,
      description: opts.description ?? null,
      params,
      started_at: status === "in_progress" ? now : null,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[search-requests] create failed", {
      type: opts.type,
      userId: opts.userId,
      message: error?.message,
    });
    return null;
  }
  return { id: data.id };
}

/**
 * Count an account's prior «Экспертный поиск» runs (novelty rows tagged
 * params.engine='v2'). Backs the 1-free-per-account entitlement (Guardrail B):
 * the first expert run is free, separate from the monthly Поиск quota. On a DB
 * error returns 1 — i.e. «free already used» so the caller charges; anti-abuse
 * beats trial-friction, and with no paid users yet the cost of a wrong charge is
 * a single quota decrement, not money.
 */
export async function countExpertRuns(userId: string): Promise<number> {
  const admin = createSupabaseAdmin();
  const { count, error } = await admin
    .from("search_requests")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("type", "novelty")
    .eq("params->>engine", "v2")
    .is("deleted_at", null);
  if (error) {
    console.error("[search-requests] countExpertRuns failed", {
      userId,
      message: error.message,
    });
    return 1;
  }
  return count ?? 0;
}

type CompleteOpts = {
  cogsActual?: number;
  /** For literature-review: final PDF signed URL. */
  resultPdfUrl?: string;
};

/**
 * Flip a request to status='completed' and persist its result payload.
 * No-op if id is null (lets routes use the helper unconditionally after a
 * failed createSearchRequest).
 */
export async function markSearchRequestCompleted(
  id: string | null,
  result: Record<string, unknown>,
  opts?: CompleteOpts,
  /**
   * Silent-capture calibration metadata (output-side), e.g.
   * { ipc_queried, queries_sent, results_per_source, status_source }. Nested
   * under `result.calibration` so no schema change is needed. Fully optional.
   */
  calibrationOutput?: Record<string, unknown>
): Promise<void> {
  if (!id) return;
  const admin = createSupabaseAdmin();

  // Nest calibration output inside the result jsonb. Spread result first so an
  // explicit `calibration` key in result is preserved unless the arg overrides.
  const resultWithCalibration: Record<string, unknown> = calibrationOutput
    ? { ...result, calibration: calibrationOutput }
    : result;

  const { error } = await admin
    .from("search_requests")
    .update({
      status: "completed",
      result: resultWithCalibration,
      result_pdf_url: opts?.resultPdfUrl ?? null,
      cogs_actual: opts?.cogsActual ?? null,
      completed_at: new Date().toISOString(),
      progress_pct: 100,
      error_message: null,
    })
    .eq("id", id);

  if (error) {
    console.error("[search-requests] markCompleted failed", {
      id,
      message: error.message,
    });
  }
}

/**
 * Flip a request to status='error' and save the message for the user to see.
 * No-op if id is null.
 */
export async function markSearchRequestError(
  id: string | null,
  errorMessage: string
): Promise<void> {
  if (!id) return;
  const admin = createSupabaseAdmin();

  const { error } = await admin
    .from("search_requests")
    .update({
      status: "error",
      error_message: errorMessage.slice(0, 2000),
      completed_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error("[search-requests] markError failed", {
      id,
      message: error.message,
    });
  }
}
