-- Patent-Scan — Auth + quotas migration
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query → paste → Run)
--
-- Creates: profiles, searches, usage_counters tables, RLS policies,
-- increment_usage() function for atomic quota check+charge,
-- handle_new_user() trigger to auto-create profile on signup.

-- ─────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  tier text not null default 'free' check (tier in ('free','pro','enterprise')),
  tier_expires_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists public.searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  kind text not null check (kind in ('search','landscape')),
  description text,
  topic text,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists searches_user_created_idx
  on public.searches (user_id, created_at desc);

-- One row per (user, month, operation). count incremented atomically.
create table if not exists public.usage_counters (
  user_id uuid references public.profiles(id) on delete cascade,
  period_start timestamptz not null,
  operation text not null check (operation in ('search','landscape','analyze','questions')),
  count int not null default 0,
  primary key (user_id, period_start, operation)
);

-- ─────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.searches enable row level security;
alter table public.usage_counters enable row level security;

-- profiles: юзер видит/правит только свой
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles
  for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- searches: юзер видит/правит только свои
drop policy if exists searches_self on public.searches;
create policy searches_self on public.searches
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- usage_counters: юзер может читать свои счётчики (для UI "осталось 2 из 3")
-- Запись — только через increment_usage() с security definer (обходит RLS).
drop policy if exists usage_counters_read_self on public.usage_counters;
create policy usage_counters_read_self on public.usage_counters
  for select
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- Auto-create profile on user signup
-- ─────────────────────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- Quota check + charge (atomic)
-- ─────────────────────────────────────────────────────────────
--
-- Single source of truth for quota enforcement. Called from server-side
-- /lib/quota.ts using the service_role key (so it bypasses RLS on
-- usage_counters.INSERT/UPDATE).
--
-- Returns JSON: { allowed, limit, used, remaining, tier, period_start }
-- If allowed=true, counter has been incremented atomically.
-- If allowed=false, no write happened.

create or replace function public.increment_usage(
  p_user_id uuid,
  p_operation text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier text;
  v_limit int;
  v_used int;
  v_period_start timestamptz := date_trunc('month', now());
begin
  -- validate operation
  if p_operation not in ('search','landscape','analyze','questions') then
    raise exception 'Invalid operation: %', p_operation;
  end if;

  -- look up tier
  select tier into v_tier from public.profiles where id = p_user_id;
  if v_tier is null then
    return jsonb_build_object('allowed', false, 'reason', 'no_profile');
  end if;

  -- per-tier limits (mirror of lib/config.ts QUOTA_LIMITS — keep in sync!)
  v_limit := case
    when p_operation = 'questions' then 999999 -- effectively unlimited, cheap call
    when v_tier = 'enterprise' then 999999
    when v_tier = 'pro' and p_operation = 'search' then 500
    when v_tier = 'pro' and p_operation = 'landscape' then 100
    when v_tier = 'pro' and p_operation = 'analyze' then 500
    when v_tier = 'free' then 3
    else 0
  end;

  -- current count
  select coalesce(count, 0) into v_used
  from public.usage_counters
  where user_id = p_user_id
    and period_start = v_period_start
    and operation = p_operation;

  v_used := coalesce(v_used, 0);

  if v_used >= v_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'quota_exceeded',
      'limit', v_limit,
      'used', v_used,
      'remaining', 0,
      'tier', v_tier,
      'period_start', v_period_start
    );
  end if;

  -- atomic increment
  insert into public.usage_counters (user_id, period_start, operation, count)
  values (p_user_id, v_period_start, p_operation, 1)
  on conflict (user_id, period_start, operation)
  do update set count = public.usage_counters.count + 1;

  return jsonb_build_object(
    'allowed', true,
    'limit', v_limit,
    'used', v_used + 1,
    'remaining', v_limit - v_used - 1,
    'tier', v_tier,
    'period_start', v_period_start
  );
end;
$$;

-- Permissions: only service_role can call increment_usage (bypasses RLS)
revoke all on function public.increment_usage(uuid, text) from public, anon, authenticated;
grant execute on function public.increment_usage(uuid, text) to service_role;

-- ─────────────────────────────────────────────────────────────
-- Read current quota status (for UI)
-- ─────────────────────────────────────────────────────────────
-- Returns current-month counts + tier limits for the authenticated user.
-- Callable from client (via RLS-respecting RPC).

create or replace function public.get_quota_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_tier text;
  v_period_start timestamptz := date_trunc('month', now());
  v_result jsonb := '{}'::jsonb;
  v_op text;
  v_used int;
  v_limit int;
begin
  if v_user_id is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;

  select tier into v_tier from public.profiles where id = v_user_id;

  for v_op in select unnest(array['search','landscape','analyze']) loop
    v_limit := case
      when v_tier = 'enterprise' then 999999
      when v_tier = 'pro' and v_op = 'search' then 500
      when v_tier = 'pro' and v_op = 'landscape' then 100
      when v_tier = 'pro' and v_op = 'analyze' then 500
      when v_tier = 'free' then 3
      else 0
    end;

    select coalesce(count, 0) into v_used
    from public.usage_counters
    where user_id = v_user_id
      and period_start = v_period_start
      and operation = v_op;

    v_used := coalesce(v_used, 0);

    v_result := v_result || jsonb_build_object(v_op, jsonb_build_object(
      'limit', v_limit,
      'used', v_used,
      'remaining', greatest(v_limit - v_used, 0)
    ));
  end loop;

  v_result := v_result || jsonb_build_object('tier', v_tier, 'period_start', v_period_start);
  return v_result;
end;
$$;

grant execute on function public.get_quota_status() to authenticated;
