// Cloudflare Turnstile server-side verification.
// Called from /api/auth/login before signInWithOtp to block bots.

import { TURNSTILE_VERIFY_URL } from "./config";

export type TurnstileResult =
  | { ok: true }
  | { ok: false; reason: "missing_token" | "missing_secret" | "network" | "rejected"; codes?: string[] };

/** Verify a Turnstile token against Cloudflare siteverify. */
export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp: string | null
): Promise<TurnstileResult> {
  if (!token) return { ok: false, reason: "missing_token" };
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: false, reason: "missing_secret" };

  const params = new URLSearchParams({ secret, response: token });
  if (remoteIp) params.set("remoteip", remoteIp);

  let resp: Response;
  try {
    resp = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
  } catch {
    return { ok: false, reason: "network" };
  }

  if (!resp.ok) return { ok: false, reason: "network" };

  const data = (await resp.json().catch(() => null)) as
    | { success: boolean; "error-codes"?: string[] }
    | null;
  if (!data) return { ok: false, reason: "network" };
  if (!data.success) return { ok: false, reason: "rejected", codes: data["error-codes"] };
  return { ok: true };
}
