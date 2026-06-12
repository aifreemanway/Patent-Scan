-- 0012: daily-spend circuit-breaker support (sec-review ap-fable 2026-06-12).
--
-- Sums confirmed LLM spend since a timestamp for lib/spend-guard.ts. A function
-- (not a PostgREST row-select) because: PostgREST caps selects at 1000 rows —
-- a row-fetch-and-sum would silently undercount exactly during an abuse spike —
-- and aggregate functions are disabled by default on self-host PostgREST.
-- cost_rub IS NULL rows (models without a confirmed price, anti-fab) are
-- excluded by sum() semantics: the breaker acts on confirmed ₽ only.

create or replace function public.llm_spend_since(p_since timestamptz)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(cost_rub), 0)
  from public.llm_cost_events
  where created_at >= p_since;
$$;

-- Service-role only (the guard runs server-side with the service key); never
-- callable by anon/authenticated browser clients.
revoke execute on function public.llm_spend_since(timestamptz) from public;
revoke execute on function public.llm_spend_since(timestamptz) from anon;
revoke execute on function public.llm_spend_since(timestamptz) from authenticated;
grant execute on function public.llm_spend_since(timestamptz) to service_role;
