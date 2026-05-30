-- Patent-Scan — 0006 personal-cabinet profile extensions
-- Run in Supabase SQL Editor AFTER 0005.
--
-- Adds the columns the /account/profile form persists. Industrial Usage toggle
-- is default-on (spec industrial-usage §5: «Quick-decision: default-load всё»);
-- email_notifications_ready default-on too (only transactional «обзор готов»
-- can be silenced; «принят в обработку» is юр-обязательно and not stored).
--
-- Soft-delete column is the user-facing «удалить аккаунт» landing — actual hard
-- delete happens 30 days later via a cleanup function added in a later PR.

alter table public.profiles
  add column if not exists industrial_usage_enabled boolean not null default true,
  add column if not exists email_notifications_ready boolean not null default true,
  add column if not exists full_name text,
  add column if not exists organization text,
  add column if not exists position text,
  add column if not exists phone text,
  add column if not exists account_deleted_at timestamptz;
