// Billing expiry tick — the one cron required even for manual billing (design
// §5). Hourly: lapse ended subscriptions and downgrade their profiles to free
// via the expire_subscriptions() RPC. Cheap, idempotent, safe to run often.

import type { SupabaseClient } from "@supabase/supabase-js";

export async function expirySubscriptionsTick(
  admin: SupabaseClient
): Promise<void> {
  const { data, error } = await admin.rpc("expire_subscriptions");
  if (error) {
    console.error("[worker/billing] expire_subscriptions failed", {
      message: error.message,
    });
    return;
  }
  const downgraded = typeof data === "number" ? data : 0;
  if (downgraded > 0) {
    console.info(`[worker/billing] expired ${downgraded} subscription(s) → free`);
  }
}
