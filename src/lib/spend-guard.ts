// Daily LLM-spend circuit-breaker (sec-review ap-fable 2026-06-12, P1).
//
// cost.ts already persists every LLM call's ₽ cost to `llm_cost_events`; this
// module READS that telemetry and trips a kill-switch: once today's confirmed
// spend exceeds LLM_DAILY_BUDGET_RUB, every guarded route answers 503 until the
// next MSK midnight. The point is a cheap insurance against a surprise Timeweb
// bill (runaway bug, bot, abuse) — not fine-grained quota (that's quota.ts).
//
// Design constraints:
// - LLM_DAILY_BUDGET_RUB unset/invalid → guard disabled (safe rollout: deploy
//   code first, arm via env on the VPS).
// - Sum comes from the `llm_spend_since` SQL function (migration 0012) — a
//   PostgREST row-select would silently cap at 1000 rows and undercount exactly
//   when it matters; aggregates are disabled by default on self-host PostgREST.
// - Verdict cached 60s per instance: one cheap indexed query a minute, near-zero
//   latency on the hot path.
// - Fail-open: a telemetry-path outage must not take the product down (same
//   stance as cost.ts persistence). cost_rub IS NULL rows (unconfirmed prices)
//   don't count toward the sum — the breaker works on confirmed ₽ only.
// - The literature-review worker is NOT guarded mid-flight: in-flight paid jobs
//   finish; the breaker stops new intake at the routes instead.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { dailyBudgetRubForTier } from "./config";

const CACHE_TTL_MS = 60_000;
const MSK_OFFSET_MS = 3 * 3600 * 1000; // MSK = UTC+3, no DST

// Same lazy service-role client pattern as cost.ts — keeps this module free of
// the next/headers import chain so it can sit at the top of any route.
let _client: SupabaseClient | null | undefined;
function client(): SupabaseClient | null {
  if (_client !== undefined) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  _client =
    url && key
      ? createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;
  return _client;
}

function mskDayStart(): Date {
  const mskNow = Date.now() + MSK_OFFSET_MS;
  const dayStartMsk = Math.floor(mskNow / 86_400_000) * 86_400_000;
  return new Date(dayStartMsk - MSK_OFFSET_MS);
}

let cache: { at: number; blocked: boolean } | null = null;

/** Today's (MSK) confirmed LLM spend vs LLM_DAILY_BUDGET_RUB. Cached 60s. */
export async function isSpendBudgetExceeded(): Promise<boolean> {
  const budget = Number(process.env.LLM_DAILY_BUDGET_RUB);
  if (!Number.isFinite(budget) || budget <= 0) return false; // disabled

  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.blocked;

  let blocked = false;
  try {
    const c = client();
    if (c) {
      const { data, error } = await c.rpc("llm_spend_since", {
        p_since: mskDayStart().toISOString(),
      });
      if (error) {
        console.warn("[spend-guard] llm_spend_since failed (fail-open):", error.message);
      } else {
        const spent = Number(data ?? 0);
        blocked = Number.isFinite(spent) && spent >= budget;
        if (blocked) {
          console.warn(
            `[spend-guard] DAILY BUDGET TRIPPED: spent=${spent.toFixed(2)}₽ >= budget=${budget}₽ — LLM routes 503 until MSK midnight`
          );
        }
      }
    }
  } catch (e) {
    console.warn("[spend-guard] check failed (fail-open):", e);
  }
  cache = { at: now, blocked };
  return blocked;
}

/**
 * Route guard. `const blocked = await spendGuard(); if (blocked) return blocked;`
 * as the first line of every LLM-burning route handler. Returns 503 with
 * Retry-After till the next MSK midnight when the daily budget is exceeded.
 */
export async function spendGuard(): Promise<NextResponse | null> {
  if (!(await isSpendBudgetExceeded())) return null;
  const nextMidnightMsk = mskDayStart().getTime() + 86_400_000;
  const retryAfter = Math.max(Math.ceil((nextMidnightMsk - Date.now()) / 1000), 60);
  return NextResponse.json(
    { error: "service_paused", detail: "Дневной лимит обработки исчерпан — сервис возобновит работу завтра." },
    { status: 503, headers: { "Retry-After": String(retryAfter) } }
  );
}

// ── Per-user daily breaker (СЛОЙ-2) ────────────────────────────────────────
//
// Mirrors the global breaker above but scoped to one user_id and checked against
// that user's TIER budget (config.LLM_DAILY_BUDGET_RUB_BY_TIER). Catches a single
// abuser looping the unquota'd LLM routes without that abuse ever showing up in
// operational quota — while the global breaker (#115) stays as the aggregate
// backstop. Same stance as the global one: 60s cache (here per-user), fail-open,
// 503 with Retry-After to the next MSK midnight. cost_rub IS NULL rows are
// excluded by the RPC's sum() — confirmed ₽ only.

const perUserCache = new Map<string, { at: number; blocked: boolean }>();

/** Best-effort tier lookup for a user (only when the route didn't supply it). */
async function resolveTier(userId: string): Promise<string | null> {
  const c = client();
  if (!c) return null;
  const { data, error } = await c
    .from("profiles")
    .select("tier")
    .eq("id", userId)
    .single();
  if (error || !data) return null;
  return (data as { tier?: string | null }).tier ?? null;
}

/** Today's (MSK) confirmed spend for one user vs their tier budget. Cached 60s. */
export async function isUserSpendBudgetExceeded(
  userId: string,
  tier?: string | null
): Promise<boolean> {
  if (!userId) return false; // nothing to attribute → fail-open

  // Kill-switch (safe rollout, same stance as the global breaker's env gate):
  // ship the code dormant, apply migration 0013, smoke-test, THEN arm by setting
  // PER_USER_SPEND_GUARD=1 on the VPS. Unset/≠"1" → disabled, instant rollback
  // without a redeploy or migration revert.
  if (process.env.PER_USER_SPEND_GUARD !== "1") return false;

  const now = Date.now();
  const cached = perUserCache.get(userId);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.blocked;

  let blocked = false;
  try {
    const c = client();
    if (c) {
      // Budget from the caller's tier when it has one (requireAuthAndQuota
      // routes), else fetched from profiles. Unknown tier → free (conservative).
      const resolvedTier = tier ?? (await resolveTier(userId));
      const budget = dailyBudgetRubForTier(resolvedTier);
      // Infinity (enterprise) → never per-user-capped; skip the spend query.
      if (Number.isFinite(budget)) {
        const { data, error } = await c.rpc("llm_spend_today_for_user", {
          p_user: userId,
          p_since: mskDayStart().toISOString(),
        });
        if (error) {
          console.warn(
            "[spend-guard] llm_spend_today_for_user failed (fail-open):",
            error.message
          );
        } else {
          const spent = Number(data ?? 0);
          blocked = Number.isFinite(spent) && spent >= budget;
          if (blocked) {
            console.warn(
              `[spend-guard] PER-USER BUDGET TRIPPED: user=${userId} spent=${spent.toFixed(
                2
              )}₽ >= budget=${budget}₽ (tier=${resolvedTier ?? "unknown"}) — 503 until MSK midnight`
            );
          }
        }
      }
    }
  } catch (e) {
    console.warn("[spend-guard] per-user check failed (fail-open):", e);
  }

  perUserCache.set(userId, { at: now, blocked });
  // Bound the Map on long-lived instances: prune expired entries past a cap.
  if (perUserCache.size > 5000) {
    for (const [k, v] of perUserCache) {
      if (now - v.at >= CACHE_TTL_MS) perUserCache.delete(k);
    }
  }
  return blocked;
}

/**
 * Per-user route guard. Call AFTER the global `spendGuard()` and AFTER
 * `requireAuth` (needs the user id). Pass `tier` when the route already resolved
 * it (requireAuthAndQuota routes); otherwise it is fetched. Returns 503 with
 * Retry-After till the next MSK midnight when the user's daily budget is hit.
 */
export async function perUserSpendGuard(
  userId: string,
  tier?: string | null
): Promise<NextResponse | null> {
  if (!(await isUserSpendBudgetExceeded(userId, tier))) return null;
  const nextMidnightMsk = mskDayStart().getTime() + 86_400_000;
  const retryAfter = Math.max(Math.ceil((nextMidnightMsk - Date.now()) / 1000), 60);
  return NextResponse.json(
    {
      error: "user_daily_limit",
      detail:
        "Дневной лимит обработки по вашему аккаунту исчерпан — он обновится завтра.",
    },
    { status: 503, headers: { "Retry-After": String(retryAfter) } }
  );
}
