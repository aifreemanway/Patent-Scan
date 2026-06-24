// POST /api/billing/webhook — ЮKassa payment notifications (design §3 + §12).
//
// SECURITY (RISK-critical):
//   1. IP-allowlist (defense-in-depth) — reject non-ЮKassa source IPs.
//   2. NEVER trust the notification body — re-verify the real status with
//      GET /payments/{id} before granting anything.
//   3. Idempotency lives in apply_successful_payment (UNIQUE yookassa_payment_id
//      + no-op if already succeeded), so a retried webhook never double-grants.
//
// Always return 200 once a notification has been HANDLED (incl. already-applied
// and irrelevant statuses) so ЮKassa stops retrying. Return non-2xx ONLY when we
// genuinely could not process (reverify/apply error) so ЮKassa retries later.

import { NextResponse } from "next/server";
import { clientIp } from "@/lib/rate-limit";
import { createSupabaseAdmin } from "@/lib/supabase-server";
import { getPayment } from "@/lib/yookassa";
import { isYooKassaIp, tierFromPurpose } from "@/lib/billing";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  // 1. IP-allowlist.
  const ip = clientIp(req);
  if (!isYooKassaIp(ip)) {
    console.warn("[billing/webhook] rejected non-ЮKassa source", { ip });
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { event?: unknown; object?: { id?: unknown } } | null;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // Malformed body — nothing to act on; ack so it isn't retried forever.
    return NextResponse.json({ ok: true });
  }

  const paymentId =
    body && typeof body.object?.id === "string" ? body.object.id : null;
  if (!paymentId) return NextResponse.json({ ok: true });

  // 2. Re-verify with ЮKassa (authoritative — body is not trusted).
  let payment;
  try {
    payment = await getPayment(paymentId);
  } catch (e) {
    console.error("[billing/webhook] reverify failed", {
      paymentId,
      message: e instanceof Error ? e.message : String(e),
    });
    // Could not verify → let ЮKassa retry.
    return NextResponse.json({ error: "reverify_failed" }, { status: 502 });
  }

  if (payment.status !== "succeeded") {
    // pending / waiting_for_capture / canceled — mirror status, nothing to grant.
    const admin = createSupabaseAdmin();
    await admin
      .from("payments")
      .update({ status: payment.status })
      .eq("yookassa_payment_id", paymentId);
    return NextResponse.json({ ok: true });
  }

  // 3. Succeeded → resolve plan from the payment's own metadata and apply ONCE.
  const purpose = String(payment.metadata?.purpose ?? "");
  const resolved = tierFromPurpose(purpose);
  if (!resolved) {
    // Not a subscription grant (e.g. one-report) — mark succeeded, no tier change.
    const admin = createSupabaseAdmin();
    await admin
      .from("payments")
      .update({ status: "succeeded", captured_at: new Date().toISOString() })
      .eq("yookassa_payment_id", paymentId);
    return NextResponse.json({ ok: true });
  }

  const admin = createSupabaseAdmin();
  const savedMethodId =
    typeof payment.payment_method?.id === "string"
      ? payment.payment_method.id
      : null;
  const { data, error } = await admin.rpc("apply_successful_payment", {
    p_yookassa_payment_id: paymentId,
    p_tier: resolved.tier,
    p_period_months: resolved.periodMonths,
    p_payment_method_id: savedMethodId,
  });
  if (error) {
    console.error("[billing/webhook] apply failed", { paymentId, message: error.message });
    return NextResponse.json({ error: "apply_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, result: data });
}
