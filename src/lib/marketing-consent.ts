// Marketing-consent proof + pre-send gate (consent-block spec §3/§5).
//
// The append-only audit trail lives in `marketing_consent_events` (migration
// 0014); `profiles.marketing_consent_at` stays as the fast current-state flag
// (dual-write). These helpers are the ONLY writers/readers of the log from app
// code — all server-side, via the service-role admin client (the table is
// RLS-locked with no policies, so a user-scoped client cannot touch it).
//
// Anti-fab / legal: the pre-send gate fails CLOSED — any uncertainty means we do
// NOT send. The burden of proving consent is on us (ФЗ-о-рекламе ст.18), so a
// missing/ambiguous record must never green-light a marketing email.

import { createSupabaseAdmin } from "@/lib/supabase-server";

/**
 * Current marketing-consent text version (spec §5). Bump ONLY on a SUBSTANTIAL
 * wording/scope change — that invalidates older consent until re-obtained
 * (canSendMarketing compares strictly). A cosmetic fix (typo) does NOT bump it.
 * Keep in sync with the i18n `Auth.marketingConsent` copy it labels.
 */
export const MARKETING_CONSENT_VERSION = "mkt-2026-06-25";
// History: mkt-2026-06-11 (initial) → mkt-2026-06-23 (added operator name per
// ap-poverenny / 152-ФЗ ст.9 ч.4 п.2) → mkt-2026-06-25 (value-based wording +
// operator-reg caption, ap-marketing copy, ap-poverenny PASS 28.06). Each bump
// means consents on the older version are not auto-covered (canSendMarketing is
// fail-CLOSED) — pre-bump consenters re-opt-in via the account toggle. Pre-launch
// (no marketing sent yet), so the re-consent set is empty/negligible.

export type ConsentSource =
  | "registration"
  | "account_settings"
  | "unsubscribe_link"
  | "import";

/**
 * Append one consent event (grant or revoke) to the audit log. Best-effort at
 * the call site's discretion: returns {ok} so callers can decide. NEVER throws.
 * The registration grant is written by the DB trigger (handle_new_user, 0014);
 * this covers account-toggle and unsubscribe-link events.
 */
export async function recordMarketingConsentEvent(opts: {
  userId: string;
  granted: boolean;
  source: ConsentSource;
  version?: string | null;
}): Promise<{ ok: boolean }> {
  try {
    const admin = createSupabaseAdmin();
    const { error } = await admin.from("marketing_consent_events").insert({
      user_id: opts.userId,
      consent_type: "marketing",
      granted: opts.granted,
      // On a grant we stamp the current version; on a revoke we still record the
      // current version for context (what they were unsubscribing from).
      consent_version: opts.version ?? MARKETING_CONSENT_VERSION,
      source: opts.source,
    });
    if (error) {
      console.error("[marketing-consent] log insert failed", {
        userId: opts.userId,
        source: opts.source,
        message: error.message,
      });
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.error("[marketing-consent] log insert threw", {
      message: e instanceof Error ? e.message : String(e),
    });
    return { ok: false };
  }
}

export type MarketingConsentState = {
  granted: boolean;
  version: string | null;
  at: string;
} | null;

/** Latest marketing-consent event for a user (current state), or null if none. */
export async function getMarketingConsentState(
  userId: string
): Promise<MarketingConsentState> {
  try {
    const admin = createSupabaseAdmin();
    const { data, error } = await admin
      .from("marketing_consent_events")
      .select("granted, consent_version, created_at")
      .eq("user_id", userId)
      .eq("consent_type", "marketing")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return {
      granted: data.granted as boolean,
      version: (data.consent_version as string | null) ?? null,
      at: data.created_at as string,
    };
  } catch {
    return null;
  }
}

/**
 * Pre-send gate (spec §3/§5): may we send a marketing email to this user RIGHT
 * NOW? True only when their latest consent event is GRANTED and on the CURRENT
 * text version. Fail-CLOSED: no record, a revoke, or a stale version → false.
 * Call this for every recipient before any marketing send.
 */
export async function canSendMarketing(
  userId: string,
  requiredVersion: string = MARKETING_CONSENT_VERSION
): Promise<boolean> {
  const state = await getMarketingConsentState(userId);
  return (
    state !== null && state.granted === true && state.version === requiredVersion
  );
}
