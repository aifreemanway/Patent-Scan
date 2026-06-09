-- Patent-Scan — 0011 admin cost telemetry + audit scaffold
-- Run in Supabase SQL Editor AFTER 0009.
--
-- ⚠ Numbering: 0010 is RESERVED for the billing/subscriptions model (see
-- tasks/feature-admin-panel-2026-06-09.md §7.4). This migration is INDEPENDENT
-- of it (two additive tables + one read-only aggregate RPC, no shared objects),
-- so apply it on its own — a temporary 0010 gap is fine for manual application.
--
-- Phase 1 of /admin (read views + LLM costs + audit scaffold), per
-- tasks/feature-admin-panel-2026-06-09.md §4 + §6. ZERO-RISK: purely additive,
-- no change to existing data/schema. All three objects are admin-only — RLS is
-- enabled with NO policies (deny-all to anon/authenticated); only the
-- service_role key (createSupabaseAdmin) touches them, so costs can never reach
-- a client bundle (AC#7: «косты не утекают за гейт»).

-- ── LLM cost telemetry ────────────────────────────────────────
-- One row per LLM call. lib/cost.ts inserts best-effort alongside the existing
-- [cost] log line (telemetry must never block a call → fire-and-forget, errors
-- swallowed). request_id/user_id are nullable: fan-out machinery (rank/gate/
-- landscape-search) logs model+stage+cost with no user context; terminal
-- user-facing calls (analyze verdict, …) attribute both. cost_rub is NULL when
-- the model has no confirmed Timeweb price (anti-fab: never invent a ₽ figure).
create table if not exists public.llm_cost_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid,          -- search_requests.id when known (no FK: a missing/raced row must never break telemetry)
  user_id uuid,             -- profiles.id when known
  label text not null,      -- call-site stage: analyze | rank | gate | extract | facet | synthesize | iu | deep | …
  model text not null,      -- gemini/gemini-2.5-flash | anthropic/claude-sonnet-4-6 | …
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  cost_rub numeric,         -- NULL = model has no confirmed price (anti-fab)
  created_at timestamptz not null default now()
);
create index if not exists llm_cost_events_created_idx on public.llm_cost_events (created_at desc);
create index if not exists llm_cost_events_user_idx on public.llm_cost_events (user_id, created_at desc);
create index if not exists llm_cost_events_request_idx on public.llm_cost_events (request_id);

alter table public.llm_cost_events enable row level security;
-- No policies → deny-all to anon/authenticated. service_role bypasses RLS.

-- ── Admin audit log (scaffold for Phase 2 write-actions) ──────
-- Created now so Phase 2 (tier switch / invoice activation, §5) needs no second
-- migration. NO rows are written in Phase 1 (the panel is read-only).
create table if not exists public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_email text not null,
  target_user_id uuid,      -- profiles.id the action affected
  action text not null,     -- 'tier_switch' | 'invoice_activation' | 'grant_credit'
  payload jsonb not null default '{}'::jsonb,  -- {old,new,tier,period,invoice,…}
  created_at timestamptz not null default now()
);
create index if not exists admin_actions_created_idx on public.admin_actions (created_at desc);
create index if not exists admin_actions_target_idx on public.admin_actions (target_user_id, created_at desc);

alter table public.admin_actions enable row level security;
-- No policies → deny-all. Only service_role (admin server code) reads/writes.

-- ── Cost aggregate (read-only, service_role) ──────────────────
-- Aggregates in Postgres so totals are exact regardless of row count / the
-- PostgREST max-rows cap (fetching thousands of events to the app to sum them
-- would silently truncate). Returns the dashboard's ИТОГО + per-model +
-- per-stage(label) + per-user breakdowns for events since p_since.
create or replace function public.admin_cost_summary(p_since timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'total_rub', coalesce((select sum(cost_rub) from public.llm_cost_events where created_at >= p_since), 0),
    'event_count', (select count(*) from public.llm_cost_events where created_at >= p_since),
    'by_model', coalesce((
      select jsonb_object_agg(model, s)
      from (select model, sum(cost_rub) s from public.llm_cost_events where created_at >= p_since group by model) t
    ), '{}'::jsonb),
    'by_label', coalesce((
      select jsonb_object_agg(label, s)
      from (select label, sum(cost_rub) s from public.llm_cost_events where created_at >= p_since group by label) t
    ), '{}'::jsonb),
    'by_user', coalesce((
      select jsonb_object_agg(user_id::text, s)
      from (select user_id, sum(cost_rub) s from public.llm_cost_events where created_at >= p_since and user_id is not null group by user_id) t
    ), '{}'::jsonb)
  );
$$;

revoke all on function public.admin_cost_summary(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_cost_summary(timestamptz) to service_role;
