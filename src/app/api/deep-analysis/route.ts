// POST /api/deep-analysis — SUBMIT (async).
//
// Was synchronous (Sonnet call inline, ~45-180s). On mobile, NAT/idle-timeout
// killed the connection at 60-120s → client saw an error while the server had
// already charged the free credit → user lost their one free Deep Analysis with
// nothing to show (BUG ap-qa 2026-05-29). Fix (Vsevolod: вариант B): make it
// durable like the literature-review pipeline —
//   submit (this route, fast) → pm2 worker runs Sonnet → client polls status.
//
// This route now: rate-limit → auth → validate → claim the free credit →
// create a 'pending' search_requests row carrying the inputs in params →
// return { id }. NO Timeweb call here, so the HTTP request finishes in <1s and
// никакой NAT-таймаут его не рвёт. The worker (src/worker/deep-analysis) picks
// up the row, runs the verdict, and writes result; the client polls
// GET /api/deep-analysis/[id]/status.

import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { spendGuard, perUserSpendGuard } from "@/lib/spend-guard";
import { requireAuth } from "@/lib/auth-quota";
import { createSupabaseAdmin } from "@/lib/supabase-server";
import { createSearchRequest, deriveTopic } from "@/lib/search-requests";
import { computeInputRichness, newSessionId } from "@/lib/calibration";
import type { InputPatent } from "@/lib/deep-analysis/run";
import {
  MAX_DESCRIPTION_LEN,
  MAX_ANSWERS,
  MAX_ANSWER_LEN,
  MAX_PATENTS_ANALYZE,
  RATE_WINDOW_MS,
  RATE_MAX,
} from "@/lib/config";

export const runtime = "nodejs";
// Submit is fast (no LLM call) — but keep a small cap as a guard.
export const maxDuration = 15;

export async function POST(req: Request): Promise<NextResponse> {
  const paused = await spendGuard();
  if (paused) return paused;
  const rl = await rateLimit(req, {
    windowMs: RATE_WINDOW_MS,
    max: RATE_MAX.deepAnalysis,
    keyPrefix: "deep-analysis",
  });
  if (rl) return rl;

  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  // Per-user daily spend breaker (СЛОЙ-2) — gate at submit so an over-budget user
  // doesn't enqueue a worker job that would burn more LLM ₽.
  const overBudget = await perUserSpendGuard(auth.user.id, auth.tier);
  if (overBudget) return overBudget;

  // Fail fast if the gateway key isn't configured — better to reject before
  // consuming the credit than to let the worker fail and refund.
  if (!process.env.TIMEWEB_AI_KEY) {
    return NextResponse.json(
      { error: "Service configuration error" },
      { status: 500 }
    );
  }

  // 1. Parse + validate BEFORE consuming the credit (no consume/refund churn on
  // malformed input).
  let body: {
    description?: string;
    answers?: string[];
    patents?: InputPatent[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const description = (body.description ?? "").trim();
  if (description.length < 20) {
    return NextResponse.json(
      { error: "description must be at least 20 characters" },
      { status: 400 }
    );
  }
  if (description.length > MAX_DESCRIPTION_LEN) {
    return NextResponse.json(
      { error: `description must be at most ${MAX_DESCRIPTION_LEN} characters` },
      { status: 413 }
    );
  }

  const patents = (body.patents ?? []).slice(0, MAX_PATENTS_ANALYZE);
  const answers = (body.answers ?? [])
    .filter((a) => a && a.trim().length > 0)
    .slice(0, MAX_ANSWERS)
    .map((a) => a.slice(0, MAX_ANSWER_LEN));

  // 2. Claim the one free Deep Analysis atomically (anti-abuse §5: strictly one
  // per verified account). Billing for additional runs is fast-follow.
  const admin = createSupabaseAdmin();
  const { data: consumeRaw, error: consumeErr } = await admin.rpc(
    "consume_free_deep_analysis",
    { p_user_id: auth.user.id }
  );
  if (consumeErr) {
    console.error("[deep-analysis/submit] consume rpc failed", {
      message: consumeErr.message,
    });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  const consume = consumeRaw as { allowed?: boolean; reason?: string };
  if (!consume?.allowed) {
    return NextResponse.json(
      { error: "deep_analysis_used", reason: consume?.reason ?? "already_used" },
      { status: 402 }
    );
  }

  // 3. Create the pending job row carrying the inputs. The worker reads
  // description + params.{answers,patents}, runs the verdict, writes result.
  const sr = await createSearchRequest({
    userId: auth.user.id,
    type: "deep_analysis",
    status: "pending",
    topic: deriveTopic(description),
    description,
    params: { answers, patents },
    calibration: {
      session_id: newSessionId(),
      input_richness: computeInputRichness(description),
      ...(answers.length > 0
        ? { clarifying_qa: { answers } }
        : {}),
    },
  });

  // If we couldn't create the job row, the credit is claimed but there's
  // nothing to process — refund it and surface an error so the user retries.
  if (!sr) {
    try {
      await admin.rpc("refund_free_deep_analysis", { p_user_id: auth.user.id });
    } catch (err) {
      console.error("[deep-analysis/submit] refund after create-fail failed", err);
    }
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  return NextResponse.json({ id: sr.id, status: "pending" });
}
