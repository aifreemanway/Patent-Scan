// Email normalization + anti-abuse checks before handing off to Supabase OTP.
// Catches disposable domains (mailinator, tempmail, …), empty MX, and
// gmail +alias / dot tricks used to multiply free-tier accounts.

import disposableDomains from "disposable-email-domains";
import { promises as dns } from "dns";

const disposableSet = new Set<string>(disposableDomains as string[]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Canonical form used for dedup (profiles.email_normalized).
 * Lowercase everything; for gmail/googlemail strip dots in local part and drop +aliases.
 * Other providers keep their local part intact — many treat `a.b` and `ab` as different.
 */
export function normalizeEmail(email: string): string {
  const lowered = email.trim().toLowerCase();
  const at = lowered.indexOf("@");
  if (at < 0) return lowered;
  const local = lowered.slice(0, at);
  const domain = lowered.slice(at + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    const cleanLocal = local.split("+")[0].replace(/\./g, "");
    return `${cleanLocal}@gmail.com`;
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
  if (disposableSet.has(domain)) return { ok: false, reason: "disposable_email" };

  try {
    const mx = await dns.resolveMx(domain);
    if (!mx || mx.length === 0) return { ok: false, reason: "no_mx_record" };
  } catch {
    return { ok: false, reason: "no_mx_record" };
  }
  return { ok: true, normalized };
}
