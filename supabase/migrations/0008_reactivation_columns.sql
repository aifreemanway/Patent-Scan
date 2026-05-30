-- Patent-Scan — 0008 Reactivation email idempotency columns.
-- Run in Supabase SQL Editor AFTER 0007.
--
-- Two timestamps capture the moment each reactivation email was sent so the
-- worker tick doesn't double-send. Worker logic, per ap-marketing spec
-- (Antepatent/ux-copy/email-reactivation-2026-05-29.md):
--   • #1 at T+24h after signup if email_confirmed_at IS NULL AND _1 IS NULL
--   • #2 at T+72h after signup if email_confirmed_at IS NULL AND _2 IS NULL
--   • No #3 (FZ-38 art.18 risk).
--
-- The 152-FZ basis is art.6 ch.1 p.5 (continuation of an action initiated by
-- the user), per ap-ba verdict — no separate consent needed because magic-link
-- reactivation is the transactional completion of the signup flow the user
-- themselves started.

alter table public.profiles
  add column if not exists reactivation_sent_at_1 timestamptz null,
  add column if not exists reactivation_sent_at_2 timestamptz null;

-- Index for the worker query: "find unconfirmed users due for reactivation".
-- Partial index keyed on the unconfirmed-and-not-yet-sent rows is cheap and
-- specifically supports the ORDER BY created_at the worker uses.
create index if not exists idx_profiles_reactivation_pending_1
  on public.profiles (id)
  where reactivation_sent_at_1 is null;
create index if not exists idx_profiles_reactivation_pending_2
  on public.profiles (id)
  where reactivation_sent_at_2 is null;
