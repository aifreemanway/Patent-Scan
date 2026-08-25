// Sign in with the 6-digit code from the login email.
//
// WHY THIS EXISTS: the magic-link button is spent by a GET, and some mail
// providers prefetch links. Prod, 2026-08-15: a login link was issued at
// 08:47:21 and consumed 28 seconds later from a different IP; the person never
// got a session, saw "link expired", and registered a second account 2.5
// minutes later. A code the human types cannot be spent by a scanner.
//
// The link keeps working — this is an additional door, not a replacement.

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase-server";
import { rateLimit } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/email-validator";

export const runtime = "nodejs";
export const maxDuration = 15;

const CODE_RE = /^\d{6}$/;

/** A 6-digit code is only a million guesses, so the throttle is the thing that
 *  makes it safe — tighter than the signup limit and on its own bucket. GoTrue
 *  caps attempts per token as well; this bounds the whole IP. */
const VERIFY_IP_LIMIT = { windowMs: 15 * 60 * 1000, max: 10 } as const;

function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: NextRequest) {
  let body: { email?: unknown; code?: unknown; next?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("invalid_json");
  }

  const rawEmail = typeof body.email === "string" ? body.email : "";
  const rawCode = typeof body.code === "string" ? body.code.trim() : "";
  if (!rawEmail || !CODE_RE.test(rawCode)) return fail("invalid_code");

  const throttled = await rateLimit(req, {
    windowMs: VERIFY_IP_LIMIT.windowMs,
    max: VERIFY_IP_LIMIT.max,
    keyPrefix: "verify-code-ip",
  });
  if (throttled) return throttled;

  // Must match the address signInWithOtp was called with, or GoTrue looks up a
  // different (or no) user — /api/auth/login normalizes before sending.
  const email = normalizeEmail(rawEmail);

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.verifyOtp({
    email,
    token: rawCode,
    type: "email",
  });

  if (error) {
    // Server-side only: the client gets one generic code, so a wrong digit and
    // an unknown address are indistinguishable to someone probing.
    console.warn("[auth/verify-code] verifyOtp failed:", error.message);
    return fail("invalid_code");
  }

  const rawNext = typeof body.next === "string" ? body.next : "";
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/new-search";

  return NextResponse.json({ ok: true, next });
}
