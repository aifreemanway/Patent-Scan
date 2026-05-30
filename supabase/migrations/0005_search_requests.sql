-- Patent-Scan — 0005 search_requests (Phase 1 PRODUCT-FIRST foundation)
-- Run in Supabase SQL Editor AFTER 0004 (Dashboard → SQL Editor → paste → Run).
--
-- Single unified history table for ALL user-facing requests (novelty, landscape,
-- deep_analysis, literature_review) — the foundation for the personal cabinet
-- (`/account/history`), the literature-review async pipeline (worker reads
-- `pending` rows, updates `stage` / `progress_pct` / `status`), and any future
-- per-request tier-gating analytics. Type is a discriminator.
--
-- Spec: Antepatent/specs/personal-cabinet-spec-2026-05-30.md §4
-- Plan: ~/.claude/plans/foamy-cooking-kay.md §2

-- ── ENUMs ─────────────────────────────────────────────────────
do $$ begin
  create type public.search_type as enum (
    'novelty', 'landscape', 'deep_analysis', 'literature_review'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.search_status as enum (
    'pending', 'in_progress', 'completed', 'error', 'cancelled'
  );
exception when duplicate_object then null; end $$;

-- ── Table ─────────────────────────────────────────────────────
create table if not exists public.search_requests (
  id                            uuid primary key default gen_random_uuid(),
  user_id                       uuid not null references public.profiles(id) on delete cascade,
  type                          public.search_type not null,
  status                        public.search_status not null default 'pending',
  topic                         text not null,
  description                   text,
  params                        jsonb not null default '{}'::jsonb,
  result                        jsonb,
  result_pdf_url                text,
  watermark                     boolean not null default false,
  cogs_actual                   numeric(10,2),
  error_message                 text,
  stage                         smallint check (stage is null or stage between 1 and 9),
  progress_pct                  smallint default 0 check (progress_pct between 0 and 100),
  notify_received_sent_at       timestamptz,
  notify_ready_sent_at          timestamptz,
  notify_error_sent_at          timestamptz,
  deleted_at                    timestamptz,
  retry_count                   smallint not null default 0,
  locked_by                     text,
  locked_at                     timestamptz,
  created_at                    timestamptz not null default now(),
  started_at                    timestamptz,
  completed_at                  timestamptz,
  updated_at                    timestamptz not null default now()
);

-- ── Indexes ───────────────────────────────────────────────────
-- /account/history list view (latest first, hide soft-deleted)
create index if not exists search_requests_user_created_idx
  on public.search_requests (user_id, created_at desc)
  where deleted_at is null;

-- /account/history filter-by-type
create index if not exists search_requests_user_type_idx
  on public.search_requests (user_id, type)
  where deleted_at is null;

-- Worker polling: SELECT ... WHERE status='pending' FOR UPDATE SKIP LOCKED
-- (partial index keeps this fast even as completed rows pile up)
create index if not exists search_requests_pending_idx
  on public.search_requests (created_at)
  where status = 'pending';

-- ── Row Level Security ────────────────────────────────────────
alter table public.search_requests enable row level security;

-- Users SELECT only their own non-deleted rows.
drop policy if exists search_requests_self_select on public.search_requests;
create policy search_requests_self_select on public.search_requests
  for select
  using (auth.uid() = user_id and deleted_at is null);

-- Users INSERT only as themselves. In practice routes use service_role (which
-- bypasses RLS) so the actual write happens through createSupabaseAdmin(); this
-- policy is the belt-and-suspenders fallback for any future client-side write.
drop policy if exists search_requests_self_insert on public.search_requests;
create policy search_requests_self_insert on public.search_requests
  for insert
  with check (auth.uid() = user_id);

-- Users UPDATE only their own non-deleted rows (used for client-initiated
-- cancel and soft-delete via RPC below; the RPCs run with security definer
-- but the policy keeps things safe if anything ever hits the table directly).
drop policy if exists search_requests_self_update on public.search_requests;
create policy search_requests_self_update on public.search_requests
  for update
  using (auth.uid() = user_id and deleted_at is null)
  with check (auth.uid() = user_id);

-- ── updated_at auto-bump trigger ──────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists search_requests_set_updated_at on public.search_requests;
create trigger search_requests_set_updated_at
  before update on public.search_requests
  for each row execute function public.set_updated_at();

-- ── Cancel RPC ────────────────────────────────────────────────
-- Atomically cancel a pending or in-progress request OWNED by the caller.
-- Returns { ok: bool, reason?: text }. The worker is responsible for checking
-- status='in_progress' between stages and aborting if it flipped to 'cancelled'.
create or replace function public.cancel_search_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated int;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  update public.search_requests
    set status = 'cancelled', completed_at = now()
    where id = p_request_id
      and user_id = v_user_id
      and status in ('pending', 'in_progress')
      and deleted_at is null;
  get diagnostics v_updated = row_count;

  if v_updated = 1 then
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'not_cancellable');
end;
$$;

revoke all on function public.cancel_search_request(uuid) from public, anon;
grant execute on function public.cancel_search_request(uuid) to authenticated;

-- ── Soft-delete RPC ───────────────────────────────────────────
-- Hides a row from the user's history. Hard-delete after 30 days via cleanup
-- RPC below (called by pg_cron in a later PR; for PR-1 just exposed for ops).
create or replace function public.soft_delete_search_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated int;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  update public.search_requests
    set deleted_at = now()
    where id = p_request_id
      and user_id = v_user_id
      and deleted_at is null;
  get diagnostics v_updated = row_count;

  if v_updated = 1 then
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'not_found');
end;
$$;

revoke all on function public.soft_delete_search_request(uuid) from public, anon;
grant execute on function public.soft_delete_search_request(uuid) to authenticated;

-- ── Hard-delete cleanup (called by cron in a later PR) ────────
-- Drops rows soft-deleted >30 days ago. Manual run is safe.
create or replace function public.cleanup_deleted_search_requests()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from public.search_requests
    where deleted_at is not null
      and deleted_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_deleted_search_requests() from public, anon, authenticated;
grant execute on function public.cleanup_deleted_search_requests() to service_role;

-- ── Data migration from legacy `searches` table ───────────────
-- The pre-existing `searches` table (migration 0001) was never written to by
-- live routes — the user-facing report state has lived in browser sessionStorage
-- so this migration may move 0 rows in practice, but the join is here for
-- safety in case any deployments DID populate it.
--
-- Mapping:
--   searches.kind = 'search'    → search_requests.type = 'novelty'
--   searches.kind = 'landscape' → search_requests.type = 'landscape'
--   state jsonb → params (full state preserved)
--   All migrated rows marked 'completed' (historical, terminal).
--
-- The legacy `searches` table is NOT dropped here — kept for rollback safety
-- until 2 weeks of prod observation, then removed in a separate migration.
insert into public.search_requests
  (id, user_id, type, status, topic, description, params, created_at, completed_at, updated_at)
select
  s.id,
  s.user_id,
  case s.kind
    when 'search' then 'novelty'::public.search_type
    when 'landscape' then 'landscape'::public.search_type
    else 'novelty'::public.search_type
  end,
  'completed'::public.search_status,
  coalesce(s.topic, left(coalesce(s.description, ''), 500), '(без темы)'),
  s.description,
  coalesce(s.state, '{}'::jsonb),
  s.created_at,
  s.updated_at,
  s.updated_at
from public.searches s
where not exists (select 1 from public.search_requests sr where sr.id = s.id);
