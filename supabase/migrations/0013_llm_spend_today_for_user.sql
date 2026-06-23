-- 0013: per-user daily-spend circuit-breaker support (СЛОЙ-2, sec-review
-- ap-fable 2026-06-18). Mirrors llm_spend_since (0012) but filtered to one
-- user_id, so lib/spend-guard.ts can trip a PER-USER breaker on top of the
-- global one (#115). The global breaker stays as an aggregate backstop; this
-- catches a single abuser looping unquota'd LLM routes (questions / gate /
-- facet-decompose / prior-art-rank / landscape-plan / search-rospatent /
-- industrial-usage) without that abuse showing up in operational quota.
--
-- Same rationale as 0012 for being a FUNCTION (not a PostgREST row-select):
-- PostgREST caps selects at 1000 rows and disables aggregates on self-host, so
-- a row-fetch-and-sum would silently undercount during an abuse spike. The
-- (user_id, created_at) index from 0011 (llm_cost_events_user_idx) serves this
-- query directly. cost_rub IS NULL rows (no confirmed price, anti-fab) are
-- excluded by sum() semantics — the breaker acts on confirmed ₽ only.

create or replace function public.llm_spend_today_for_user(
  p_user uuid,
  p_since timestamptz
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(cost_rub), 0)
  from public.llm_cost_events
  where user_id = p_user
    and created_at >= p_since;
$$;

-- Service-role only (the guard runs server-side with the service key); never
-- callable by anon/authenticated browser clients.
revoke execute on function public.llm_spend_today_for_user(uuid, timestamptz) from public;
revoke execute on function public.llm_spend_today_for_user(uuid, timestamptz) from anon;
revoke execute on function public.llm_spend_today_for_user(uuid, timestamptz) from authenticated;
grant execute on function public.llm_spend_today_for_user(uuid, timestamptz) to service_role;
