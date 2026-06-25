// POST /api/billing/subscription — self-service subscription management (design
// §5, Vsevolod hard-req): cancel (cancel_at_period_end=true → access stays until
// period end, then the expiry pass downgrades to free) and resume (set back
// false). Reversible, money-safe: it toggles a flag, never charges or refunds.
//
// Not gated by BILLING_LIVE — it only acts on a subscription the user already
// has (card or invoice-activated); a no-op 404 when there is no active sub.

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-quota";
import { rateLimit } from "@/lib/rate-limit";
import { createSupabaseAdmin } from "@/lib/supabase-server";
import { RATE_WINDOW_MS } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(req: Request) {
  const rl = await rateLimit(req, {
    windowMs: RATE_WINDOW_MS,
    max: 10,
    keyPrefix: "billing-subscription",
  });
  if (rl) return rl;

  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  let body: { action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const action = body.action;
  if (action !== "cancel" && action !== "resume") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from("subscriptions")
    .update({
      cancel_at_period_end: action === "cancel",
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", guard.user.id)
    .eq("status", "active")
    .select("tier, status, current_period_end, cancel_at_period_end")
    .maybeSingle();

  if (error) {
    console.error("[billing/subscription] update failed", {
      userId: guard.user.id,
      action,
      message: error.message,
    });
    return NextResponse.json({ error: "update_failed" }, { status: 502 });
  }
  if (!data) {
    return NextResponse.json({ error: "no_subscription" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, subscription: data });
}
