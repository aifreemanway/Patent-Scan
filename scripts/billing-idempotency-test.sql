-- Billing idempotency regression test (cofounder HARD-GATE for PR-B).
-- Proves: delivering the same succeeded webhook TWICE grants the period ONCE.
--
-- Safe to run against prod: everything happens inside a transaction that is
-- ROLLED BACK at the end — no payment, subscription, or profile row persists.
--
-- Run:
--   docker exec -i ps-auth-db-1 psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < scripts/billing-idempotency-test.sql
-- Expect: "PASS: double webhook -> single apply" and the final SELECTs empty.

begin;

do $$
declare
  v_uid uuid;
  r1 jsonb;
  r2 jsonb;
  v_succeeded int;
  v_subs int;
  v_tier text;
begin
  -- Borrow any real profile (FK target). No row is kept (rollback below).
  select id into v_uid from public.profiles limit 1;
  if v_uid is null then
    raise exception 'no profiles to test against';
  end if;

  insert into public.payments
    (user_id, yookassa_payment_id, amount, purpose, period_months, status)
  values
    (v_uid, 'REGRESSION-IDEMP-TEST', 20000, 'subscription_team', 1, 'pending');

  -- Two identical "succeeded webhook" applications.
  r1 := public.apply_successful_payment('REGRESSION-IDEMP-TEST', 'team', 1, null);
  r2 := public.apply_successful_payment('REGRESSION-IDEMP-TEST', 'team', 1, null);

  select count(*) into v_succeeded
    from public.payments
    where yookassa_payment_id = 'REGRESSION-IDEMP-TEST' and status = 'succeeded';
  select count(*) into v_subs from public.subscriptions where user_id = v_uid;
  select tier into v_tier from public.subscriptions where user_id = v_uid;

  raise notice 'first.applied=%  second.applied=%  succeeded_count=%  subs=%  sub_tier=%',
    r1->>'applied', r2->>'applied', v_succeeded, v_subs, v_tier;

  if (r1->>'applied')::bool is not true then
    raise exception 'FAIL: first apply did not grant';
  end if;
  if (r2->>'applied')::bool is not false then
    raise exception 'FAIL: second apply granted again — DOUBLE CHARGE risk';
  end if;
  if v_succeeded <> 1 then
    raise exception 'FAIL: succeeded payment count = % (expected 1)', v_succeeded;
  end if;
  if v_subs <> 1 or v_tier <> 'team' then
    raise exception 'FAIL: subscription state wrong (subs=%, tier=%)', v_subs, v_tier;
  end if;

  raise notice 'PASS: double webhook -> single apply';
end $$;

rollback;

-- Post-rollback proof: nothing persisted.
select count(*) as leftover_test_payments
  from public.payments
  where yookassa_payment_id = 'REGRESSION-IDEMP-TEST';
