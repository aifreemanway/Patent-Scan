// Per-user quota enforcement. Calls the Postgres `increment_usage()` function
// atomically via the service-role client. One call = one check + one charge.
//
// Keep QUOTA_LIMITS in sync with the same-named constants inside
// `supabase/migrations/0001_auth_and_quotas.sql` (function increment_usage).

import { createSupabaseAdmin } from "./supabase-server";

export type QuotaOperation = "search" | "landscape" | "analyze" | "questions";

export type QuotaChargeResult =
  | {
      ok: true;
      tier: string;
      used: number;
      limit: number;
      remaining: number;
    }
  | {
      ok: false;
      reason: "quota_exceeded";
      tier: string;
      used: number;
      limit: number;
    }
  | {
      ok: false;
      reason: "no_profile" | "internal_error";
    };

/**
 * Atomically checks if the user can perform `operation` this month, and if so,
 * increments the counter. Call this right after auth in every paid API route.
 *
 * On success → proceed with the operation.
 * On `quota_exceeded` → return HTTP 402 Payment Required with limit info.
 * On `no_profile` / `internal_error` → HTTP 500.
 */
export async function checkAndChargeQuota(
  userId: string,
  operation: QuotaOperation
): Promise<QuotaChargeResult> {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin.rpc("increment_usage", {
    p_user_id: userId,
    p_operation: operation,
  });

  if (error) {
    console.error("[quota] increment_usage rpc failed", {
      message: error.message,
      userId,
      operation,
    });
    return { ok: false, reason: "internal_error" };
  }

  if (!data || typeof data !== "object") {
    console.error("[quota] unexpected rpc response shape", { data });
    return { ok: false, reason: "internal_error" };
  }

  const d = data as {
    allowed: boolean;
    reason?: string;
    limit?: number;
    used?: number;
    remaining?: number;
    tier?: string;
  };

  if (!d.allowed) {
    if (d.reason === "quota_exceeded") {
      return {
        ok: false,
        reason: "quota_exceeded",
        tier: d.tier ?? "unknown",
        used: d.used ?? 0,
        limit: d.limit ?? 0,
      };
    }
    return {
      ok: false,
      reason: d.reason === "no_profile" ? "no_profile" : "internal_error",
    };
  }

  return {
    ok: true,
    tier: d.tier ?? "unknown",
    used: d.used ?? 0,
    limit: d.limit ?? 0,
    remaining: d.remaining ?? 0,
  };
}
