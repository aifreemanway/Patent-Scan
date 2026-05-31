-- Patent-Scan — 0009 fix: usage_counters CHECK constraint missing 'literature_review'.
-- Run in Supabase SQL Editor AFTER 0008.
--
-- BUG-LITQ-1 (ap-qa 2026-05-31, PROD): /api/literature-review/submit → 500
-- internal_error for team/enterprise users. Root cause: migration 0007 added
-- 'literature_review' to increment_usage()'s allow-list and to quota_limit(),
-- but forgot to update the CHECK constraint on usage_counters itself.
-- Verified: direct call increment_usage(enterprise_id, 'literature_review')
-- raises 23514 ("violates check constraint usage_counters_operation_check")
-- because the INSERT can't write the row.
--
-- Fix: drop and re-add the constraint with the literature_review operation
-- included. Done as drop-then-add (not ALTER … RENAME) so the new whitelist
-- is unambiguous in the DDL.

alter table public.usage_counters
  drop constraint if exists usage_counters_operation_check;

alter table public.usage_counters
  add constraint usage_counters_operation_check
  check (operation in (
    'search',
    'landscape',
    'analyze',
    'questions',
    'literature_review'
  ));
