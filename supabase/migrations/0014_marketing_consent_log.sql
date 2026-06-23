-- 0014: append-only marketing-consent proof log (consent-block spec §3/§5).
--
-- Background: 0004 added profiles.marketing_consent_at / _unsubscribed_at — a
-- single-state FLAG (consented now or not). The legal spec (ФЗ-о-рекламе ст.18 —
-- burden of proof is on US) needs more: an IMMUTABLE history of every grant and
-- revoke, with the consent text VERSION and the SOURCE, so we can prove what a
-- user agreed to on the date of any given send. This table is that audit trail;
-- the profiles flag stays as the fast "current state" (dual-write).
--
-- Internal audit data: RLS on with NO policies → only the service_role key
-- (server-side) reads/writes it; never exposed to browser clients.

create table if not exists public.marketing_consent_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  -- 'marketing' is the only type the spec gates on today; 'offer_privacy' is
  -- reserved if we ever log offer/policy acceptance here too.
  consent_type text not null default 'marketing'
    check (consent_type in ('marketing', 'offer_privacy')),
  -- true = granted (opt-in), false = revoked (unsubscribe / toggle off).
  granted boolean not null,
  -- Version of the consent text the user acted on (spec §5). NULL only for
  -- legacy rows whose source didn't carry a version.
  consent_version text,
  -- Where the action happened (spec §3).
  source text not null
    check (source in ('registration', 'account_settings', 'unsubscribe_link', 'import')),
  created_at timestamptz not null default now()
);

-- Latest-state-per-user and history scans both want this order.
create index if not exists marketing_consent_events_user_idx
  on public.marketing_consent_events (user_id, created_at desc);

alter table public.marketing_consent_events enable row level security;
-- No GRANTs / policies on purpose: the consent log is server-only audit data.
-- service_role bypasses RLS; anon/authenticated get nothing.

-- ── Backfill existing consenters (spec §6.1 inverse) ────────────────────────
-- Users who opted in BEFORE this log existed hold a real consent (the flag
-- profiles.marketing_consent_at) — they must NOT be excluded from marketing.
-- Seed one granted row per current consenter, stamped at their original consent
-- time, at the CURRENT version: this is the first version, so the text they saw
-- IS mkt-2026-06-11 (no substantial change since → their consent covers it).
-- Unsubscribed users (flag null) get no row → correctly stay excluded.
-- Idempotent: skips users who already have any marketing event (re-run safe).
insert into public.marketing_consent_events
  (user_id, consent_type, granted, consent_version, source, created_at)
select p.id, 'marketing', true, 'mkt-2026-06-11', 'import', p.marketing_consent_at
from public.profiles p
where p.marketing_consent_at is not null
  and not exists (
    select 1 from public.marketing_consent_events e
    where e.user_id = p.id and e.consent_type = 'marketing'
  );

-- ── Extend handle_new_user() to also append the registration consent event ──
-- Keeps the existing profiles insert + marketing_consent_at stamp (0004) and,
-- when the user actively opted in at signup, writes one append-only proof row
-- atomically with profile creation. The consent VERSION arrives via
-- raw_user_meta_data.marketing_consent_version (set by the login route).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marketing boolean := (new.raw_user_meta_data ->> 'marketing_consent') = 'true';
  v_version text := new.raw_user_meta_data ->> 'marketing_consent_version';
begin
  insert into public.profiles (id, email, marketing_consent_at)
  values (
    new.id,
    new.email,
    case when v_marketing then now() else null end
  )
  on conflict (id) do nothing;

  -- Append-only consent proof (spec §3). Only on an active opt-in — no row means
  -- no consent (which is exactly how existing/non-consenting users stay excluded
  -- from marketing, spec §6.1).
  if v_marketing then
    insert into public.marketing_consent_events
      (user_id, consent_type, granted, consent_version, source)
    values (new.id, 'marketing', true, v_version, 'registration');
  end if;

  return new;
end;
$$;
