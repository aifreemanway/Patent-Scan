// One-shot guard for API routes: resolves user + enforces quota in a single call.
// Returns either an HTTP response (short-circuit — caller just returns it) or
// a `{ user }` payload to continue with.

import { NextResponse } from "next/server";
import {
  requireVerifiedUser,
  UnauthorizedError,
  UnverifiedEmailError,
} from "./supabase-server";
import { checkAndChargeQuota, type QuotaOperation } from "./quota";
import type { User } from "@supabase/supabase-js";

export type AuthGuardResult =
  | { ok: true; user: User }
  | { ok: false; response: NextResponse };

/**
 * Verified-email gate. Use in routes that need to know who the user is but
 * don't consume a quota slot (e.g. clarifying questions, cheap gate checks).
 */
export async function requireAuth(): Promise<AuthGuardResult> {
  try {
    const { user } = await requireVerifiedUser();
    return { ok: true, user };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "unauthorized" },
          { status: 401 }
        ),
      };
    }
    if (e instanceof UnverifiedEmailError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "email_not_verified" },
          { status: 403 }
        ),
      };
    }
    console.error("[auth-quota] unexpected auth error:", e);
    return {
      ok: false,
      response: NextResponse.json(
        { error: "internal_error" },
        { status: 500 }
      ),
    };
  }
}

/**
 * Verified-email gate + atomic quota charge. Use in paid routes
 * (analyze, search, landscape plan).
 *
 * - 401 unauthorized → user not signed in
 * - 403 email_not_verified → user signed in but hasn't clicked magic link
 * - 402 quota_exceeded → monthly limit hit (with limit/used in body)
 * - 500 internal_error → DB or RPC failure
 */
export async function requireAuthAndQuota(
  operation: QuotaOperation
): Promise<AuthGuardResult> {
  const auth = await requireAuth();
  if (!auth.ok) return auth;

  const quota = await checkAndChargeQuota(auth.user.id, operation);
  if (quota.ok) return auth;

  if (quota.reason === "quota_exceeded") {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "quota_exceeded",
          tier: quota.tier,
          limit: quota.limit,
          used: quota.used,
          operation,
        },
        { status: 402 }
      ),
    };
  }

  // no_profile or internal_error — both server-side. Don't expose reason.
  return {
    ok: false,
    response: NextResponse.json(
      { error: "internal_error" },
      { status: 500 }
    ),
  };
}
