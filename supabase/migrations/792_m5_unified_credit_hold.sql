-- ============================================================================
-- Migration 792: M5.1 — Unified credit hold at all three checkouts
--
--   Stream M (Revenue Convergence, blueprint §7; RF-026/RF-038: a customer
--   90 days past due could buy a machine, run a parts account, and rent
--   iron). Two disconnected systems become one:
--
--   1. evaluate_credit_holds (m657) still flags qrm_companies.credit_hold,
--      and now ALSO materializes/clears ar_credit_blocks — the m168 table
--      the rental checkout gate (m770/773) has read since it shipped but
--      which had zero producers ("materializations deferred until Phase 2C",
--      m166). AUTO blocks clear when the aged AR clears; manual blocks and
--      manual company holds are never touched.
--
--   2. is_customer_on_credit_hold / assert_customer_not_on_hold (m657,
--      zero callers until today) are redefined onto the SAME predicate the
--      rental gate uses: an active ar_credit_blocks row without a current
--      override, OR a manual (non-AUTO) company hold. This is what makes
--      one recorded apply_ar_override (m168/172: approver, reason, window)
--      unblock every checkout at once — quote send, parts submit, and
--      rental checkout all agree.
--
--   3. Hourly pg_cron for the sweep — plain SQL, no HTTP, no secrets
--      (m787 shape). The finance-enforcement manual button keeps working.
--
--   4. Grants tightened: evaluate_credit_holds mutates and relied on
--      default PUBLIC execute; now authenticated + service_role only.
-- ============================================================================

BEGIN;

-- ── 1. The unified hold predicate ───────────────────────────────────────────
create or replace function public.is_customer_on_credit_hold(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.ar_credit_blocks b
      where b.company_id = p_company_id
        and b.status = 'active'
        and b.cleared_at is null
        and (b.override_until is null or b.override_until < now())
    )
    or coalesce((
      select c.credit_hold and coalesce(c.credit_hold_reason, '') not like 'AUTO:%'
      from public.qrm_companies c
      where c.id = p_company_id
    ), false);
$$;

comment on function public.is_customer_on_credit_hold(uuid) is
  'M5.1 unified hold predicate: active ar_credit_blocks row without a current override (same test as the rental checkout gate), OR a manual company hold. AUTO company flags are mirrored into blocks by evaluate_credit_holds, so one apply_ar_override releases every checkout.';

create or replace function public.assert_customer_not_on_hold(p_company_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_reason text;
begin
  if public.is_customer_on_credit_hold(p_company_id) then
    select coalesce(
             (select b.block_reason from public.ar_credit_blocks b
              where b.company_id = p_company_id and b.status = 'active' and b.cleared_at is null
              order by b.blocked_at desc limit 1),
             (select c.credit_hold_reason from public.qrm_companies c where c.id = p_company_id),
             'credit hold'
           )
      into v_reason;
    raise exception 'Customer % is on credit hold: %', p_company_id, v_reason
      using errcode = 'check_violation';
  end if;
end;
$$;

-- ── 2. Sweep materializes/clears blocks alongside the company flag ─────────
create or replace function public.evaluate_credit_holds(p_workspace_id text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_newly_held integer := 0;
begin
  -- Null auth.role() = direct DB context (pg_cron, console) — allowed.
  -- PostgREST always stamps a role claim, so API callers are gated.
  if (select auth.role()) is not null
     and (select auth.role()) is distinct from 'service_role'
     and coalesce((select public.get_my_role())::text, '') not in ('admin', 'manager', 'owner', 'finance_admin') then
    raise exception 'credit hold sweep requires manager, finance, or admin privileges';
  end if;

  with past_due as (
    select ci.crm_company_id,
           max(greatest((now()::date - ci.due_date), 0)) as max_aging_days
    from public.customer_invoices ci
    where ci.crm_company_id is not null
      and ci.status not in ('paid', 'void', 'reversed')
      and ci.balance_due > 0
      and ci.due_date < (now() - interval '60 days')
      and (p_workspace_id is null or ci.workspace_id = p_workspace_id)
    group by ci.crm_company_id
  ), held as (
    update public.qrm_companies c
       set credit_hold = true,
           credit_hold_reason = 'AUTO: invoice 60+ days past due',
           credit_hold_set_at = now()
      from past_due pd
     where c.id = pd.crm_company_id
       and c.credit_hold = false
    returning c.id
  ), released as (
    update public.qrm_companies c
       set credit_hold = false,
           credit_hold_reason = null,
           credit_hold_set_at = null
     where c.credit_hold = true
       and c.credit_hold_reason like 'AUTO:%'
       and (p_workspace_id is null or c.workspace_id = p_workspace_id)
       and c.id not in (select crm_company_id from past_due)
    returning c.id
  ), blocks_created as (
    insert into public.ar_credit_blocks
      (workspace_id, company_id, block_reason, block_threshold_days, current_max_aging_days, status, blocked_at)
    select c.workspace_id, pd.crm_company_id,
           'AUTO: invoice 60+ days past due', 60, pd.max_aging_days, 'active', now()
    from past_due pd
    join public.qrm_companies c on c.id = pd.crm_company_id
    on conflict (company_id) where status = 'active' do nothing
    returning id
  ), blocks_refreshed as (
    update public.ar_credit_blocks b
       set current_max_aging_days = pd.max_aging_days
      from past_due pd
     where b.company_id = pd.crm_company_id
       and b.status = 'active'
       and b.cleared_at is null
    returning b.id
  ), blocks_cleared as (
    update public.ar_credit_blocks b
       set status = 'cleared',
           cleared_at = now()
     where b.status in ('active', 'overridden')
       and b.cleared_at is null
       and b.block_reason like 'AUTO:%'
       and b.company_id not in (select crm_company_id from past_due)
    returning b.id
  )
  select count(*) into v_newly_held from held;

  return v_newly_held;
end;
$$;

comment on function public.evaluate_credit_holds(text) is
  'M5.1: 60-day AR sweep. Flags/clears qrm_companies.credit_hold AND materializes/clears AUTO ar_credit_blocks rows so the rental checkout gate, quote send, and parts submit all agree. Manual holds/blocks are never touched. Runs hourly on pg_cron + the finance-enforcement manual button.';

-- ── 3. Grants: sweeping mutates state ───────────────────────────────────────
revoke execute on function public.evaluate_credit_holds(text) from public;
revoke execute on function public.evaluate_credit_holds(text) from anon;
grant execute on function public.evaluate_credit_holds(text) to authenticated;
grant execute on function public.evaluate_credit_holds(text) to service_role;

-- ── 4. Hourly cron (plain SQL — no HTTP, no secrets; m787 shape) ───────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'Skipping evaluate-credit-holds cron: pg_cron not available.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'evaluate-credit-holds-hourly') THEN
    PERFORM cron.unschedule('evaluate-credit-holds-hourly');
  END IF;

  PERFORM cron.schedule(
    'evaluate-credit-holds-hourly',
    '20 * * * *',
    $job$select public.evaluate_credit_holds(null);$job$
  );
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Skipping evaluate-credit-holds cron: %', SQLERRM;
END $$;

COMMIT;
