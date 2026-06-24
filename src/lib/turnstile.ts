// Cloudflare Turnstile server-side verification.
// Called from /api/auth/login before signInWithOtp to block bots.

import { TURNSTILE_VERIFY_URL } from "./config";

export type TurnstileResult =
  | { ok: true }
  | {
      ok: false;
      reason: "missing_token" | "missing_secret" | "network" | "rejected";
      codes?: string[];
      hostname?: string;
    };

/** Retry siteverify on network-class failures. The VPS↔Cloudflare path has shown
 *  transient blips (DNS wobble, broken IPv6 fallbacks) that otherwise surface to
 *  a legit user as "captcha failed". Total added latency on a healthy path: 0. */
const SITEVERIFY_ATTEMPTS = 3;
const SITEVERIFY_BACKOFF_MS = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let warnedMissingSecret = false;

/** Verify a Turnstile token against Cloudflare siteverify. */
export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp: string | null
): Promise<TurnstileResult> {
  if (!token) return { ok: false, reason: "missing_token" };
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Surface misconfiguration loudly — silent fallback hides the fact that
    // anti-bot protection is effectively disabled on this deployment.
    if (!warnedMissingSecret) {
      console.error(
        "[turnstile] TURNSTILE_SECRET_KEY is not set — captcha check is disabled. Add env var to Vercel."
      );
      warnedMissingSecret = true;
    }
    return { ok: false, reason: "missing_secret" };
  }

  const params = new URLSearchParams({ secret, response: token });
  if (remoteIp) params.set("remoteip", remoteIp);

  // A Turnstile token is single-use, but Cloudflare only burns it on a request
  // that REACHES siteverify and returns a verdict. A network error (request
  // never arrived, or a 5xx) leaves the token unspent, so retrying with the SAME
  // token is safe and lets a real user ride out a transient blip instead of
  // being told "проверка бота не пройдена". A definitive success:false is
  // returned immediately and never retried (the verdict won't change, and the
  // token is now spent).
  for (let attempt = 1; attempt <= SITEVERIFY_ATTEMPTS; attempt++) {
    const lastTry = attempt === SITEVERIFY_ATTEMPTS;

    let resp: Response;
    try {
      resp = await fetch(TURNSTILE_VERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
      });
    } catch (e) {
      if (lastTry) return { ok: false, reason: "network" };
      console.warn(
        `[turnstile] siteverify network error (attempt ${attempt}/${SITEVERIFY_ATTEMPTS}), retrying:`,
        e instanceof Error ? e.message : String(e)
      );
      await sleep(SITEVERIFY_BACKOFF_MS * attempt);
      continue;
    }

    if (!resp.ok) {
      if (lastTry) return { ok: false, reason: "network" };
      console.warn(
        `[turnstile] siteverify http ${resp.status} (attempt ${attempt}/${SITEVERIFY_ATTEMPTS}), retrying`
      );
      await sleep(SITEVERIFY_BACKOFF_MS * attempt);
      continue;
    }

    const data = (await resp.json().catch(() => null)) as
      | { success: boolean; "error-codes"?: string[]; hostname?: string }
      | null;
    if (!data) {
      if (lastTry) return { ok: false, reason: "network" };
      await sleep(SITEVERIFY_BACKOFF_MS * attempt);
      continue;
    }

    if (!data.success)
      return {
        ok: false,
        reason: "rejected",
        codes: data["error-codes"],
        hostname: data.hostname,
      };
    return { ok: true };
  }

  // Loop always returns inside; this satisfies the type checker.
  return { ok: false, reason: "network" };
}
