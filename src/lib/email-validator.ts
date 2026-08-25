// Email normalization + anti-abuse checks before handing off to Supabase OTP.
// Catches disposable domains (mailinator, tempmail, …), empty MX, and
// gmail +alias / dot tricks used to multiply free-tier accounts.

import disposableDomains from "disposable-email-domains";
import { promises as dns } from "dns";

const disposableSet = new Set<string>(disposableDomains as string[]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Domains the npm blocklist does NOT know, seeded from a confirmed abuse case
 * (2026-08-25): safequail626@fommie.online and safequail626@fommie.com were one
 * person burning a fresh Deep-trial per signup (₽16.37 of COGS each). All six
 * belong to VanishInbox — a throwaway-inbox service that self-deletes mailboxes
 * after ~10 minutes.
 *
 * Why they slipped through: `disposable-email-domains` is a static package and
 * carries none of them (verified against 1.0.62, the latest release — updating
 * the package does NOT fix this), and every one of them has live MX records, so
 * the no_mx_record check passed too.
 *
 * Why we match on the domain and not on the MX host: all six point at
 * route1/2/3.mx.cloudflare.net — Cloudflare Email Routing, which thousands of
 * legitimate company and personal domains also use. Blocking that MX would take
 * out real customers, so the domain list stays the mechanism.
 */
const SEEDED_DISPOSABLE_DOMAINS = [
  "fommie.com",
  "fommie.online",
  "fommie.store",
  "myerly.com",
  "whoopza.org",
  "whoopza.store",
  // Well-known throwaway services the npm package still misses (checked against
  // 1.0.62, 2026-08-25). Deliberately NOT seeded here: alias relays such as
  // SimpleLogin, AnonAddy, DuckDuckGo Email and iCloud Hide My Email. They also
  // mint unlimited addresses, but they mint them for ONE real person — and that
  // person is our audience (engineers, R&D). Blocking them costs paying
  // customers; email simply is not a reliable identity, and the ₽ ceilings
  // (per-IP magic links, per-user spend guard, global breaker) are what bound
  // the damage.
  "tempmail.com",
  "mail.tm",
  "minuteinbox.com",
  "emailondeck.com",
];

function parseDomainList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

/**
 * Extra domains to block on top of the npm package, from env
 * `DISPOSABLE_DOMAINS_EXTRA` (comma-separated). Read per call, so adding a
 * newly-spotted throwaway service on prod is an env edit + `pm2 reload` — no
 * code change, no deploy. Same live-env pattern as ADMIN_EMAILS.
 */
function blockedExtra(): Set<string> {
  return new Set([
    ...SEEDED_DISPOSABLE_DOMAINS,
    ...parseDomainList(process.env.DISPOSABLE_DOMAINS_EXTRA),
  ]);
}

/**
 * Escape hatch: domains that must NEVER be treated as disposable, from env
 * `DISPOSABLE_DOMAINS_ALLOW`. Wins over every blocklist, including the npm
 * package. This is the lever for a false positive — a real customer wrongly
 * blocked is unstuck in seconds without shipping anything, and it is surgical
 * (one domain) rather than opening the gate for everyone.
 */
function allowlisted(): Set<string> {
  return new Set(parseDomainList(process.env.DISPOSABLE_DOMAINS_ALLOW));
}

/**
 * Master kill-switch for the disposable check. Defaults to ON — policy call by
 * Vsevolod 2026-08-25: we block throwaway inboxes. Set
 * `DISPOSABLE_BLOCK_ENABLED=0` to stand the whole check down if it ever starts
 * misfiring at an hour when nobody can triage domain-by-domain.
 */
function blockingEnabled(): boolean {
  return process.env.DISPOSABLE_BLOCK_ENABLED !== "0";
}

/** True if `domain` is a known throwaway-inbox domain (allowlist wins). */
export function isDisposableDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase();
  if (!d) return false;
  if (allowlisted().has(d)) return false;
  return disposableSet.has(d) || blockedExtra().has(d);
}

/**
 * Canonical form used for dedup. Lowercase everything and drop `+alias` for
 * EVERY domain (sec-fix 2026-06-12: yandex/mail.ru/outlook/proton all treat
 * user+tag as user — keeping the tag let one mailbox mint unlimited free
 * accounts). Dots are stripped for gmail/googlemail only — other providers
 * treat `a.b` and `ab` as different.
 *
 * NOTE: there is no `profiles.email_normalized` column. Dedup happens because
 * the login route passes this normalized address to `signInWithOtp`
 * (api/auth/login/route.ts), so Supabase resolves the same auth user for every
 * alias of one mailbox.
 */
export function normalizeEmail(email: string): string {
  const lowered = email.trim().toLowerCase();
  const at = lowered.indexOf("@");
  if (at < 0) return lowered;
  const local = lowered.slice(0, at).split("+")[0];
  const domain = lowered.slice(at + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return `${local.replace(/\./g, "")}@gmail.com`;
  }
  return `${local}@${domain}`;
}

export type EmailValidation =
  | { ok: true; normalized: string }
  | {
      ok: false;
      reason:
        | "invalid_format"
        | "disposable_email"
        | "no_mx_record";
    };

/**
 * Validate email for signup/login. Does DNS lookup, so always `await` and
 * expect up to ~1s on cold DNS.
 */
export async function validateEmail(email: string): Promise<EmailValidation> {
  if (!email || !EMAIL_RE.test(email)) return { ok: false, reason: "invalid_format" };
  const normalized = normalizeEmail(email);
  const at = normalized.indexOf("@");
  const domain = normalized.slice(at + 1);
  if (!domain) return { ok: false, reason: "invalid_format" };
  if (blockingEnabled() && isDisposableDomain(domain)) {
    return { ok: false, reason: "disposable_email" };
  }

  try {
    const mx = await dns.resolveMx(domain);
    if (!mx || mx.length === 0) return { ok: false, reason: "no_mx_record" };
  } catch (err) {
    // Only a DEFINITIVE answer blocks. ENOTFOUND (no such domain) and ENODATA
    // (domain exists, no MX) mean the address genuinely cannot receive mail.
    // Anything else — resolver timeout, SERVFAIL, refused, network down — is a
    // fault on OUR side, and the old catch-all turned it into a signup refusal
    // for a legitimate customer. This box has a history of exactly that class
    // of outage (the blackholed-IPv6 incident took logins down for everyone),
    // so transient resolver failures now fail OPEN and are logged instead.
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return { ok: false, reason: "no_mx_record" };
    }
    console.warn(
      `[email-validator] MX lookup for "${domain}" failed transiently (${code ?? "unknown"}) — failing open`
    );
  }
  return { ok: true, normalized };
}
