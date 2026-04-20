// Refreshes Supabase auth cookies on each request.
// Middleware wiring in proxy.ts (Этап 3 of B1) — not used yet.
//
// Based on https://supabase.com/docs/guides/auth/server-side/nextjs

import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export async function refreshSupabaseSession(
  request: NextRequest,
  response: NextResponse
): Promise<NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // If Supabase isn't configured (e.g. local dev before Этап 3), skip silently.
  if (!url || !anonKey) return response;

  let supabaseResponse = response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // IMPORTANT (per Supabase docs): do NOT add logic between createServerClient
  // and getUser(). Anything in between can break session refresh in subtle ways.
  await supabase.auth.getUser();

  return supabaseResponse;
}
