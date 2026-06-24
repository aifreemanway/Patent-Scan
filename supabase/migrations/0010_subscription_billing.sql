-- Patent-Scan — 0010 subscription billing foundation (PR-A)
--
-- Design: specs/subscription-billing-design-2026-06-02.md (cofounder APPROVED).
-- Scope: payments + subscriptions tables, the idempotent apply RPC (the heart of
-- "no double charge"), and the expiry function. DORMANT until PR-B wires the
-- checkout/webhook routes and BILLING_LIVE=1 is set — creating these tables and
-- functions changes NO existing behaviour on its own.
--
-- Idempotent (ON_ERROR_STOP-safe): re-runnable. Apply under `postgres` (no
-- supabase_admin-owned objects are altered here).

create extension if not exists pgcrypto;

-- ── Tier model: add `team_plus` ───────────────────────────────────────────────
-- Pricing sells a Team Plus plan (purpose=subscription_team_plus), but the tier
-- check constraint + quota_limit() only knew free/starter/team/enterprise, so a
-- team_plus subscriber would fail the constraint (and fall to quota 0). Extend
-- both. No accounts are team_plus yet, so this is inert until billing is live.
alter table public.profiles drop constraint if exists profiles_tier_check;
alter table public.profiles
  add constraint profiles_tier_check
  check (tier in ('free','starter','team','team_plus','enterprise'));

-- quota_limit() — single source of truth (mirrors lib/config.ts QUOTA_LIMITS).
-- team_plus search=100 (from the pricing table); team_plus landscape=50 is
-- PROVISIONAL pending CANON confirmation (safe: no team_plus accounts, billing
-- not live). All other tiers unchanged from 0002.
create or replace function public.quota_limit(p_tier text, p_operation text)
returns int
language sql
immutable
as $$
  select case
    when p_operation = 'questions' then 999999
    when p_tier = 'enterprise' then 999999
    when p_operation in ('search','analyze') then
      case p_tier
        when 'free' then 3 when 'starter' then 20 when 'team' then 60
        when 'team_plus' then 100 else 0 end
    when p_operation = 'landscape' then
      case p_tier
        when 'free' then 3 when 'starter' then 10 when 'team' then 30
        when 'team_plus' then 50 else 0 end
    else 0
  end;
$$;

-- ── payments — every transaction (audit trail + idempotency anchor) ───────────
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  -- The idempotency anchor: ЮKassa's payment id. UNIQUE so a retried webhook
  -- maps to the same row and can never create a second charge application.
  yookassa_payment_id text unique not null,
  status text not null default 'pending'
    check (status in ('pending','waiting_for_capture','succeeded','canceled')),
  amount numeric(10,2) not null,
  currency text not null default 'RUB',
  -- subscription_starter / subscription_team / subscription_team_plus /
  -- subscription_enterprise / one_report_screening / one_report_screening_iul /
  -- one_report_litreview
  purpose text not null,
  period_months smallint,
  -- Saved method for recurring autopayments (set on the first save_payment_method
  -- payment; used by the renewal cron in PR-D).
  payment_method_id text,
  is_recurring boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  -- Our own Idempotence-Key sent to ЮKassa on creation (distinct from their id).
  idempotence_key text,
  created_at timestamptz not null default now(),
  captured_at timestamptz
);
create index if not exists payments_user_created_idx
  on public.payments (user_id, created_at desc);

-- ── subscriptions — current state (exactly one plan per user) ─────────────────
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null unique,
  tier text not null
    check (tier in ('free','starter','team','team_plus','enterprise')),
  status text not null default 'active'
    check (status in ('active','past_due','canceled','expired')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  payment_method_id text,
  -- self-service cancel (Vsevolod hard-req): access stays until period end, then
  -- the expiry pass downgrades to free. Reversible via "resume" (set back false).
  cancel_at_period_end boolean not null default false,
  last_payment_id uuid references public.payments(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS: a user may SELECT only their own rows; ALL writes go through service_role
-- (webhook / admin), which bypasses RLS — same model as usage_counters.
alter table public.payments enable row level security;
alter table public.subscriptions enable row level security;
drop policy if exists payments_self on public.payments;
create policy payments_self on public.payments
  for select using (auth.uid() = user_id);
drop policy if exists subscriptions_self on public.subscriptions;
create policy subscriptions_self on public.subscriptions
  for select using (auth.uid() = user_id);

-- ── apply_successful_payment — RISK-CRITICAL idempotent application ───────────
-- Applies a SUCCEEDED ЮKassa payment to the user's tier EXACTLY ONCE. The
-- payment row is locked; if it is already 'succeeded' the call is a no-op (a
-- retried webhook must never grant a second period). On the winning call:
-- payment→succeeded, subscription upserted (period extended), profiles.tier +
-- tier_expires_at mirrored — all in one transaction. Returns {applied: bool}.
create or replace function public.apply_successful_payment(
  p_yookassa_payment_id text,
  p_tier text,
  p_period_months int,
  p_payment_method_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments;
  v_period_end timestamptz;
begin
  select * into v_payment from public.payments
    where yookassa_payment_id = p_yookassa_payment_id
    for update;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'payment_not_found');
  end if;

  -- Idempotency gate: already applied → no-op (ЮKassa retries webhooks).
  if v_payment.status = 'succeeded' then
    return jsonb_build_object('applied', false, 'reason', 'already_applied');
  end if;

  v_period_end := now() + (coalesce(p_period_months, 1)::text || ' months')::interval;

  update public.payments
    set status = 'succeeded',
        captured_at = now(),
        payment_method_id = coalesce(p_payment_method_id, payment_method_id)
    where id = v_payment.id;

  insert into public.subscriptions as s
    (user_id, tier, status, current_period_start, current_period_end,
     payment_method_id, cancel_at_period_end, last_payment_id, updated_at)
  values
    (v_payment.user_id, p_tier, 'active', now(), v_period_end,
     p_payment_method_id, false, v_payment.id, now())
  on conflict (user_id) do update set
    tier = excluded.tier,
    status = 'active',
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    payment_method_id = coalesce(excluded.payment_method_id, s.payment_method_id),
    cancel_at_period_end = false,
    last_payment_id = excluded.last_payment_id,
    updated_at = now();

  -- profiles is the denormalized fast-gate mirror; subscriptions is the truth.
  update public.profiles
    set tier = p_tier, tier_expires_at = v_period_end
    where id = v_payment.user_id;

  return jsonb_build_object(
    'applied', true, 'tier', p_tier, 'period_end', v_period_end
  );
end;
$$;
revoke all on function public.apply_successful_payment(text, text, int, text)
  from public, anon, authenticated;
grant execute on function public.apply_successful_payment(text, text, int, text)
  to service_role;

-- ── expire_subscriptions — the one cron required even for manual billing ──────
-- Lapses ended subscriptions and downgrades any profile whose paid window passed
-- (covers both subscription expiry and admin-activated tiers that set
-- tier_expires_at without a subscription row). Returns #profiles downgraded.
create or replace function public.expire_subscriptions()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
  update public.subscriptions
    set status = 'expired', updated_at = now()
    where status in ('active','past_due','canceled')
      and current_period_end is not null
      and current_period_end < now();

  update public.profiles
    set tier = 'free', tier_expires_at = null
    where tier <> 'free'
      and tier_expires_at is not null
      and tier_expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.expire_subscriptions() from public, anon, authenticated;
grant execute on function public.expire_subscriptions() to service_role;
