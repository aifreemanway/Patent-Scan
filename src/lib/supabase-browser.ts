// Client-side Supabase helper. Use in Client Components only.
// Authenticates via cookies set by the server helper — no separate session
// management needed.

"use client";

import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
