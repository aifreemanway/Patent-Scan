// Deep Analysis worker tick — runs in the SAME pm2 process as the
// literature-review worker, but on its OWN poll loop so a long lit-review
// (10-15 min) never head-of-line-blocks a Deep Analysis (~45-180s). Both are
// I/O-bound on the Timeweb gateway, so concurrent loops in one Node process is
// fine.
//
// Flow: claim oldest pending type='deep_analysis' row → run the Sonnet verdict
// (lib/deep-analysis/run) → write result + status='completed'. On failure:
// retry up to MAX_RETRIES, then status='error' + refund the free credit
// (refund_free_deep_analysis — the one-free-credit model, NOT refund_usage).

import { type SupabaseClient } from "@supabase/supabase-js";
import { runDeepAnalysisVerdict, type InputPatent } from "@/lib/deep-analysis/run";

const MAX_RETRIES = 3;

type DeepParams = {
  answers?: string[];
  patents?: InputPatent[];
};

type DeepRow = {
  id: string;
  user_id: string;
  description: string | null;
  params: DeepParams | null;
  retry_count: number;
};

async function claimNextPending(admin: SupabaseClient): Promise<DeepRow | null> {
  const { data: row } = await admin
    .from("search_requests")
    .select("id, user_id, description, params, retry_count")
    .eq("type", "deep_analysis")
    .eq("status", "pending")
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!row) return null;

  // Guarded flip pending→in_progress; a racing second loop simply sees no row.
  const { data: claimed, error } = await admin
    .from("search_requests")
    .update({
      status: "in_progress",
      started_at: new Date().toISOString(),
      progress_pct: 10,
    })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("id, user_id, description, params, retry_count")
    .maybeSingle();

  if (error || !claimed) return null; // lost the race
  return claimed as DeepRow;
}

async function runOne(admin: SupabaseClient, row: DeepRow): Promise<void> {
  const apiKey = process.env.TIMEWEB_AI_KEY;
  if (!apiKey) throw new Error("Missing env: TIMEWEB_AI_KEY");

  const description = (row.description ?? "").trim();
  if (!description) throw new Error("deep_analysis row missing description");

  const answers = Array.isArray(row.params?.answers) ? row.params!.answers! : [];
  const patents = Array.isArray(row.params?.patents) ? row.params!.patents! : [];

  console.info(`[worker/deep] processing ${row.id} «${description.slice(0, 60)}»`);

  const payload = await runDeepAnalysisVerdict({ apiKey, description, answers, patents, userId: row.user_id });

  const { error } = await admin
    .from("search_requests")
    .update({
      status: "completed",
      result: payload,
      completed_at: new Date().toISOString(),
      progress_pct: 100,
      error_message: null,
    })
    .eq("id", row.id);
  if (error) throw new Error(`persist completed failed: ${error.message}`);

  console.info(`[worker/deep] done ${row.id} (${payload.features.length} features, ${payload.patents.length} patents)`);
}

async function handleFailure(
  admin: SupabaseClient,
  row: DeepRow,
  err: unknown
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const nextRetry = row.retry_count + 1;
  console.error(`[worker/deep] error ${row.id}`, { message, retry: nextRetry });

  if (nextRetry < MAX_RETRIES) {
    // Re-queue for another attempt on a later tick.
    await admin
      .from("search_requests")
      .update({
        status: "pending",
        retry_count: nextRetry,
        error_message: message.slice(0, 2000),
      })
      .eq("id", row.id);
    return;
  }

  // Exhausted retries — mark error AND refund the free credit so the user isn't
  // charged for a Deep Analysis that never produced a verdict (the core of the
  // ap-qa bug). The client poll sees status='error' and shows the retry CTA.
  await admin
    .from("search_requests")
    .update({
      status: "error",
      completed_at: new Date().toISOString(),
      error_message: message.slice(0, 2000),
    })
    .eq("id", row.id);

  try {
    await admin.rpc("refund_free_deep_analysis", { p_user_id: row.user_id });
    console.info(`[worker/deep] refunded free credit for ${row.user_id} after ${row.id} failed`);
  } catch (e) {
    console.error("[worker/deep] refund failed", e);
  }
}

/** One poll tick. Call from a setInterval in the worker main loop. */
export async function deepAnalysisTick(admin: SupabaseClient): Promise<void> {
  const row = await claimNextPending(admin);
  if (!row) return;
  try {
    await runOne(admin, row);
  } catch (e) {
    await handleFailure(admin, row, e);
  }
}

/**
 * On worker boot, requeue any deep_analysis rows left 'in_progress' by a
 * previous (crashed/restarted) worker — mirrors the lit-review recovery.
 */
export async function requeueStuckDeepAnalysis(admin: SupabaseClient): Promise<void> {
  const { data: stuck } = await admin
    .from("search_requests")
    .select("id")
    .eq("type", "deep_analysis")
    .eq("status", "in_progress")
    .is("deleted_at", null);
  if (stuck && stuck.length > 0) {
    console.info(`[worker/deep] requeuing ${stuck.length} in-progress rows from previous run`);
    await admin
      .from("search_requests")
      .update({ status: "pending", locked_by: null, locked_at: null })
      .in("id", stuck.map((s) => s.id));
  }
}
