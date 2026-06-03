// Server-side Supabase helpers for Next.js App Router.
// - createSupabaseServer(): user-scoped client using auth cookies (RLS applies).
//   Use this in server components, route handlers, server actions.
// - createSupabaseAdmin(): service-role client that bypasses RLS.
//   Use only for trusted privileged ops (e.g. calling the increment_usage RPC).
// - requireUser() / requireVerifiedUser(): guards for protected routes.

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
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

// ── Short-TTL validated-user cache — READ-ONLY internal fan-out routes ONLY ──
//
// A single novelty search fans out ~450 internal calls (landscape/search ×N,
// prior-art-rank, facet-decompose, landscape/plan). Each calls getUser() — a
// network round-trip to Supabase GoTrue — so one search fires ~450 auth
// validations and blows past the Free-tier auth rate limit: throttled calls
// 401, get swallowed as empty results, and POISON retrieval (this was the
// cause of the contaminated P2 v2 run — etalon AND caisson dropped out at once).
// Caching the validated user keyed by the exact access-token for ~60s collapses
// that burst to a single real validation.
//
// 🔒 SCOPE GUARDRAIL (cofounder 2026-06-03, RISK auth/деньги): use
// requireVerifiedUserCached / requireAuthCached ONLY on read-only search routes.
// PAYMENT / CHECKOUT / WEBHOOK / QUOTA-CHARGE / any mutating or billed route MUST
// keep the uncached requireUser / requireVerifiedUser / requireAuth — a stale
// token on a payment or idempotency path is unacceptable. Worst case here: a
// just-logged-out user runs one more search within the 60s window — acceptable.
// SECURITY: keyed by the exact signed JWT, so a forged/invalid token can never
// hit a cached entry (it would have to equal a real token validated <60s ago,
// i.e. already be that user's own token). getSession() reads the token from the
// cookie store LOCALLY (no network); it's used only to derive the cache key —
// the cached user itself always came from a real getUser().
const USER_CACHE_TTL_MS = 60_000;
// Store both maps on globalThis. Next dev compiles each route into its own
// module graph and re-evaluates on HMR, so a plain module-level `const Map` is
// duplicated per-route-bundle and reset on reload — the cache never accumulates
// across the fan-out (this is why an earlier iteration STILL showed ~700
// throttles: every route got its own empty Map). A globalThis singleton is the
// standard Next pattern (cf. the dev Prisma-client pattern) and is shared across
// all route bundles in both dev and prod.
//
// In-flight de-dupe (single-flight) lives in __inflightUser: concurrent callers
// sharing the same auth cookie await ONE getUser() promise instead of each
// firing its own. A result cache alone does NOT tame the fan-out — the cold
// burst all miss before the first validation writes the cache. An earlier
// iteration keyed off getSession().access_token, but getSession() returns null
// in this SSR route context → cache inert. We key off the RAW auth cookie.
const _g = globalThis as typeof globalThis & {
  __verifiedUserCache?: Map<string, { user: User; expires: number }>;
  __inflightUser?: Map<string, Promise<User>>;
  __authcacheKeyNullLogged?: boolean;
  __authcacheGetUserCount?: number;
};
const verifiedUserCache = (_g.__verifiedUserCache ??= new Map<
  string,
  { user: User; expires: number }
>());
const inflightUser = (_g.__inflightUser ??= new Map<string, Promise<User>>());

// Concatenate the Supabase auth cookie(s) into one stable per-session key.
// supabase-ssr may chunk a large session across sb-<ref>-auth-token.0/.1, so we
// collect every matching cookie, sort by name, and join the values.
async function authCookieKey(): Promise<string | null> {
  const store = await cookies();
  const parts = store
    .getAll()
    .filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => c.value);
  return parts.length ? parts.join("") : null;
}

export async function requireVerifiedUserCached() {
  const supabase = await createSupabaseServer();
  const key = await authCookieKey();

  // No auth cookie at all → validate fresh (it will 401). Nothing to cache.
  if (!key) {
    if (process.env.AUTHCACHE_DEBUG && !_g.__authcacheKeyNullLogged) {
      _g.__authcacheKeyNullLogged = true;
      console.error("[authcache] cookie key is NULL — cache cannot engage");
    }
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) throw new UnauthorizedError();
    if (!user.email_confirmed_at) throw new UnverifiedEmailError();
    return { user, supabase };
  }

  const hit = verifiedUserCache.get(key);
  if (hit && hit.expires > Date.now()) return { user: hit.user, supabase };

  // Single-flight: first caller creates the validation promise; everyone with
  // the same cookie in the same burst awaits it → one getUser() for the wave.
  let pending = inflightUser.get(key);
  if (!pending) {
    pending = (async () => {
      if (process.env.AUTHCACHE_DEBUG) {
        _g.__authcacheGetUserCount = (_g.__authcacheGetUserCount ?? 0) + 1;
        console.error(
          `[authcache] network getUser #${_g.__authcacheGetUserCount} (cache miss; keyLen=${key.length})`
        );
      }
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (error || !user) throw new UnauthorizedError();
      if (!user.email_confirmed_at) throw new UnverifiedEmailError();
      verifiedUserCache.set(key, {
        user,
        expires: Date.now() + USER_CACHE_TTL_MS,
      });
      // Opportunistic prune so the map can't grow unbounded under token churn.
      if (verifiedUserCache.size > 500) {
        const now = Date.now();
        for (const [k, v] of verifiedUserCache) {
          if (v.expires <= now) verifiedUserCache.delete(k);
        }
      }
      return user;
    })();
    inflightUser.set(key, pending);
    // Clear the in-flight slot once settled (success or failure) so a later
    // burst re-validates after the result-cache entry expires. Swallow the
    // settle-chain rejection here (callers handle the real one via `await`).
    void pending
      .catch(() => undefined)
      .finally(() => {
        if (inflightUser.get(key) === pending) inflightUser.delete(key);
      });
  }

  const user = await pending;
  return { user, supabase };
}
