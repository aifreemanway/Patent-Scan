// Magic-link callback. Supabase redirects users here with `?code=<pkce>` after
// they click the link in their inbox. We exchange that code for a session,
// which sets the auth cookies — then redirect to the app.

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase-server";
import { routing } from "@/i18n/routing";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ locale: string }> }
) {
  const { locale: rawLocale } = await params;
  const locale = (routing.locales as readonly string[]).includes(rawLocale)
    ? rawLocale
    : routing.defaultLocale;

  const { searchParams } = new URL(req.url);
  // Same proxy-origin issue as /api/auth/login: behind the nginx TLS proxy,
  // req.url's origin is the internal host (localhost:3000), so the post-exchange
  // redirect would send the user to localhost. Use the forwarded headers nginx sets.
  const fwdHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const fwdProto =
    req.headers.get("x-forwarded-proto") ??
    new URL(req.url).protocol.replace(":", "");
  const origin = fwdHost ? `${fwdProto}://${fwdHost}` : new URL(req.url).origin;
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  // Prefix paths with locale unless it's the default (`as-needed` in routing config).
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  // Reject protocol-relative (`//evil.com`) as defense-in-depth even though
  // the subsequent `${origin}${prefix}${next}` concat would keep it same-origin.
  const safeNext =
    next && next.startsWith("/") && !next.startsWith("//") ? next : "/search";
  const successUrl = `${origin}${prefix}${safeNext}`;
  const errorUrl = `${origin}${prefix}/login?error=invalid_link`;

  if (!code) return NextResponse.redirect(errorUrl);

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("[auth/callback] exchange failed:", error.message);
    return NextResponse.redirect(errorUrl);
  }

  return NextResponse.redirect(successUrl);
}
