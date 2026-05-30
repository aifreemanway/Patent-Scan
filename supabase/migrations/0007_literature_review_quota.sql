-- Patent-Scan — 0007 literature_review quota
-- Run in Supabase SQL Editor AFTER 0006.
--
-- Adds a new monthly quota operation for the literature review feature:
--   Free trial    → 0  (paid feature, see upsell in /account)
--   Starter       → 0  (paid feature, no inclusion at the entry-paid tier)
--   Team          → 1  per month  (per spec §7)
--   Enterprise    → 2  per month  (per spec §7)
--
-- This is a CREATE OR REPLACE re-issue of the three quota functions from
-- migrations 0001 + 0002, with 'literature_review' added everywhere the
-- operation name is referenced. Safe to run multiple times — function bodies
-- are replaced, semantics unchanged for the existing 'search' / 'landscape'
-- operations.

-- ── Single source of truth for limits (replaces 0002) ─────────
create or replace function public.quota_limit(p_tier text, p_operation text)
returns int
language sql
immutable
as $$
  select case
    when p_operation = 'questions' then 999999
    when p_tier = 'enterprise' and p_operation = 'literature_review' then 2
    when p_tier = 'enterprise' then 999999
    when p_operation in ('search','analyze') then
      case p_tier when 'free' then 3 when 'starter' then 20 when 'team' then 60 else 0 end
    when p_operation = 'landscape' then
      case p_tier when 'free' then 3 when 'starter' then 10 when 'team' then 30 else 0 end
    when p_operation = 'literature_review' then
      case p_tier when 'team' then 1 else 0 end
    else 0
  end;
$$;

-- ── increment_usage with literature_review in the valid list ──
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
  if p_operation not in ('search','landscape','analyze','questions','literature_review') then
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

-- ── Refund a charged quota slot (used on stage-1 failures in the worker) ──
-- The literature_review worker charges the quota at /api/literature-review/submit
-- BEFORE Stage 1. If Stage 1 (intake validation) rejects the input or fails
-- transiently, the worker refunds the slot so the user doesn't burn a credit
-- on a never-executed run. Pre-existing /api/deep-analysis has the same idea
-- via consume/refund_free_deep_analysis; this is the monthly-quota equivalent.
create or replace function public.refund_usage(
  p_user_id uuid,
  p_operation text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_start timestamptz := date_trunc('month', now());
begin
  update public.usage_counters
    set count = greatest(count - 1, 0)
    where user_id = p_user_id
      and period_start = v_period_start
      and operation = p_operation;
end;
$$;

revoke all on function public.refund_usage(uuid, text) from public, anon, authenticated;
grant execute on function public.refund_usage(uuid, text) to service_role;

-- ── get_quota_status: include literature_review in the returned object ──
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

  for v_op in select unnest(array['search','landscape','literature_review']) loop
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
