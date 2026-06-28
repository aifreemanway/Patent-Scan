// Refreshes Supabase auth cookies on each request and returns the resolved
// user. Called from the Next.js middleware (src/proxy.ts).
//
// Based on https://supabase.com/docs/guides/auth/server-side/nextjs

import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import type { NextRequest, NextResponse } from "next/server";

export async function refreshSupabaseSession(
  request: NextRequest,
  response: NextResponse
): Promise<{ response: NextResponse; user: User | null }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // If Supabase isn't configured (e.g. local dev before credentials added), skip silently.
  if (!url || !anonKey) return { response, user: null };

  // We attach refreshed auth cookies onto THIS response (the one next-intl
  // produced) and return it as-is — see setAll below for why we never rebuild it.
  const supabaseResponse = response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Mutate the request cookies so a same-pass downstream render sees the
        // refreshed values.
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        // Apply auth cookies onto the response next-intl ALREADY produced — do
        // NOT rebuild it with NextResponse.next(). A fresh response drops
        // next-intl's `x-middleware-rewrite` (e.g. / → /ru) and `NEXT_LOCALE`
        // cookie; losing the rewrite makes bare "/" 404 — it has no route of its
        // own (only `[locale]`). This bit returning users / TG-webview whose
        // stale `sb-auth-auth-token` triggers a cookie clear right here. Repro:
        //   curl -H 'Cookie: sb-auth-auth-token=bogus' https://patent-scan.ru/
        // was 404; after this fix it is 200 with x-middleware-rewrite:/ru.
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // IMPORTANT (per Supabase docs): do NOT add logic between createServerClient
  // and getUser(). Anything in between can break session refresh in subtle ways.
  //
  // Fail-open: getUser() returns user:null on a bad cookie (it does not throw in
  // practice), but a network blip to the auth server CAN throw. The middleware
  // runs on every request — an uncaught throw here would 404/500 the whole site.
  // On any failure, treat as logged-out and return the (rewrite-bearing) response.
  let user: User | null = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch {
    user = null;
  }

  return { response: supabaseResponse, user };
}
