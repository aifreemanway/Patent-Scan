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

// Gmail ignores dots in the local part and any "+tag" suffix, and
// gmail.com == googlemail.com — so vsevolod.kobzar@gmail.com,
// vsevolodkobzar@gmail.com and vsevolodkobzar+x@gmail.com are ONE inbox.
// Canonicalize both sides before comparing, or an exact-string match 404s a
// legit admin over a cosmetic dot (real bug 2026-06-10: registered login was
// vsevolodkobzar@gmail.com, allowlist had the dotted form).
function canonicalEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 0) return e;
  let local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.split("+")[0].replace(/\./g, "");
    return `${local}@gmail.com`;
  }
  return e;
}

/** Parsed ADMIN_EMAILS as a canonicalized set. Defaults to the founder's email
 *  (spec §1 «стартовое значение = vsevolod.kobzar@gmail.com») so the gate is safe
 *  even before the env is set. */
function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "vsevolod.kobzar@gmail.com")
      .split(",")
      .map((s) => canonicalEmail(s))
      .filter(Boolean)
  );
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().has(canonicalEmail(email));
}

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
