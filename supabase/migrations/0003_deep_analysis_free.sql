-- Patent-Scan — 0003 Deep Analysis free-credit
-- Run in Supabase SQL Editor AFTER 0002.
--
-- Deep Analysis (premium Sonnet judge) is a SEPARATE transactional grant, not
-- part of the monthly search/landscape quota: every verified account gets
-- exactly ONE free Deep Analysis, not regenerated (anti-abuse §5). Billing for
-- additional runs is fast-follow; until then, a second run is refused.
--
-- consume_free_deep_analysis() atomically claims the free credit (UPDATE ...
-- WHERE not-yet-used). refund_free_deep_analysis() returns it if the run fails
-- downstream, so a transient Sonnet/gateway error never burns the one free credit.

alter table public.profiles
  add column if not exists free_deep_analysis_used boolean not null default false;

-- Atomically claim the free credit. Returns {allowed:true} if it was claimed
-- now, else {allowed:false, reason} (already used / no profile).
create or replace function public.consume_free_deep_analysis(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_claimed int;
begin
  select true into v_exists from public.profiles where id = p_user_id;
  if v_exists is null then
    return jsonb_build_object('allowed', false, 'reason', 'no_profile');
  end if;

  update public.profiles
    set free_deep_analysis_used = true
    where id = p_user_id and free_deep_analysis_used = false;
  get diagnostics v_claimed = row_count;

  if v_claimed = 1 then
    return jsonb_build_object('allowed', true);
  end if;
  return jsonb_build_object('allowed', false, 'reason', 'already_used');
end;
$$;

-- Return the free credit (used only when a claimed run fails downstream).
create or replace function public.refund_free_deep_analysis(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
    set free_deep_analysis_used = false
    where id = p_user_id;
end;
$$;

revoke all on function public.consume_free_deep_analysis(uuid) from public, anon, authenticated;
revoke all on function public.refund_free_deep_analysis(uuid) from public, anon, authenticated;
grant execute on function public.consume_free_deep_analysis(uuid) to service_role;
grant execute on function public.refund_free_deep_analysis(uuid) to service_role;
