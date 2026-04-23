-- 0002_feedback_bonus.sql
-- Capture user feedback when they hit the monthly quota, and grant a +1 slot
-- in exchange. One-time per (user, operation, source) so users can't farm the
-- bonus by re-submitting.

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  operation text not null check (operation in ('analyze','search','landscape')),
  -- Which surface the feedback came from. `quota_exceeded` is the first one;
  -- future surfaces (post-search NPS, email, etc.) get distinct values.
  source text not null default 'quota_exceeded',
  answers jsonb not null,
  created_at timestamptz default now(),
  unique (user_id, operation, source)
);

create index on public.feedback (created_at desc);

alter table public.feedback enable row level security;

-- User can insert / read their own feedback. No update/delete policies —
-- feedback is immutable audit data.
create policy feedback_self_insert on public.feedback
  for insert with check (auth.uid() = user_id);

create policy feedback_self_read on public.feedback
  for select using (auth.uid() = user_id);

-- Atomic: stores feedback + grants +1 slot. Called from the server route via
-- service_role (bypasses RLS for the usage_counters update).
create or replace function public.grant_feedback_bonus(
  p_user_id uuid,
  p_operation text,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Must match the timestamptz shape used by increment_usage() so the PK
  -- conflict resolution finds the existing row.
  v_period timestamptz := date_trunc('month', now());
  v_current int;
  v_source text := 'quota_exceeded';
begin
  if p_operation not in ('analyze', 'search', 'landscape') then
    return jsonb_build_object('granted', false, 'reason', 'invalid_operation');
  end if;

  -- Try to record the feedback first. unique(user_id, operation, source)
  -- ensures we can't double-grant.
  begin
    insert into public.feedback (user_id, operation, source, answers)
    values (p_user_id, p_operation, v_source, p_answers);
  exception
    when unique_violation then
      return jsonb_build_object('granted', false, 'reason', 'already_granted');
  end;

  -- Decrement the counter for the current month by 1 (not below 0).
  -- If no row exists yet, create one at 0 so the user's next request is fine.
  insert into public.usage_counters (user_id, period_start, operation, count)
  values (p_user_id, v_period, p_operation, 0)
  on conflict (user_id, period_start, operation) do update
    set count = greatest(public.usage_counters.count - 1, 0)
  returning count into v_current;

  return jsonb_build_object(
    'granted', true,
    'operation', p_operation,
    'new_count', v_current,
    'period_start', v_period
  );
end;
$$;

revoke execute on function public.grant_feedback_bonus(uuid, text, jsonb) from public, anon, authenticated;
-- service_role can call it (security definer → bypasses RLS on usage_counters).
grant execute on function public.grant_feedback_bonus(uuid, text, jsonb) to service_role;
