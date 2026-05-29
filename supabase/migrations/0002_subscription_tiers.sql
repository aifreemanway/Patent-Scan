-- Patent-Scan — 0002 subscription tiers + corrected quota semantics
-- Run in Supabase SQL Editor AFTER 0001 (Dashboard → SQL Editor → paste → Run).
--
-- What changes vs 0001:
--   1) Tier model: free | starter | team | enterprise   (was free | pro | enterprise)
--   2) Limits:  search    free 3 / starter 20 / team 60
--               landscape free 3 / starter 10 / team 30
--   3) Quota SEMANTICS (the important part): one user-facing NOVELTY SEARCH = one
--      'search' unit, charged ONCE at /api/analyze (the terminal step of a search)
--      — NOT on the ~150 internal fan-out calls a single search makes. One
--      LANDSCAPE = one 'landscape' unit, charged at /api/landscape/synthesize.
--      The fan-out routes (landscape/plan, landscape/search, prior-art-rank,
--      search/gate, questions, search-web, search-rospatent) are machinery:
--      verified-auth only, NO quota charge — per-IP rate limits guard abuse.
--   Deep Analysis is a separate transactional counter, added in a later migration.
--
-- Limits live in ONE place here — quota_limit() — so increment_usage() and
-- get_quota_status() can never drift. Mirror these numbers in lib/config.ts
-- QUOTA_LIMITS (reference only; enforcement is here).

-- ── Tier model ────────────────────────────────────────────────
alter table public.profiles drop constraint if exists profiles_tier_check;
-- migrate any pre-existing 'pro' rows before the new constraint rejects them
update public.profiles set tier = 'starter' where tier = 'pro';
alter table public.profiles
  add constraint profiles_tier_check
  check (tier in ('free','starter','team','enterprise'));

-- ── Single source of truth for limits ─────────────────────────
create or replace function public.quota_limit(p_tier text, p_operation text)
returns int
language sql
immutable
as $$
  select case
    when p_operation = 'questions' then 999999            -- cheap, effectively unlimited
    when p_tier = 'enterprise' then 999999
    -- 'analyze' mirrors 'search': the analyze route charges operation='search';
    -- 'analyze' is kept valid only for back-compat and never charged directly.
    when p_operation in ('search','analyze') then
      case p_tier when 'free' then 3 when 'starter' then 20 when 'team' then 60 else 0 end
    when p_operation = 'landscape' then
      case p_tier when 'free' then 3 when 'starter' then 10 when 'team' then 30 else 0 end
    else 0
  end;
$$;

-- ── Quota check + charge (atomic) ─────────────────────────────
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
  if p_operation not in ('search','landscape','analyze','questions') then
    raise exception 'Invalid operation: %', p_operation;
  end if;

  select tier into v_tier from public.profiles where id = p_user_id;
  if v_tier is null then
    return jsonb_build_object('allowed', false, 'reason', 'no_profile');
  end if;

  v_limit := public.quota_limit(v_tier, p_operation);

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

revoke all on function public.increment_usage(uuid, text) from public, anon, authenticated;
grant execute on function public.increment_usage(uuid, text) to service_role;

-- ── Read current quota status (for UI) ────────────────────────
-- Returns current-month counts + limits for the two user-facing counters
-- (search, landscape) for the authenticated user.
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

  for v_op in select unnest(array['search','landscape']) loop
    v_limit := public.quota_limit(v_tier, v_op);

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
