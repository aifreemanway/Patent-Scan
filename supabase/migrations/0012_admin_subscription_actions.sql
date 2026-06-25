-- Patent-Scan — 0012 admin manual subscription activation / deactivation (PR-C).
--
-- Vsevolod: «в админ панель заложи ручную активацию и деактивацию». The B2B
-- invoice flow is: user requests an invoice (/api/billing/invoice-request) →
-- Vsevolod issues the invoice OUTSIDE the system → on payment he ACTIVATES the
-- tier here; DEACTIVATE reverts to free (refund / dispute / end of term).
--
-- No 54-ФЗ receipt is generated for invoice payments — the closing document is
-- the УПД, produced outside the system (ba handoff 2026-06-09). These RPCs only
-- record the activation fact + grant/revoke the tier.
--
-- ⚠ APPLY UNDER supabase_admin (mutates public.profiles, owned by supabase_admin)
-- — same as 0010. Idempotent / ON_ERROR_STOP-safe (create-or-replace only).
--
-- Both functions write an admin_actions audit row (0011), so the журнал at
-- /admin/actions reflects every money-relevant write.

-- ── admin_activate_subscription ───────────────────────────────────────────────
-- Activate (or extend) a paid tier from an invoice payment. Records a succeeded
-- `payments` row (audit trail; yookassa_payment_id synthesised since the column
-- is NOT NULL UNIQUE but there is no ЮKassa id), upserts the subscription, mirrors
-- profiles.tier + tier_expires_at, and logs the admin action. Returns the new
-- period_end. Extends from the LATER of now() or the current period end, so an
-- early re-activation does not shorten an already-paid window.
create or replace function public.admin_activate_subscription(
  p_user_id uuid,
  p_tier text,
  p_period_months int,
  p_admin_email text,
  p_invoice_no text default null,
  p_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid;
  v_base timestamptz;
  v_period_end timestamptz;
  v_synthetic text;
begin
  if p_tier not in ('starter','team','team_plus') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_tier');
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'user_not_found');
  end if;

  -- Extend from the later of now or the existing paid period (don't shorten).
  select greatest(now(), coalesce(max(current_period_end), now()))
    into v_base
    from public.subscriptions
    where user_id = p_user_id;
  v_base := coalesce(v_base, now());
  v_period_end := v_base + (coalesce(p_period_months, 1)::text || ' months')::interval;

  v_synthetic := 'invoice_' || gen_random_uuid()::text;

  insert into public.payments
    (user_id, yookassa_payment_id, status, amount, currency, purpose,
     period_months, is_recurring, metadata, captured_at)
  values
    (p_user_id, v_synthetic, 'succeeded', coalesce(p_amount, 0), 'RUB',
     'subscription_' || p_tier, p_period_months, false,
     jsonb_build_object('source','admin_invoice','invoice_no',p_invoice_no,
                        'admin_email',p_admin_email),
     now())
  returning id into v_payment_id;

  insert into public.subscriptions as s
    (user_id, tier, status, current_period_start, current_period_end,
     cancel_at_period_end, last_payment_id, updated_at)
  values
    (p_user_id, p_tier, 'active', now(), v_period_end, false, v_payment_id, now())
  on conflict (user_id) do update set
    tier = excluded.tier,
    status = 'active',
    current_period_start = coalesce(s.current_period_start, excluded.current_period_start),
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = false,
    last_payment_id = excluded.last_payment_id,
    updated_at = now();

  update public.profiles
    set tier = p_tier, tier_expires_at = v_period_end
    where id = p_user_id;

  insert into public.admin_actions (admin_email, target_user_id, action, payload)
  values (p_admin_email, p_user_id, 'invoice_activation',
    jsonb_build_object('tier', p_tier, 'period_months', p_period_months,
                       'invoice_no', p_invoice_no, 'amount', p_amount,
                       'period_end', v_period_end));

  return jsonb_build_object('ok', true, 'tier', p_tier, 'period_end', v_period_end);
end;
$$;
revoke all on function public.admin_activate_subscription(uuid, text, int, text, text, numeric)
  from public, anon, authenticated;
grant execute on function public.admin_activate_subscription(uuid, text, int, text, text, numeric)
  to service_role;

-- ── admin_deactivate_subscription ─────────────────────────────────────────────
-- Revert a user to free immediately (refund / dispute / manual end). Marks the
-- subscription canceled, clears the paid window, downgrades the profile, and logs
-- the action. Idempotent: a user with no subscription still gets downgraded +
-- logged, returning ok.
create or replace function public.admin_deactivate_subscription(
  p_user_id uuid,
  p_admin_email text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'user_not_found');
  end if;

  update public.subscriptions
    set status = 'canceled',
        cancel_at_period_end = true,
        current_period_end = now(),
        updated_at = now()
    where user_id = p_user_id;

  update public.profiles
    set tier = 'free', tier_expires_at = null
    where id = p_user_id;

  insert into public.admin_actions (admin_email, target_user_id, action, payload)
  values (p_admin_email, p_user_id, 'subscription_deactivation',
    jsonb_build_object('reason', p_reason));

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.admin_deactivate_subscription(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_deactivate_subscription(uuid, text, text)
  to service_role;
