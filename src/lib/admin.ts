// Admin gate for the /admin panel (Phase 1: read-only).
//
// Allowlist via the server-side env `ADMIN_EMAILS` (CSV). ⚠ STRICTLY server-side
// — NOT `NEXT_PUBLIC_*`: the allowlist must never reach the client bundle. This
// module imports supabase-server (cookies), so it is server-only by construction
// — importing it from a client component is a build error, which is the intended
// guardrail.
//
// Non-admins (signed-out OR signed-in-but-not-allowlisted) get a silent
// notFound() — /admin's very existence is not disclosed (spec §1: «тихий 404, не
// 403 с раскрытием»). The gate opens every user's PII, so the bar is an explicit
// allowlist, never a tier/role flag.

import { notFound } from "next/navigation";
import { requireUser, UnauthorizedError } from "./supabase-server";
import type { User } from "@supabase/supabase-js";
import { isAdminEmail } from "./admin-emails";

// The pure allowlist check (gmail canonicalisation + ADMIN_EMAILS membership)
// lives in admin-emails.ts — no server imports — so light callers like the
// auth/login admin throttle can use it without pulling next/navigation +
// supabase-server. Re-export so existing `@/lib/admin` importers keep one entry.
export { isAdminEmail };

/**
 * Resolve the current user IFF they are an allowlisted admin, else null.
 * Returns null (never throws) for both unauthenticated and non-admin users so
 * the caller can render a uniform silent 404.
 */
export async function getAdminUser(): Promise<User | null> {
  try {
    const { user } = await requireUser();
    return isAdminEmail(user.email) ? user : null;
  } catch (e) {
    if (e instanceof UnauthorizedError) return null;
    throw e; // unexpected (e.g. Supabase down) — surface it, don't mask as 404
  }
}

/**
 * Page guard: return the admin user, or short-circuit with a silent 404.
 * MUST be called at the top of every /admin server component — gating only in
 * the layout is insufficient (client-side navigations re-run the page RSC but
 * not the layout, and admin data flows through the service-role client, so an
 * ungated page would leak data on such a navigation).
 */
export async function requireAdminPage(): Promise<User> {
  const user = await getAdminUser();
  if (!user) notFound();
  return user;
}
