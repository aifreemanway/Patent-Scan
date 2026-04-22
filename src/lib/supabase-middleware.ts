// Refreshes Supabase auth cookies on each request and returns the resolved
// user. Called from the Next.js middleware (src/proxy.ts).
//
// Based on https://supabase.com/docs/guides/auth/server-side/nextjs

import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

export async function refreshSupabaseSession(
  request: NextRequest,
  response: NextResponse
): Promise<{ response: NextResponse; user: User | null }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // If Supabase isn't configured (e.g. local dev before credentials added), skip silently.
  if (!url || !anonKey) return { response, user: null };

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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response: supabaseResponse, user };
}
