-- Patent-Scan — 0015 quota_limit → CANON §4a alignment
--
-- Fixes quota drift: the live quota_limit() (last set by 0010) carried
-- pre-canon search/landscape numbers. Canon source of truth:
--   Antepatent/marketing/canonical-naming-IA-CTA-2026-06-02.md (rows 69-73),
--   reconfirmed by tasks/landing-tier2-pricing-cta-specs-2026-06-10.md
--   ("Точные ₽/квоты — строго из CANON §4, не из памяти").
--
-- Canon table (monthly, per tier):
--   Tier      Search   Deep   Landscape   Screening(litreview)
--   Free      3        —      —           —
--   Starter   10       1      —           —
--   Team      50       5      2           —
--   TeamPlus  100      15     5           4 credits/YEAR
--   Enterprise unlimited, API, SSO
--
-- What THIS migration changes (only what quota_limit() enforces monthly):
--   search:    starter 20→10, team 60→50        (free/team_plus already canon)
--   landscape: free 3→0, starter 10→0, team 30→2, team_plus 50→5
--
-- What this migration deliberately does NOT change (needs mechanics beyond a
-- monthly counter, and is inert until billing goes live — no paid accounts yet):
--   • literature_review (Screening): stays at 0 for free/starter/team (canon)
--     and 999999 for enterprise (canon "unlimited"). TeamPlus canon is 4/YEAR —
--     the increment_usage counter is monthly (date_trunc('month')), so a yearly
--     credit can't be expressed here without a yearly-period mechanic. Left at 0
--     for team_plus (no team_plus accounts exist). TODO at billing go-live.
--   • Deep Analysis: NOT a quota_limit operation at all. It is gated by the
--     one-free-credit flag profiles.free_deep_analysis_used; canon's monthly
--     Deep quota (1/5/15) requires a new increment_usage('deep') mechanic AND a
--     product decision on the existing free-trial credit. Out of scope here.
--
-- Enterprise stays 999999 across the board (canon "unlimited") — manual
-- enterprise grants (e.g. test accounts) keep full access. No other tier or
-- function is touched. Mirror these numbers in lib/config.ts QUOTA_LIMITS.

create or replace function public.quota_limit(p_tier text, p_operation text)
returns int
language sql
immutable
as $$
  select case
    when p_operation = 'questions' then 999999
    when p_tier = 'enterprise' then 999999
    when p_operation in ('search','analyze') then
      case p_tier
        when 'free' then 3 when 'starter' then 10 when 'team' then 50
        when 'team_plus' then 100 else 0 end
    when p_operation = 'landscape' then
      case p_tier
        when 'free' then 0 when 'starter' then 0 when 'team' then 2
        when 'team_plus' then 5 else 0 end
    else 0
  end;
$$;
