// Single Next.js middleware that does three things, in order:
//   1. next-intl routing (locale detection, /ru/* → / rewrites when locale is default)
//   2. Supabase session cookie refresh (keeps auth alive across tabs/reloads)
//   3. Auth guard — unauthenticated access to /search, /landscape, /report
//      gets redirected to /login with a `?next=` param.
//
// Why one middleware and not three: Next.js only runs one middleware file per
// project. Each concern is still isolated in its own helper.

import createMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";
import { refreshSupabaseSession } from "./lib/supabase-middleware";

const handleI18nRouting = createMiddleware(routing);

// Locale prefix is optional (`as-needed`): default locale (ru) has bare paths.
// Matches: /search, /en/search, /landscape, /en/landscape/report, /report, etc.
const PROTECTED_PATH_RE =
  /^\/(?:(?:en|ru)\/)?(?:search|landscape|report)(?:\/|$)/;

export default async function middleware(request: NextRequest) {
  // 1. Locale routing. next-intl may return a redirect (wrong/stale locale) —
  //    if so, don't bother refreshing the session on a throwaway response.
  const intlResponse = handleI18nRouting(request);
  if (intlResponse.status >= 300 && intlResponse.status < 400) {
    return intlResponse;
  }

  // 2. Session refresh — also gives us the resolved user for the guard below.
  const { response, user } = await refreshSupabaseSession(request, intlResponse);

  // 3. Auth guard.
  if (!user && PROTECTED_PATH_RE.test(request.nextUrl.pathname)) {
    const localeMatch = request.nextUrl.pathname.match(/^\/(en|ru)\//);
    // Preserve explicit /en/ prefix. Default locale (ru) has no prefix.
    const prefix =
      localeMatch && localeMatch[1] !== routing.defaultLocale
        ? `/${localeMatch[1]}`
        : "";
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = `${prefix}/login`;
    loginUrl.search = "";
    loginUrl.searchParams.set(
      "next",
      request.nextUrl.pathname + request.nextUrl.search
    );
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
