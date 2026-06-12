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
import { rateLimit, clientIp } from "@/lib/rate-limit";
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
  /** Optional opt-in for marketing channel (separate from the required primary
   *  consent). When true, the signup trigger stamps profiles.marketing_consent_at;
   *  false / omitted leaves it null. Defaults to false. */
  marketingConsent?: unknown;
  /** Куда вернуть после магик-линка (path, напр. /account/billing?plan=team).
   *  Протаскивается в emailRedirectTo → читается серверным /auth/callback. */
  next?: unknown;
};

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
  const marketingConsent = body.marketingConsent === true;

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
  // Behind the nginx TLS proxy, `req.url` carries the INTERNAL origin
  // (http://127.0.0.1:3000) — so `${origin}/auth/callback` wouldn't match the
  // Supabase redirect allow-list, and Supabase silently falls back to the Site
  // URL root (dropping our /auth/callback path → the code lands on `/` and is
  // never exchanged). Derive the public origin from the headers nginx sets.
  const fwdHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const fwdProto =
    req.headers.get("x-forwarded-proto") ??
    new URL(req.url).protocol.replace(":", "");
  const origin = fwdHost ? `${fwdProto}://${fwdHost}` : new URL(req.url).origin;
  const callbackPath =
    locale === routing.defaultLocale
      ? "/auth/callback"
      : `/${locale}/auth/callback`;
  // Optional post-login destination from landing/pricing CTAs. Validate it's a
  // same-origin path (starts with "/", reject protocol-relative "//") before
  // threading it into the magic link; the callback re-validates and defaults to
  // /search if absent/unsafe.
  const rawNext = typeof body.next === "string" ? body.next : "";
  const safeNext =
    rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "";
  const emailRedirectTo = safeNext
    ? `${origin}${callbackPath}?next=${encodeURIComponent(safeNext)}`
    : `${origin}${callbackPath}`;

  const { error } = await supabase.auth.signInWithOtp({
    email: validation.normalized,
    options: {
      emailRedirectTo,
      shouldCreateUser: true,
      // Lands in auth.users.raw_user_meta_data on signup; handle_new_user()
      // reads it and stamps profiles.marketing_consent_at atomically with the
      // profile row creation. For existing users (login, not signup) the
      // trigger doesn't fire, so this value is ignored on re-logins —
      // existing consent state is preserved exactly as it was.
      data: { marketing_consent: marketingConsent },
    },
  });

  if (error) {
    // Log server-side only — client gets a generic code so we don't leak
    // upstream SMTP / Supabase internals (e.g. API key messages, bounce reasons).
    console.error("[auth/login] signInWithOtp failed:", error.message);
    return fail("otp_send_failed", 502);
  }

  return NextResponse.json({ ok: true });
}
