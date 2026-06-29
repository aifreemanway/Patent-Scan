// Pure admin-email allowlist matching — env-only, NO server imports (no
// next/navigation, no supabase-server). Split out of admin.ts so light callers
// (e.g. the auth/login route's admin throttle) can check membership without
// pulling the server-only /admin page guards into their module graph.
//
// Gmail ignores dots in the local part and any "+tag" suffix, and
// gmail.com == googlemail.com — so vsevolod.kobzar@gmail.com,
// vsevolodkobzar@gmail.com and vsevolodkobzar+x@gmail.com are ONE inbox.
// Canonicalize both sides before comparing, or an exact-string match 404s a
// legit admin over a cosmetic dot (real bug 2026-06-10: registered login was
// vsevolodkobzar@gmail.com, allowlist had the dotted form).

export function canonicalEmail(email: string): string {
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
