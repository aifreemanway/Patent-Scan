// POST /api/literature-review/submit
// Validates the intake form, charges the monthly literature_review quota
// (Team 1, Enterprise 2), inserts a 'pending' search_requests row, and sends
// the «received» email. Returns {id} so the client can redirect to
// /literature-review/processing?id={id}.
//
// The actual pipeline (Stages 1-9) runs in the patent-scan-worker pm2 process
// — it polls for pending rows and advances them. This route is sync; it must
// not block the user for more than a few hundred ms.

import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { spendGuard, perUserSpendGuard } from "@/lib/spend-guard";
import { requireAuthAndQuota } from "@/lib/auth-quota";
import { createSupabaseAdmin } from "@/lib/supabase-server";
import {
  createSearchRequest,
  deriveTopic,
} from "@/lib/search-requests";
import { computeInputRichness, newSessionId } from "@/lib/calibration";
import { RATE_WINDOW_MS } from "@/lib/config";
import { sendReceivedEmail } from "@/worker/literature-review/email";
import type {
  LitReviewParams,
  LitReviewIndustry,
  LitReviewRegion,
} from "@/lib/literature-review/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const KNOWN_INDUSTRIES: readonly LitReviewIndustry[] = [
  "metallurgy",
  "chemistry",
  "mechanical",
  "energy",
  "biotech",
  "electronics",
  "agriculture",
  "other",
];
const KNOWN_REGIONS: readonly LitReviewRegion[] = [
  "RU",
  "CIS",
  "CN",
  "US",
  "EU",
  "UK",
  "JP_KR",
  "AU_NZ",
  "LATAM",
  "ME",
  "AF",
  "WORLD",
];

const TOPIC_MIN = 50;
const TOPIC_MAX = 500;
const HYPOTHESES_MAX = 1000;
const CURRENT_YEAR = new Date().getUTCFullYear();
const PERIOD_MIN_YEAR = 1990;

function fail(error: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

export async function POST(req: Request): Promise<NextResponse> {
  const paused = await spendGuard();
  if (paused) return paused;
  const rl = await rateLimit(req, {
    windowMs: RATE_WINDOW_MS,
    max: 3, // 3 submits/min/IP — lit-review is expensive
    keyPrefix: "literature-review-submit",
  });
  if (rl) return rl;

  // requireAuthAndQuota("literature_review") charges 1 from the monthly
  // counter — if the user is on Free/Starter, quota_limit() returns 0 and the
  // RPC blocks with 402 quota_exceeded. Team/Enterprise → row inserted +
  // counter incremented atomically.
  const guard = await requireAuthAndQuota("literature_review");
  if (!guard.ok) return guard.response;

  // Per-user daily spend breaker (СЛОЙ-2). guard.tier is resolved here (quota path).
  const overBudget = await perUserSpendGuard(guard.user.id, guard.tier);
  if (overBudget) return overBudget;

  let body: Partial<LitReviewParams>;
  try {
    body = (await req.json()) as Partial<LitReviewParams>;
  } catch {
    return fail("invalid_json");
  }

  // ── Validation ───────────────────────────────────────────────
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (topic.length < TOPIC_MIN) return fail("topic_too_short");
  if (topic.length > TOPIC_MAX) return fail("topic_too_long");

  const industry = body.industry as LitReviewIndustry;
  if (!KNOWN_INDUSTRIES.includes(industry)) return fail("invalid_industry");

  const regions = Array.isArray(body.regions) ? body.regions : [];
  const validRegions = regions.filter((r): r is LitReviewRegion =>
    (KNOWN_REGIONS as readonly string[]).includes(r as string)
  );
  if (validRegions.length === 0) return fail("no_regions");

  const periodFrom = Number(body.periodFrom);
  const periodTo = Number(body.periodTo);
  if (!Number.isInteger(periodFrom) || !Number.isInteger(periodTo)) return fail("invalid_period");
  if (periodFrom < PERIOD_MIN_YEAR) return fail("period_too_old");
  if (periodTo > CURRENT_YEAR) return fail("period_in_future");
  if (periodFrom > periodTo) return fail("period_reversed");
  if (periodTo - periodFrom > 50) return fail("period_too_wide");

  const hypotheses =
    typeof body.hypotheses === "string" ? body.hypotheses.trim().slice(0, HYPOTHESES_MAX) : undefined;

  const params: LitReviewParams = {
    topic,
    industry,
    regions: validRegions,
    periodFrom,
    periodTo,
    ...(hypotheses ? { hypotheses } : {}),
  };

  // ── Insert pending row ──────────────────────────────────────
  // We pass status='pending' explicitly — the worker will flip it to
  // in_progress when it claims it. The helper's default is in_progress
  // (suited to sync routes); lit-review is the only async caller.
  const sr = await createSearchRequest({
    userId: guard.user.id,
    type: "literature_review",
    topic: deriveTopic(topic),
    description: hypotheses ?? null,
    params: params as unknown as Record<string, unknown>,
    status: "pending",
    calibration: {
      session_id: newSessionId(),
      input_richness: computeInputRichness(topic),
    },
  });

  if (!sr) {
    // The row failed to insert — refund the quota slot so the user can retry.
    const admin = createSupabaseAdmin();
    await admin.rpc("refund_usage", {
      p_user_id: guard.user.id,
      p_operation: "literature_review",
    });
    return fail("insert_failed", 500);
  }

  // ── Fire-and-forget «received» email ────────────────────────
  // We don't await the email send — it's best-effort and the user already has
  // confirmation via the response. The worker will retry the email in a
  // future pass if `notify_received_sent_at` is still null when it picks up
  // the row… actually no — we stamp the flag here so the worker doesn't
  // re-send.
  if (guard.user.email) {
    const userEmail = guard.user.email;
    (async () => {
      const result = await sendReceivedEmail({
        to: userEmail,
        requestId: sr.id,
        topic,
      });
      if (result.ok) {
        const admin = createSupabaseAdmin();
        await admin
          .from("search_requests")
          .update({ notify_received_sent_at: new Date().toISOString() })
          .eq("id", sr.id);
      }
    })().catch((e) =>
      console.error("[litreview/submit] received email failed", { id: sr.id, e })
    );
  }

  return NextResponse.json({ id: sr.id, status: "pending" });
}
