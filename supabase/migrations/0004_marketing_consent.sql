-- Patent-Scan — 0004 Marketing opt-in consent (per 152-ФЗ legal-gate spec §6).
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query → paste → Run).
-- AFTER 0003.
--
-- Two new profile fields capture marketing-channel consent SEPARATELY from
-- the primary signup consent (which is logged elsewhere). The marketing
-- checkbox on the login form is OPTIONAL and NOT pre-checked. A successful
-- unsubscribe wipes `marketing_consent_at` and stamps `marketing_unsubscribed_at`,
-- so a re-opt-in later (= re-ticking the checkbox) is observable distinctly.
--
-- The consent value flows in via Supabase's signInWithOtp(options.data) — it
-- lands in auth.users.raw_user_meta_data.marketing_consent at signup. The
-- handle_new_user() trigger (updated below) reads it from there and stamps
-- profiles.marketing_consent_at at the same moment the profile row is created,
-- atomic with the signup itself (no race window where the row exists without
-- the consent flag).

alter table public.profiles
  add column if not exists marketing_consent_at timestamptz null,
  add column if not exists marketing_unsubscribed_at timestamptz null;

-- Replace handle_new_user() to read marketing_consent from the auth user's
-- raw_user_meta_data (set by the login route via signInWithOtp options.data).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, marketing_consent_at)
  values (
    new.id,
    new.email,
    case
      when (new.raw_user_meta_data ->> 'marketing_consent') = 'true' then now()
      else null
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Trigger is already in place from 0001 — no need to re-create.
