// POST /api/billing/checkout — start a subscription payment (design §3).
// requireAuth → resolve plan → ЮKassa createPayment (with 54-ФЗ receipt +
// save_payment_method for recurring) → record a pending payments row → return
// the confirmation_url for the client to redirect to.
//
// Hard-gated behind BILLING_LIVE: the configured ЮKassa key is a LIVE key, so
// until launch this route refuses to create real charges.

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAuth } from "@/lib/auth-quota";
import { rateLimit } from "@/lib/rate-limit";
import { createSupabaseAdmin } from "@/lib/supabase-server";
import { createPayment } from "@/lib/yookassa";
import { planFor, buildReceipt } from "@/lib/billing";
import { BILLING_LIVE, RATE_WINDOW_MS } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  if (!BILLING_LIVE) {
    return NextResponse.json({ error: "billing_disabled" }, { status: 503 });
  }

  const rl = await rateLimit(req, {
    windowMs: RATE_WINDOW_MS,
    max: 10,
    keyPrefix: "billing-checkout",
  });
  if (rl) return rl;

  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  let body: { tier?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const plan = planFor(typeof body.tier === "string" ? body.tier : "");
  if (!plan) return NextResponse.json({ error: "invalid_tier" }, { status: 400 });

  // Public origin behind the nginx TLS proxy (same trick as /api/auth/login).
  const fwdHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const fwdProto = req.headers.get("x-forwarded-proto") ?? "https";
  const origin = fwdHost ? `${fwdProto}://${fwdHost}` : new URL(req.url).origin;
  const returnUrl = `${origin}/account/billing?status=return`;

  const idempotenceKey = randomUUID();
  const email = guard.user.email ?? undefined;
  const description = `Подписка ${plan.tier} — Патент·Скан`;

  try {
    const payment = await createPayment(
      {
        amountRub: plan.priceRub,
        description,
        returnUrl,
        savePaymentMethod: true, // recurring (D1) — saved on first success
        capture: true,
        metadata: {
          user_id: guard.user.id,
          purpose: plan.purpose,
          tier: plan.tier,
          period_months: plan.periodMonths,
        },
        receipt: email ? buildReceipt(email, description, plan.priceRub) : undefined,
      },
      idempotenceKey
    );

    // Record the pending payment (the webhook later flips it to succeeded via the
    // idempotent RPC). UNIQUE(yookassa_payment_id) guards against a double insert.
    const admin = createSupabaseAdmin();
    const { error } = await admin.from("payments").insert({
      user_id: guard.user.id,
      yookassa_payment_id: payment.id,
      status: payment.status,
      amount: plan.priceRub,
      currency: "RUB",
      purpose: plan.purpose,
      period_months: plan.periodMonths,
      is_recurring: true,
      idempotence_key: idempotenceKey,
      metadata: { tier: plan.tier },
    });
    if (error) {
      console.error("[billing/checkout] payment row insert failed", {
        message: error.message,
      });
      // The ЮKassa payment exists; surface an error but the webhook can still
      // reconcile by yookassa_payment_id if the row is created later. For v1 we
      // fail the request so the user retries rather than paying into a void.
      return NextResponse.json({ error: "checkout_failed" }, { status: 502 });
    }

    const confirmationUrl = payment.confirmation?.confirmation_url;
    if (!confirmationUrl) {
      return NextResponse.json({ error: "no_confirmation_url" }, { status: 502 });
    }
    return NextResponse.json({ confirmationUrl, paymentId: payment.id });
  } catch (e) {
    console.error("[billing/checkout] create failed", {
      message: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: "checkout_failed" }, { status: 502 });
  }
}
