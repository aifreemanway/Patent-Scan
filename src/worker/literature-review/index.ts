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

// Disable Node's Happy-Eyeballs dual-stack auto-selection: the prod VPS has
// broken outbound IPv6 that black-holes, so fetch/undici stalls on the dead AAAA
// family (ETIMEDOUT ~500ms) for dual-stack hosts. The web app does this via
// instrumentation.ts; the worker is a separate process, so set it here too —
// before any module opens a connection. See src/instrumentation.ts for context.
import net from "node:net";
import dns from "node:dns";
net.setDefaultAutoSelectFamily(false);
dns.setDefaultResultOrder("ipv4first");

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
import { renderReportPdf } from "./render-pdf";
import {
  sendReadyEmail,
  sendErrorEmail,
} from "./email";
import type { LitReviewParams } from "@/lib/literature-review/types";
import { reactivationTick } from "../reactivation/tick";
import { expirySubscriptionsTick } from "../billing/expiry-tick";
import {
  deepAnalysisTick,
  requeueStuckDeepAnalysis,
} from "../deep-analysis/tick";

const POLL_INTERVAL_MS = 5_000;
const DEEP_POLL_INTERVAL_MS = 3_000;
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
  body: string | Buffer,
  ext: string,
  contentType: string
): Promise<string | null> {
  const path = `${requestId}.${ext}`;
  // Normalize to a BlobPart: a Node Buffer is backed by ArrayBufferLike which TS
  // won't accept as BlobPart directly, so copy into a plain Uint8Array.
  const part: BlobPart = typeof body === "string" ? body : new Uint8Array(body);
  const { error: uploadErr } = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(path, new Blob([part], { type: contentType }), {
      contentType,
      upsert: true,
    });
  if (uploadErr) {
    console.error("[worker/upload] failed", { requestId, ext, message: uploadErr.message });
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
    tierDropped: initial.tierDroppedCount,
    yearDropped: initial.yearDroppedCount,
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

  // Stage 3-6+8 combined synthesis. Pass s1.seedCompanies so the players
  // table uses canonical industry leaders rather than tangential firms
  // (PR-3.6.4 — ap-ba v2 review issue #2a).
  await updateStage(admin, row.id, 4, 50);
  const report = await stage3to8(
    apiKey,
    params,
    sources,
    snippets,
    process.env.TAVILY_API_KEY ?? "",
    s1.seedCompanies ?? [],
    [...(s1.queriesRu ?? []), ...(s1.queriesEn ?? [])]
  );
  // Apply Stage 1's working title if Sonnet didn't override (rare)
  if (!report.title) report.title = s1.workingTitle;

  // Visible tier-drop disclosure (§6 caveats). No silent caps: if we dropped
  // low-authority sources, the report says so. Flows to markdown + PDF via
  // report.caveats.
  if (initial.tierDroppedCount > 0) {
    report.caveats = [
      ...(report.caveats ?? []),
      `Отсеяно ${initial.tierDroppedCount} источников низкого авторитета (студбазы/форумы/агрегаторы).`,
    ];
  }
  // §3.5 No-silent-caps: if the year cutoff dropped scholarly hits, say so.
  if (initial.yearDroppedCount > 0) {
    report.caveats = [
      ...(report.caveats ?? []),
      `Отсеяно ${initial.yearDroppedCount} научных публикаций старше порога года издания (фильтр LITREVIEW_YEAR_CUTOFF).`,
    ];
  }

  // Stage 7 — verify sources (§4: classify access, reroll unreachable DOIs).
  // FAIL-OPEN: sources are never dropped here — at worst marked `unreachable`.
  await updateStage(admin, row.id, 7, 80);
  const verify = await stage7VerifySources(report.sources);
  report.sources = verify.sources;
  // No-silent-caps: if links did not resolve at verify time, the report says so
  // (anti-fab: unreachable ≠ non-existent — the source is kept, just flagged).
  if (verify.unreachableCount > 0) {
    const rerolled =
      verify.rerolledCount > 0
        ? ` Для ${verify.rerolledCount} из них найдена открытая копия (DOI).`
        : "";
    report.caveats = [
      ...(report.caveats ?? []),
      `${verify.unreachableCount} ссылок не открывались на момент проверки и помечены в списке источников (они сохранены — недоступность не означает отсутствие работы).${rerolled}`,
    ];
  }

  // Stage 9 — render + upload. Deliver a real PDF (the headline artefact);
  // also keep the .md alongside for support / re-render / ba head-to-head diff.
  // If the PDF render throws (e.g. font fetch fails on the VPS), degrade to the
  // markdown artefact so a paid review never hard-errors.
  await updateStage(admin, row.id, 9, 90);
  const md = renderReportMarkdown(report);
  let reportUrl: string | null;
  try {
    const pdf = await renderReportPdf(md);
    reportUrl = await uploadReport(admin, row.id, pdf, "pdf", "application/pdf");
    await uploadReport(admin, row.id, md, "md", "text/markdown; charset=utf-8");
  } catch (e) {
    console.error("[worker/pdf] render failed — degrading to markdown", {
      id: row.id,
      message: e instanceof Error ? e.message : String(e),
    });
    reportUrl = await uploadReport(admin, row.id, md, "md", "text/markdown; charset=utf-8");
  }

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

  // Deep Analysis tick — its OWN loop (separate from lit-review) so a ~45-180s
  // Sonnet verdict isn't head-of-line-blocked behind a 10-15 min lit-review.
  // Own busy guard; both loops await the Timeweb gateway (I/O-bound) so running
  // concurrently in one Node process is fine.
  await requeueStuckDeepAnalysis(admin).catch((e) => {
    console.error("[worker/deep] requeue startup error", e);
  });
  let deepBusy = false;
  setInterval(async () => {
    if (deepBusy) return;
    deepBusy = true;
    try {
      await deepAnalysisTick(admin);
    } catch (e) {
      console.error("[worker/deep] tick error", e);
    } finally {
      deepBusy = false;
    }
  }, DEEP_POLL_INTERVAL_MS);

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

  // Billing expiry tick — hourly, independent. Downgrades subscriptions whose
  // paid period lapsed (the one cron required even for manual billing). Cheap
  // (one RPC), idempotent, no busy guard needed (1h ≫ run time).
  setInterval(() => {
    expirySubscriptionsTick(admin).catch((e) => {
      console.error("[worker] billing expiry interval error", e);
    });
  }, REACTIVATION_TICK_INTERVAL_MS);
  expirySubscriptionsTick(admin).catch((e) => {
    console.error("[worker] billing expiry startup error", e);
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
