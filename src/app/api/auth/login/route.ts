// Magic-link login orchestrator.
//   1. Turnstile (blocks ~95% of bots)
//   2. Email validation (format + disposable blocklist + MX record)
//   3. Per-IP throttle (3 magic links per 24h from one IP)
//   4. Supabase signInWithOtp → email with magic link
//
// Client calls POST /api/auth/login with { email, turnstileToken, locale? }.
// Response shape: { ok: true } on success, { error: <code> } on failure.

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase-server";
import { rateLimit } from "@/lib/rate-limit";
import { verifyTurnstile } from "@/lib/turnstile";
import { validateEmail } from "@/lib/email-validator";
import { SIGNUP_IP_LIMIT } from "@/lib/config";
import { routing } from "@/i18n/routing";

export const runtime = "nodejs";
export const maxDuration = 15;

type LoginBody = {
  email?: unknown;
  turnstileToken?: unknown;
  locale?: unknown;
};

function clientIp(req: NextRequest): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null
  );
}

function fail(error: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

export async function POST(req: NextRequest) {
  let body: LoginBody;
  try {
    body = (await req.json()) as LoginBody;
  } catch {
    return fail("invalid_json");
  }

  const email = typeof body.email === "string" ? body.email : "";
  const turnstileToken =
    typeof body.turnstileToken === "string" ? body.turnstileToken : "";
  const rawLocale = typeof body.locale === "string" ? body.locale : "";
  const locale = (routing.locales as readonly string[]).includes(rawLocale)
    ? rawLocale
    : routing.defaultLocale;

  // 1. Turnstile.
  const captcha = await verifyTurnstile(turnstileToken, clientIp(req));
  if (!captcha.ok) {
    const code =
      captcha.reason === "missing_token" ? "captcha_missing" : "captcha_failed";
    return fail(code, 400);
  }

  // 2. Email validation.
  const validation = await validateEmail(email);
  if (!validation.ok) return fail(validation.reason, 400);

  // 3. Per-IP throttle.
  const throttled = await rateLimit(req, {
    ...SIGNUP_IP_LIMIT,
    keyPrefix: "signup-ip",
  });
  if (throttled) return throttled;

  // 4. Magic link.
  const supabase = await createSupabaseServer();
  const origin = new URL(req.url).origin;
  const callbackPath =
    locale === routing.defaultLocale
      ? "/auth/callback"
      : `/${locale}/auth/callback`;
  const emailRedirectTo = `${origin}${callbackPath}`;

  const { error } = await supabase.auth.signInWithOtp({
    email: validation.normalized,
    options: {
      emailRedirectTo,
      shouldCreateUser: true,
    },
  });

  if (error) {
    console.error("[auth/login] signInWithOtp failed:", error.message);
    return fail("otp_send_failed", 502, { detail: error.message });
  }

  return NextResponse.json({ ok: true });
}
