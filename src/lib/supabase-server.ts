// Server-side Supabase helpers for Next.js App Router.
// - createSupabaseServer(): user-scoped client using auth cookies (RLS applies).
//   Use this in server components, route handlers, server actions.
// - createSupabaseAdmin(): service-role client that bypasses RLS.
//   Use only for trusted privileged ops (e.g. calling the increment_usage RPC).
// - requireUser() / requireVerifiedUser(): guards for protected routes.

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export async function createSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — cookies are read-only there.
            // The middleware will refresh the session on the next request.
          }
        },
      },
    }
  );
}

/**
 * Admin client with service_role key — bypasses RLS.
 * Only call from trusted server code (route handlers, server actions).
 * NEVER expose to client.
 */
export function createSupabaseAdmin(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
}

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}

export class UnverifiedEmailError extends Error {
  constructor() {
    super("email_not_verified");
    this.name = "UnverifiedEmailError";
  }
}

/**
 * Returns authenticated user or throws UnauthorizedError.
 * Does NOT require verified email — use requireVerifiedUser for API routes.
 */
export async function requireUser() {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new UnauthorizedError();
  return { user, supabase };
}

/**
 * Returns user with confirmed email, or throws UnverifiedEmailError.
 * Use in API routes where we bill operations — prevents abuse via
 * unconfirmed signups.
 */
export async function requireVerifiedUser() {
  const result = await requireUser();
  if (!result.user.email_confirmed_at) throw new UnverifiedEmailError();
  return result;
}
