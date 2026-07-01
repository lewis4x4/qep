-- 657_payment_terms_seed_and_sixty_day_hold.sql
--
-- Finance ops slice: seed the canonical AR payment-terms catalogue (Net 30 default)
-- and wire up automatic 60-day past-due credit-hold enforcement for QRM companies.
--
-- Builds on:
--   435_payment_terms.sql                     -- payment_terms lookup (no rows seeded)
--   472_qrm_company_wave2_columns.sql         -- qrm_companies.payment_terms_id FK
--   501_wave3_invoice_payment_terms.sql       -- customer_invoices.payment_terms_id FK
--   523_deal_genome_service_analysis_foundation.sql -- qrm_companies credit_hold columns
--   082_customer_portal.sql                   -- customer_invoices (due_date, balance_due, status)
--
-- Canonical tenant workspace is 'default' (matches 544 selling-branches and the
-- tax/QuickBooks demo seeds). Seeds are idempotent via ON CONFLICT (workspace_id, code).
--
-- Rollback notes:
--   drop trigger if exists set_qrm_company_default_payment_terms on public.qrm_companies;
--   drop function if exists public.trg_set_qrm_company_default_payment_terms();
--   drop function if exists public.default_payment_terms_id(text);
--   drop function if exists public.evaluate_credit_holds(text);
--   drop function if exists public.assert_customer_not_on_hold(uuid);
--   drop function if exists public.is_customer_on_credit_hold(uuid);
--   -- seeded rows may be left in place or removed by (workspace_id, code) as needed.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Seed the canonical payment-terms catalogue for the 'default' workspace.
--    Idempotent: re-running refreshes the human-facing fields but never
--    duplicates a (workspace_id, code) pair. Net 30 is the house default.
--    NOTE: Which customer accounts get Net 45 is a deferred, data-driven
--    Round-2 decision -- do NOT hardcode Net 45 assignments here; the
--    qrm_companies.payment_terms_id override column already supports it.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.payment_terms
  (workspace_id, code, name, net_days, discount_pct, discount_days, is_cod, is_prepaid, active)
values
  ('default', 'NET30',          'Net 30',          30, null, null, false, false, true),
  ('default', 'NET15',          'Net 15',          15, null, null, false, false, true),
  ('default', 'NET45',          'Net 45',          45, null, null, false, false, true),
  ('default', 'NET60',          'Net 60',          60, null, null, false, false, true),
  ('default', 'COD',            'Cash on Delivery', 0, null, null, true,  false, true),
  ('default', 'PREPAID',        'Prepaid',          0, null, null, false, true,  true),
  ('default', 'DUE_ON_RECEIPT', 'Due on Receipt',   0, null, null, false, false, true)
on conflict (workspace_id, code) do update
  set name          = excluded.name,
      net_days      = excluded.net_days,
      discount_pct  = excluded.discount_pct,
      discount_days = excluded.discount_days,
      is_cod        = excluded.is_cod,
      is_prepaid    = excluded.is_prepaid,
      active        = excluded.active,
      updated_at    = now(),
      deleted_at    = null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Default-terms resolver + BEFORE INSERT trigger on qrm_companies.
--    Resolves the workspace's active NET30 term id. The trigger stamps it onto
--    new companies only when payment_terms_id is null, preserving per-customer
--    overrides (e.g. a future Net 45 assignment set explicitly at insert time).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.default_payment_terms_id(p_workspace_id text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.payment_terms
  where workspace_id = p_workspace_id
    and code = 'NET30'
    and active = true
    and deleted_at is null
  order by created_at
  limit 1;
$$;

comment on function public.default_payment_terms_id(text) is
  'Returns the active NET30 payment_terms id for a workspace; the house AR default.';

create or replace function public.trg_set_qrm_company_default_payment_terms()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Preserve any explicit per-customer override; only fill when unset.
  if new.payment_terms_id is null then
    new.payment_terms_id := public.default_payment_terms_id(new.workspace_id);
  end if;
  return new;
end;
$$;

drop trigger if exists set_qrm_company_default_payment_terms on public.qrm_companies;
create trigger set_qrm_company_default_payment_terms
  before insert on public.qrm_companies
  for each row
  execute function public.trg_set_qrm_company_default_payment_terms();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. 60-day auto-hold enforcement.
--    Due-date source: public.customer_invoices.due_date (a NOT NULL date column
--    added in 082_customer_portal.sql). It is authoritative and already carries
--    the effective net-terms date, so we do NOT need to derive it from
--    created_at + net_days via payment_terms.
--
--    For each company we look at open invoices (status not in paid/void/reversed)
--    whose due_date is more than 60 days in the past and still carry a positive
--    balance_due. Any such invoice trips an AUTO credit hold. When a previously
--    AUTO-held company no longer has a qualifying invoice, the AUTO hold is
--    released. Manually-set holds (reason not starting with 'AUTO:') are never
--    touched. Returns the count of accounts NEWLY placed on hold this run.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.evaluate_credit_holds(p_workspace_id text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auto_reason constant text := 'AUTO: invoice 60+ days past due';
  v_newly_held integer := 0;
begin
  with past_due as (
    select distinct ci.crm_company_id
    from public.customer_invoices ci
    where ci.crm_company_id is not null
      and ci.status not in ('paid', 'void', 'reversed')
      and ci.balance_due > 0
      and ci.due_date < (now() - interval '60 days')
      and (p_workspace_id is null or ci.workspace_id = p_workspace_id)
  ),
  -- Place AUTO holds on qualifying companies that are not already held.
  held as (
    update public.qrm_companies c
    set credit_hold        = true,
        credit_hold_reason = v_auto_reason,
        credit_hold_set_at = now(),
        updated_at         = now()
    from past_due pd
    where c.id = pd.crm_company_id
      and c.credit_hold = false
      and (p_workspace_id is null or c.workspace_id = p_workspace_id)
    returning c.id
  ),
  -- Release AUTO holds when the account no longer has a 60+ past-due invoice.
  -- Never release manually-set holds (reason not starting with 'AUTO:').
  released as (
    update public.qrm_companies c
    set credit_hold        = false,
        credit_hold_reason = null,
        credit_hold_set_at = null,
        updated_at         = now()
    where c.credit_hold = true
      and c.credit_hold_reason like 'AUTO:%'
      and c.id not in (select crm_company_id from past_due)
      and (p_workspace_id is null or c.workspace_id = p_workspace_id)
    returning c.id
  )
  select count(*) into v_newly_held from held;

  return v_newly_held;
end;
$$;

comment on function public.evaluate_credit_holds(text) is
  'Sweeps open invoices; auto-holds companies with an invoice 60+ days past due and a positive balance, and auto-releases AUTO holds when clear. Returns count newly held.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. New-order guard helpers. Order/quote creation paths call
--    assert_customer_not_on_hold() before committing new work; the boolean
--    helper is for read-side checks (UI badges, pre-flight validation).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.is_customer_on_credit_hold(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select c.credit_hold
     from public.qrm_companies c
     where c.id = p_company_id),
    false
  );
$$;

comment on function public.is_customer_on_credit_hold(uuid) is
  'True when the given qrm_company is currently on credit hold (auto or manual).';

create or replace function public.assert_customer_not_on_hold(p_company_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_on_hold boolean;
  v_reason  text;
begin
  select c.credit_hold, c.credit_hold_reason
    into v_on_hold, v_reason
  from public.qrm_companies c
  where c.id = p_company_id;

  if coalesce(v_on_hold, false) then
    raise exception
      'Customer % is on credit hold and cannot place new orders: %',
      p_company_id, coalesce(v_reason, 'no reason recorded')
      using errcode = 'check_violation';
  end if;
end;
$$;

comment on function public.assert_customer_not_on_hold(uuid) is
  'Raises when the given qrm_company is on credit hold; call from order/quote creation paths.';

commit;
