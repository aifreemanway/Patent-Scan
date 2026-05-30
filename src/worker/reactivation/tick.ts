// Reactivation tick — runs hourly inside the same pm2 worker that handles
// literature-review. Spec: Antepatent/ux-copy/email-reactivation-2026-05-29.md.
//
// Algorithm (per tick):
//   1. SELECT auth.users joined with profiles WHERE
//        email_confirmed_at IS NULL                          -- never activated
//        AND created_at BETWEEN T-{maxAge} AND T-24h         -- in window for #1
//        AND profiles.reactivation_sent_at_1 IS NULL          -- not yet sent
//      → send #1, stamp _1.
//   2. Same but window T-{maxAge} AND T-72h, gated on _2 IS NULL → send #2.
//
// {maxAge} caps how far back we look so a one-time backfill on first deploy
// doesn't fire a flood — we only reactivate users from the last 14 days.
//
// Idempotency: timestamp guards. Magic link is generated via
// supabase.auth.admin.generateLink({type:'magiclink'}) at send time, so the
// link is fresh (Supabase magic-link TTL is its own concern; if it expires
// before the user clicks, they re-request from /login like any other user).
//
// On any per-user failure we log and continue — one bad row doesn't block the
// rest. We use sendTransactionalEmail's own retry/logging.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendReactivationEmail1, sendReactivationEmail2 } from "./email";

const REACTIVATION_LOOKBACK_DAYS = 14;
const HOUR_MS = 60 * 60 * 1000;
const BATCH_SIZE = 50;

type Candidate = {
  id: string;
  email: string;
  created_at: string;
};

async function generateMagicLink(
  admin: SupabaseClient,
  email: string,
  locale: string = "ru"
): Promise<string | null> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://patent-scan.ru";
  const redirectTo =
    locale === "ru" ? `${siteUrl}/auth/callback` : `${siteUrl}/${locale}/auth/callback`;
  try {
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
    if (error || !data?.properties?.action_link) {
      console.error("[reactivation/link] failed", { email, error: error?.message });
      return null;
    }
    return data.properties.action_link;
  } catch (e) {
    console.error("[reactivation/link] threw", {
      email,
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

async function findCandidates(
  admin: SupabaseClient,
  sentColumn: "reactivation_sent_at_1" | "reactivation_sent_at_2",
  minAgeMs: number
): Promise<Candidate[]> {
  const now = Date.now();
  const upperBound = new Date(now - minAgeMs).toISOString();
  const lowerBound = new Date(now - REACTIVATION_LOOKBACK_DAYS * 24 * HOUR_MS).toISOString();

  // We can't join auth.users from PostgREST directly, but profiles has email
  // and email_confirmed_at is mirrored on profiles only after a custom trigger
  // — instead, we read profiles for the candidates list and then ask
  // auth.admin.getUserById for the confirmation status. To avoid that N+1, we
  // use admin.auth.admin.listUsers + filter — but that's paginated. Cheaper:
  // a single RPC that returns the eligible set. For PR-1 of reactivation we
  // keep it simple and assume profiles.email is authoritative; the worker
  // re-checks email_confirmed_at via admin.getUserById before sending.
  const { data, error } = await admin
    .from("profiles")
    .select("id, email, created_at")
    .lte("created_at", upperBound)
    .gte("created_at", lowerBound)
    .is(sentColumn, null)
    .is("account_deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.error("[reactivation/candidates] query failed", { sentColumn, error: error.message });
    return [];
  }
  return (data ?? []) as Candidate[];
}

async function isUnconfirmed(admin: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data?.user) return false;
    return !data.user.email_confirmed_at;
  } catch (e) {
    console.error("[reactivation/getUser] failed", {
      userId,
      message: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

async function markSent(
  admin: SupabaseClient,
  userId: string,
  column: "reactivation_sent_at_1" | "reactivation_sent_at_2"
): Promise<void> {
  await admin
    .from("profiles")
    .update({ [column]: new Date().toISOString() })
    .eq("id", userId);
}

async function processWave(
  admin: SupabaseClient,
  sentColumn: "reactivation_sent_at_1" | "reactivation_sent_at_2",
  minAgeMs: number,
  sender: (opts: { to: string; magicLinkUrl: string }) => Promise<{ ok: boolean }>
): Promise<{ checked: number; sent: number }> {
  const candidates = await findCandidates(admin, sentColumn, minAgeMs);
  let sent = 0;

  for (const c of candidates) {
    // Double-check confirmation status — they may have clicked the magic-link
    // between the SELECT and now.
    const stillUnconfirmed = await isUnconfirmed(admin, c.id);
    if (!stillUnconfirmed) {
      // User activated — stamp the timestamp anyway so we don't keep checking.
      await markSent(admin, c.id, sentColumn);
      continue;
    }

    const link = await generateMagicLink(admin, c.email);
    if (!link) continue;

    const result = await sender({ to: c.email, magicLinkUrl: link });
    if (result.ok) {
      await markSent(admin, c.id, sentColumn);
      sent++;
    }
  }

  return { checked: candidates.length, sent };
}

export async function reactivationTick(admin: SupabaseClient): Promise<void> {
  try {
    const wave1 = await processWave(
      admin,
      "reactivation_sent_at_1",
      24 * HOUR_MS,
      sendReactivationEmail1
    );
    const wave2 = await processWave(
      admin,
      "reactivation_sent_at_2",
      72 * HOUR_MS,
      sendReactivationEmail2
    );
    if (wave1.checked + wave2.checked > 0) {
      console.info("[reactivation] tick", {
        wave1_checked: wave1.checked,
        wave1_sent: wave1.sent,
        wave2_checked: wave2.checked,
        wave2_sent: wave2.sent,
      });
    }
  } catch (e) {
    console.error("[reactivation] tick error", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
