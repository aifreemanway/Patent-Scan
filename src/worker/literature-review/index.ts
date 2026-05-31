// Literature review worker — separate pm2 process (entry point declared in
// deploy/ecosystem.config.js). Polls search_requests for type='literature_review'
// AND status='pending', advances the pipeline stage-by-stage, persists progress
// after each stage, and sends notification emails.
//
// Why a dedicated process and not a Next.js cron / fire-and-forget:
//   - A literature review runs 10-15 minutes wall-clock (Sonnet × N stages +
//     external API harvesting). Next.js' request lifecycle is the wrong fit.
//   - State persists in `search_requests` so a pm2 restart mid-pipeline doesn't
//     lose the work — on next start, we resume any row stuck in 'in_progress'
//     by re-running from Stage 1 (cheap relative to lost-state alternatives).
//
// Polling interval and concurrency are intentionally low — we process ONE row
// at a time. Lit-reviews are paid (Team 1/mo, Enterprise 2/mo), so queue
// depth stays small even at full capacity.

// Load env BEFORE any other import that reads process.env.
// pm2 sets NODE_ENV=production for us; in dev we read .env.local.
import { config as dotenvConfig } from "dotenv";
dotenvConfig({
  path: process.env.NODE_ENV === "production" ? ".env.production" : ".env.local",
});

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  stage1,
  stage2,
  stage3to8,
  stage7VerifySources,
  harvestToSources,
  applyRelevanceFilter,
} from "./stages";
import { renderReportMarkdown } from "./markdown";
import {
  sendReadyEmail,
  sendErrorEmail,
} from "./email";
import type { LitReviewParams } from "@/lib/literature-review/types";
import { reactivationTick } from "../reactivation/tick";

const POLL_INTERVAL_MS = 5_000;
const REACTIVATION_TICK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const STORAGE_BUCKET = "literature-review-reports";
const PDF_URL_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const MAX_RETRIES = 3;
const WORKER_ID = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

type SearchRequestRow = {
  id: string;
  user_id: string;
  topic: string;
  description: string | null;
  params: LitReviewParams;
  retry_count: number;
  notify_received_sent_at: string | null;
  notify_ready_sent_at: string | null;
  notify_error_sent_at: string | null;
};

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function makeAdmin(): SupabaseClient {
  return createClient(
    envOrThrow("NEXT_PUBLIC_SUPABASE_URL"),
    envOrThrow("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

async function claimNextPending(admin: SupabaseClient): Promise<SearchRequestRow | null> {
  // Atomic claim: flip the oldest pending row to in_progress and stamp this
  // worker as the owner. Postgres UPDATE…RETURNING with a self-referencing CTE
  // is the cleanest single-statement solution, but Supabase's PostgREST doesn't
  // expose arbitrary CTEs. So we use two calls bracketed by a guard on the
  // status filter; on contention the second worker simply sees no row.
  const { data: row } = await admin
    .from("search_requests")
    .select(
      "id, user_id, topic, description, params, retry_count, notify_received_sent_at, notify_ready_sent_at, notify_error_sent_at"
    )
    .eq("type", "literature_review")
    .eq("status", "pending")
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!row) return null;

  const { data: claimed, error } = await admin
    .from("search_requests")
    .update({
      status: "in_progress",
      started_at: new Date().toISOString(),
      stage: 1,
      progress_pct: 0,
      locked_by: WORKER_ID,
      locked_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("status", "pending") // racing-second-worker guard
    .select(
      "id, user_id, topic, description, params, retry_count, notify_received_sent_at, notify_ready_sent_at, notify_error_sent_at"
    )
    .maybeSingle();

  if (error || !claimed) {
    return null; // lost the race
  }
  return claimed as SearchRequestRow;
}

async function updateStage(
  admin: SupabaseClient,
  id: string,
  stage: number,
  pct: number
): Promise<void> {
  await admin
    .from("search_requests")
    .update({ stage, progress_pct: pct })
    .eq("id", id);
}

async function getUserEmail(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await admin
    .from("profiles")
    .select("email, email_notifications_ready")
    .eq("id", userId)
    .single();
  if (!data) return null;
  // Honor the per-profile opt-out flag for the «ready» email; user always
  // sees the result in /account/history regardless.
  return data.email_notifications_ready ? data.email : null;
}

async function uploadReport(
  admin: SupabaseClient,
  requestId: string,
  markdown: string
): Promise<string | null> {
  const path = `${requestId}.md`;
  const { error: uploadErr } = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(path, new Blob([markdown], { type: "text/markdown; charset=utf-8" }), {
      contentType: "text/markdown; charset=utf-8",
      upsert: true,
    });
  if (uploadErr) {
    console.error("[worker/upload] failed", { requestId, message: uploadErr.message });
    return null;
  }
  const { data: signed } = await admin.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(path, PDF_URL_TTL_SECONDS);
  return signed?.signedUrl ?? null;
}

async function runPipeline(admin: SupabaseClient, row: SearchRequestRow): Promise<void> {
  const apiKey = envOrThrow("TIMEWEB_AI_KEY");
  const params = row.params;

  console.info(`[worker] processing ${row.id} «${row.topic.slice(0, 60)}»`);

  await updateStage(admin, row.id, 1, 5);
  const s1 = await stage1(apiKey, params);

  await updateStage(admin, row.id, 2, 20);
  const harvest = await stage2(params, s1);
  console.info(`[worker] harvest`, {
    id: row.id,
    patents: harvest.patents.length,
    scholar: harvest.scholar.length,
    web: harvest.web.length,
    wiki: harvest.wiki.length,
  });

  await updateStage(admin, row.id, 3, 35);
  const initial = harvestToSources(harvest);
  console.info(`[worker] sources after blacklist`, {
    id: row.id,
    kept: initial.sources.length,
    blacklisted: initial.blacklistedCount,
  });
  if (initial.sources.length === 0) {
    throw new Error("no_sources_harvested");
  }

  // PR-3.5 Fix 1+2: LLM-based relevance filter pass. Drops «явно не в тему»
  // hits that survived the domain blacklist (BUG-LIT-2 H2 sample: литий
  // батареи from rospatent.gov.ru — authoritative source, off-topic content).
  // Gemini Flash, batched 50 / call; spends ~₽0.5 per review.
  const filtered = await applyRelevanceFilter({
    apiKey,
    topic: params.topic,
    sources: initial.sources,
    snippets: initial.snippets,
  });
  console.info(`[worker] sources after relevance filter`, {
    id: row.id,
    kept: filtered.sources.length,
    droppedByRelevance: filtered.droppedCount,
  });
  const sources = filtered.sources;
  const snippets = filtered.snippets;
  if (sources.length === 0) {
    throw new Error("no_relevant_sources");
  }

  // Stage 3-6+8 combined synthesis
  await updateStage(admin, row.id, 4, 50);
  const report = await stage3to8(apiKey, params, sources, snippets);
  // Apply Stage 1's working title if Sonnet didn't override (rare)
  if (!report.title) report.title = s1.workingTitle;

  // Stage 7 — verify sources
  await updateStage(admin, row.id, 7, 80);
  report.sources = await stage7VerifySources(report.sources);

  // Stage 9 — render + upload
  await updateStage(admin, row.id, 9, 90);
  const md = renderReportMarkdown(report);
  const reportUrl = await uploadReport(admin, row.id, md);

  // Persist final state
  await admin
    .from("search_requests")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      progress_pct: 100,
      stage: 9,
      result: {
        title: report.title,
        scope: report.scope,
        overview: report.overview,
        sourceCount: report.sources.length,
        techCount: report.technologies.length,
        tableCount: report.comparativeTables.length,
        conclusionCount: report.conclusions.length,
      },
      result_pdf_url: reportUrl,
      error_message: null,
    })
    .eq("id", row.id);

  // Send «ready» email (if user hasn't opted out and this email hasn't sent already)
  if (!row.notify_ready_sent_at && reportUrl) {
    const email = await getUserEmail(admin, row.user_id);
    if (email) {
      const result = await sendReadyEmail({
        to: email,
        requestId: row.id,
        topic: row.topic,
        periodFrom: params.periodFrom,
        periodTo: params.periodTo,
        reportUrl,
      });
      if (result.ok) {
        await admin
          .from("search_requests")
          .update({ notify_ready_sent_at: new Date().toISOString() })
          .eq("id", row.id);
      }
    }
  }
  console.info(`[worker] done ${row.id} (${report.sources.length} sources, ${report.technologies.length} techs)`);
}

async function handleFailure(
  admin: SupabaseClient,
  row: SearchRequestRow,
  err: unknown
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const nextRetry = row.retry_count + 1;
  console.error(`[worker] pipeline error ${row.id}`, { message, retry: nextRetry });

  if (nextRetry < MAX_RETRIES) {
    // Re-queue: drop back to 'pending' with an incremented retry counter.
    // The polling loop picks it up again on its next tick.
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

  // Exhausted retries — mark error, refund the quota slot, send error email.
  await admin
    .from("search_requests")
    .update({
      status: "error",
      completed_at: new Date().toISOString(),
      error_message: message.slice(0, 2000),
    })
    .eq("id", row.id);

  await admin.rpc("refund_usage", {
    p_user_id: row.user_id,
    p_operation: "literature_review",
  });

  if (!row.notify_error_sent_at) {
    const email = await getUserEmail(admin, row.user_id);
    if (email) {
      const result = await sendErrorEmail({
        to: email,
        requestId: row.id,
        topic: row.topic,
      });
      if (result.ok) {
        await admin
          .from("search_requests")
          .update({ notify_error_sent_at: new Date().toISOString() })
          .eq("id", row.id);
      }
    }
  }
}

async function tick(admin: SupabaseClient): Promise<void> {
  const row = await claimNextPending(admin);
  if (!row) return;
  try {
    await runPipeline(admin, row);
  } catch (e) {
    await handleFailure(admin, row, e);
  }
}

async function main(): Promise<void> {
  const admin = makeAdmin();
  console.info(`[worker] literature-review started ${WORKER_ID}`);
  // Eagerly handle in_progress rows that the previous worker left mid-flight.
  // We requeue them so the next tick picks them up cleanly.
  const { data: stuck } = await admin
    .from("search_requests")
    .select("id")
    .eq("type", "literature_review")
    .eq("status", "in_progress")
    .is("deleted_at", null);
  if (stuck && stuck.length > 0) {
    console.info(`[worker] requeuing ${stuck.length} in-progress rows from previous run`);
    await admin
      .from("search_requests")
      .update({ status: "pending", locked_by: null, locked_at: null })
      .in("id", stuck.map((s) => s.id));
  }

  // Tick loop. setInterval is fine — handler is async, we don't want overlap,
  // so guard with a busy flag.
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await tick(admin);
    } catch (e) {
      console.error("[worker] tick error", e);
    } finally {
      busy = false;
    }
  }, POLL_INTERVAL_MS);

  // Reactivation tick — hourly, completely independent of the lit-review
  // pipeline. Cheap (one indexed SELECT + ≤BATCH_SIZE emails); doesn't need a
  // busy guard because the wall-clock between ticks (1h) is orders of
  // magnitude larger than the wave processing time.
  setInterval(() => {
    reactivationTick(admin).catch((e) => {
      console.error("[worker] reactivation interval error", e);
    });
  }, REACTIVATION_TICK_INTERVAL_MS);
  // Kick once on startup so a freshly-restarted worker processes the backlog
  // immediately instead of waiting an hour.
  reactivationTick(admin).catch((e) => {
    console.error("[worker] reactivation startup error", e);
  });

  // Keep alive
  process.on("SIGTERM", () => {
    console.info("[worker] SIGTERM received, exiting");
    process.exit(0);
  });
}

main().catch((e) => {
  console.error("[worker] fatal startup error", e);
  process.exit(1);
});
