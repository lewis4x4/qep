-- 828_ar_monthly_charge_and_deposit_liability_ledger.sql
--
-- Fixes the daily-finance-charge defect by reserving one charge per original
-- invoice/month before an invoice is created. Compounding stays disabled until
-- a dated legal approval explicitly permits it. Adds the F11 unified,
-- append-only deposit liability subledger over existing sale/rental sources.

begin;

-- ---------------------------------------------------------------------------
-- 1. Legal activation evidence and monthly charge identity.
-- ---------------------------------------------------------------------------

create table if not exists public.ar_finance_charge_policy_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  approval_status text not null default 'active'
    check (approval_status in ('active', 'revoked', 'expired')),
  compounding_allowed boolean not null default false,
  max_monthly_rate numeric(8, 6) not null
    check (max_monthly_rate >= 0 and max_monthly_rate <= 0.015),
  legal_reference text not null check (nullif(trim(legal_reference), '') is not null),
  evidence_url text not null check (nullif(trim(evidence_url), '') is not null),
  approved_by uuid not null references public.profiles(id) on delete restrict,
  approved_at timestamptz not null,
  effective_on date not null,
  expires_on date,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete restrict,
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_on is null or expires_on >= effective_on)
);

comment on table public.ar_finance_charge_policy_approvals is
  'Legal evidence gate for automated AR finance charges. No row is seeded by the owner packet; compounding remains off until counsel-approved evidence is recorded.';

create unique index if not exists uq_ar_finance_charge_policy_active
  on public.ar_finance_charge_policy_approvals(workspace_id)
  where approval_status = 'active';

alter table public.ar_finance_charge_policy_approvals enable row level security;

create policy "ar_finance_charge_policy_service_all"
  on public.ar_finance_charge_policy_approvals for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');
create policy "ar_finance_charge_policy_finance_read"
  on public.ar_finance_charge_policy_approvals for select
  using (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_read()
  );
create policy "ar_finance_charge_policy_owner_insert"
  on public.ar_finance_charge_policy_approvals for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') = 'owner'
  );

create trigger set_ar_finance_charge_policy_updated_at
  before update on public.ar_finance_charge_policy_approvals
  for each row execute function public.set_updated_at();

create or replace function public.ar_finance_charge_policy_bind_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'authenticated'
     or coalesce((select public.get_my_role())::text, '') <> 'owner'
     or new.workspace_id is distinct from public.get_my_workspace()
     or new.approved_by is distinct from (select auth.uid()) then
    raise exception 'finance-charge legal evidence must be recorded by the signed-in workspace owner';
  end if;

  if new.approved_at > now() + interval '5 minutes' then
    raise exception 'finance-charge legal approval cannot be future-dated';
  end if;

  return new;
end;
$$;

create trigger trg_ar_finance_charge_policy_bind_owner
  before insert on public.ar_finance_charge_policy_approvals
  for each row execute function public.ar_finance_charge_policy_bind_owner();

revoke all on function public.ar_finance_charge_policy_bind_owner()
  from public, anon, authenticated, service_role;

-- Approval evidence is append-only for signed-in users. Revocation is a
-- separate, audited state transition so the original legal record cannot be
-- rewritten after finance charges have cited it.
revoke update, delete, truncate on table public.ar_finance_charge_policy_approvals
  from anon, authenticated, service_role;
revoke insert on table public.ar_finance_charge_policy_approvals
  from anon, service_role;
grant select, insert on table public.ar_finance_charge_policy_approvals
  to authenticated;

create or replace function public.revoke_ar_finance_charge_policy_approval(
  p_workspace_id text,
  p_approval_id uuid,
  p_reason text,
  p_revoked_by uuid
)
returns public.ar_finance_charge_policy_approvals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approval public.ar_finance_charge_policy_approvals;
  v_actor public.profiles;
begin
  if p_revoked_by is null then
    raise exception 'finance-charge policy revocation requires an attributable actor';
  end if;

  if (select auth.role()) is distinct from 'service_role' then
    if p_workspace_id is distinct from public.get_my_workspace()
       or coalesce((select public.get_my_role())::text, '') <> 'owner' then
      raise exception 'finance-charge policy revocation requires the workspace owner';
    end if;
    if p_revoked_by is distinct from (select auth.uid()) then
      raise exception 'finance-charge policy revocation actor must match the signed-in owner';
    end if;
  end if;

  if nullif(trim(p_reason), '') is null then
    raise exception 'finance-charge policy revocation requires a reason';
  end if;

  select profile.* into v_actor
  from public.profiles profile
  join public.profile_workspaces membership
    on membership.profile_id = profile.id
   and membership.workspace_id = p_workspace_id
  where profile.id = p_revoked_by
    and profile.is_active = true
    and profile.role::text = 'owner';

  if v_actor.id is null then
    raise exception 'finance-charge policy revocation actor must be an active workspace owner';
  end if;

  update public.ar_finance_charge_policy_approvals p
  set
    approval_status = 'revoked',
    revoked_at = now(),
    revoked_by = p_revoked_by,
    revocation_reason = trim(p_reason),
    updated_at = now()
  where p.id = p_approval_id
    and p.workspace_id = p_workspace_id
    and p.approval_status = 'active'
  returning * into v_approval;

  if v_approval.id is null then
    raise exception 'active finance-charge policy approval not found';
  end if;

  return v_approval;
end;
$$;

revoke all on function public.revoke_ar_finance_charge_policy_approval(text, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_ar_finance_charge_policy_approval(text, uuid, text, uuid)
  to authenticated, service_role;

alter table public.ar_dunning_events
  add column if not exists charge_period date,
  add column if not exists finance_charge_policy_approval_id uuid
    references public.ar_finance_charge_policy_approvals(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ar_dunning_events_charge_period_month_start_chk'
  ) then
    alter table public.ar_dunning_events
      add constraint ar_dunning_events_charge_period_month_start_chk
      check (
        charge_period is null
        or charge_period = date_trunc('month', charge_period::timestamp)::date
      ) not valid;
  end if;
end
$$;

create unique index if not exists uq_ar_dunning_finance_charge_month
  on public.ar_dunning_events(workspace_id, invoice_id, event_type, charge_period)
  where event_type = 'finance_charge'
    and invoice_id is not null
    and charge_period is not null;

create index if not exists idx_ar_dunning_finance_charge_policy
  on public.ar_dunning_events(finance_charge_policy_approval_id)
  where finance_charge_policy_approval_id is not null;

-- Money/audit rows are written only by the security-definer cycle. RLS does
-- not protect TRUNCATE, so inherited table privileges must be removed too.
revoke insert, update, delete, truncate on table public.ar_dunning_events
  from anon, authenticated, service_role;

comment on column public.ar_dunning_events.charge_period is
  'First day of the monthly finance-charge period. New finance charges reserve this key before creating the receivable, preventing daily or concurrent duplicates.';

-- A bounded SKIP LOCKED cursor needs durable claim identity. Without this
-- table, a repeat call would keep selecting the same first batch after its
-- idempotent events already exist and could never drain later invoices.
create table if not exists public.ar_dunning_invoice_cycle_claims (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  cycle_date date not null,
  charge_period date not null,
  invoice_id uuid not null references public.customer_invoices(id) on delete cascade,
  statement_run_id uuid not null references public.ar_statement_runs(id) on delete cascade,
  claim_order integer not null check (claim_order > 0),
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, cycle_date, invoice_id),
  check (charge_period = date_trunc('month', charge_period::timestamp)::date)
);

comment on table public.ar_dunning_invoice_cycle_claims is
  'Durable per-cycle invoice claims for bounded AR evaluation. Repeated calls drain deterministic batches; transaction rollback releases failed claims.';

create index if not exists idx_ar_dunning_invoice_cycle_claims_run
  on public.ar_dunning_invoice_cycle_claims(statement_run_id);
create index if not exists idx_ar_dunning_invoice_cycle_claims_invoice
  on public.ar_dunning_invoice_cycle_claims(invoice_id, cycle_date desc);
create unique index if not exists uq_ar_dunning_invoice_cycle_claims_run_order
  on public.ar_dunning_invoice_cycle_claims(statement_run_id, claim_order);

alter table public.ar_dunning_invoice_cycle_claims enable row level security;

create policy "ar_dunning_invoice_cycle_claims_service_all"
  on public.ar_dunning_invoice_cycle_claims for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');
create policy "ar_dunning_invoice_cycle_claims_finance_read"
  on public.ar_dunning_invoice_cycle_claims for select
  using (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_read()
  );

revoke insert, update, delete, truncate
  on table public.ar_dunning_invoice_cycle_claims
  from anon, authenticated, service_role;
grant select on table public.ar_dunning_invoice_cycle_claims
  to authenticated, service_role;

-- The cursor survives the midnight claim-key rollover. A workspace that did
-- not finish yesterday starts after its last claimed invoice today rather than
-- repeatedly selecting the same oldest page. drained_cycle_date lets the
-- bounded cron wrapper omit workspaces already exhausted for the current day.
create table if not exists public.ar_dunning_workspace_cursors (
  workspace_id text primary key,
  last_due_date date,
  last_created_at timestamptz,
  last_invoice_id uuid,
  last_run_at timestamptz,
  drained_cycle_date date,
  updated_at timestamptz not null default now(),
  check (
    (last_due_date is null and last_created_at is null and last_invoice_id is null)
    or
    (last_due_date is not null and last_created_at is not null and last_invoice_id is not null)
  )
);

comment on table public.ar_dunning_workspace_cursors is
  'Fair, durable AR invoice cursor and daily drain state. The cursor rotates across day boundaries; it is not financial evidence and never replaces cycle claims.';

create index if not exists idx_ar_dunning_workspace_cursors_runner
  on public.ar_dunning_workspace_cursors
    (drained_cycle_date, last_run_at, workspace_id);

alter table public.ar_dunning_workspace_cursors enable row level security;

create policy "ar_dunning_workspace_cursors_service_all"
  on public.ar_dunning_workspace_cursors for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');
create policy "ar_dunning_workspace_cursors_finance_read"
  on public.ar_dunning_workspace_cursors for select
  using (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_read()
  );

revoke insert, update, delete, truncate
  on table public.ar_dunning_workspace_cursors
  from anon, authenticated, service_role;
grant select on table public.ar_dunning_workspace_cursors
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Monthly-idempotent AR cycle. Daily reminder/hold evaluation remains, but
--    finance charges reserve one original-invoice/month event first.
-- ---------------------------------------------------------------------------

create or replace function public.run_ar_dunning_cycle(
  p_workspace_id text default public.get_my_workspace(),
  p_cycle_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.workspace_settings;
  v_statement_run_id uuid;
  v_policy public.ar_finance_charge_policy_approvals;
  v_lawful_annual_cap numeric := 0.18;
  v_monthly_rate numeric;
  v_charge_period date := date_trunc('month', p_cycle_date::timestamp)::date;
  v_compounding_active boolean := false;
  v_statement_count integer := 0;
  v_charge_count integer := 0;
  v_reminder_count integer := 0;
  v_hold_count integer := 0;
  v_rows integer := 0;
  v_batch_limit constant integer := 250;
  v_claimed_count integer := 0;
  v_has_more boolean := false;
  v_cursor_due_date date;
  v_cursor_created_at timestamptz;
  v_cursor_invoice_id uuid;
  v_last_due_date date;
  v_last_created_at timestamptz;
  v_last_invoice_id uuid;
  v_invoice record;
  v_locked_balance numeric;
  v_locked_status text;
  v_principal_basis_cents bigint;
  v_prior_charge_balance_cents bigint;
  v_charge_cents bigint;
  v_charge_event_id uuid;
  v_generated_invoice_id uuid;
  v_portal_customer_id uuid;
  v_numbering_branch_id uuid;
  v_generated_invoice_number text;
  v_department_code text;
  v_finance_department text;
  v_finance_segment text;
begin
  if p_cycle_date is distinct from current_date then
    raise exception 'normal AR dunning runs must use current_date; use a separately approved backfill workflow for historical corrections';
  end if;

  if (select auth.role()) is distinct from 'service_role' then
    if p_workspace_id is distinct from public.get_my_workspace() then
      raise exception 'AR dunning workspace does not match caller workspace';
    end if;
    if not public.qep_finance_can_mutate() then
      raise exception 'AR dunning cycle requires finance/admin privileges';
    end if;
  end if;

  -- Serialize the workspace cursor across both same-day retries and midnight.
  -- The monthly event key separately guards duplicate money.
  perform pg_advisory_xact_lock(
    hashtextextended('ar-dunning:' || p_workspace_id, 0)
  );

  insert into public.ar_dunning_workspace_cursors (workspace_id)
  values (p_workspace_id)
  on conflict (workspace_id) do nothing;

  select
    cursor.last_due_date,
    cursor.last_created_at,
    cursor.last_invoice_id
  into
    v_cursor_due_date,
    v_cursor_created_at,
    v_cursor_invoice_id
  from public.ar_dunning_workspace_cursors cursor
  where cursor.workspace_id = p_workspace_id
  for update;

  select * into v_settings
  from public.workspace_settings ws
  where ws.workspace_id = p_workspace_id;

  if v_settings.workspace_id is null then
    insert into public.workspace_settings (workspace_id)
    values (p_workspace_id)
    on conflict (workspace_id) do nothing;

    select * into v_settings
    from public.workspace_settings ws
    where ws.workspace_id = p_workspace_id;
  end if;

  select coalesce(
    (public.qep_finance_config_value(
      'florida_finance_charge_lawful_cap', p_workspace_id
    )->>'annual_rate')::numeric,
    0.18
  ) into v_lawful_annual_cap;

  select * into v_policy
  from public.ar_finance_charge_policy_approvals p
  where p.workspace_id = p_workspace_id
    and p.approval_status = 'active'
    and p.effective_on <= p_cycle_date
    and (p.expires_on is null or p.expires_on >= p_cycle_date)
  order by p.approved_at desc
  limit 1;

  v_compounding_active :=
    coalesce(v_settings.ar_finance_charge_compounding_enabled, false)
    and coalesce(v_policy.compounding_allowed, false);

  v_monthly_rate := least(
    v_settings.ar_finance_charge_rate_pct,
    v_lawful_annual_cap / 12.0,
    case
      when v_compounding_active then v_policy.max_monthly_rate
      else v_settings.ar_finance_charge_rate_pct
    end
  );

  insert into public.ar_statement_runs (
    workspace_id, run_type, scope_filter, scheduled_at, created_by
  )
  values (
    p_workspace_id,
    case
      when extract(day from p_cycle_date)::integer = v_settings.ar_statement_day_of_month
      then 'statement'
      else 'dunning'
    end,
    jsonb_build_object(
      'cycle_date', p_cycle_date,
      'charge_period', v_charge_period,
      'automated', true,
      'compounding_requested', v_settings.ar_finance_charge_compounding_enabled,
      'compounding_active', v_compounding_active
    ),
    p_cycle_date::timestamptz,
    (select auth.uid())
  )
  returning id into v_statement_run_id;

  -- Claim a deterministic, bounded batch. The durable cycle key prevents a
  -- retry from reclaiming the same first rows, while SKIP LOCKED lets a later
  -- eligible invoice proceed when a payment or another workflow owns a row.
  with locked_candidates as materialized (
    select
      ci.id,
      coalesce(ci.due_date, 'infinity'::date) as cursor_due_date,
      ci.created_at,
      case
        when v_cursor_invoice_id is null then 0
        when coalesce(ci.due_date, 'infinity'::date) > v_cursor_due_date then 0
        when coalesce(ci.due_date, 'infinity'::date) = v_cursor_due_date
         and ci.created_at > v_cursor_created_at then 0
        when coalesce(ci.due_date, 'infinity'::date) = v_cursor_due_date
         and ci.created_at = v_cursor_created_at
         and ci.id > v_cursor_invoice_id then 0
        else 1
      end as cursor_pass
    from public.customer_invoices ci
    join public.qrm_companies c
      on c.id = ci.crm_company_id
     and c.workspace_id = ci.workspace_id
    left join public.ar_dunning_invoice_cycle_claims prior_claim
      on prior_claim.workspace_id = ci.workspace_id
     and prior_claim.cycle_date = p_cycle_date
     and prior_claim.invoice_id = ci.id
    where ci.workspace_id = p_workspace_id
      and ci.crm_company_id is not null
      and ci.balance_due > 0
      and ci.status not in ('paid', 'void', 'reversed')
      and coalesce(c.assess_late_charges, true)
      and prior_claim.id is null
    order by
      cursor_pass,
      coalesce(ci.due_date, 'infinity'::date),
      ci.created_at,
      ci.id
    limit v_batch_limit
    for update of ci skip locked
  ),
  claimable as materialized (
    select
      locked.id,
      row_number() over (
        order by
          locked.cursor_pass,
          locked.cursor_due_date,
          locked.created_at,
          locked.id
      )::integer as claim_order
    from locked_candidates locked
  )
  insert into public.ar_dunning_invoice_cycle_claims (
    workspace_id,
    cycle_date,
    charge_period,
    invoice_id,
    statement_run_id,
    claim_order
  )
  select
    p_workspace_id,
    p_cycle_date,
    v_charge_period,
    claimable.id,
    v_statement_run_id,
    claimable.claim_order
  from claimable
  on conflict (workspace_id, cycle_date, invoice_id) do nothing;

  get diagnostics v_claimed_count = row_count;

  select
    coalesce(ci.due_date, 'infinity'::date),
    ci.created_at,
    ci.id
  into
    v_last_due_date,
    v_last_created_at,
    v_last_invoice_id
  from public.ar_dunning_invoice_cycle_claims claim
  join public.customer_invoices ci
    on ci.id = claim.invoice_id
   and ci.workspace_id = claim.workspace_id
  where claim.statement_run_id = v_statement_run_id
  order by claim.claim_order desc
  limit 1;

  if found then
    update public.ar_dunning_workspace_cursors cursor
    set last_due_date = v_last_due_date,
        last_created_at = v_last_created_at,
        last_invoice_id = v_last_invoice_id,
        updated_at = now()
    where cursor.workspace_id = p_workspace_id;
  end if;

  if extract(day from p_cycle_date)::integer = v_settings.ar_statement_day_of_month then
    insert into public.ar_dunning_events (
      workspace_id, crm_company_id, invoice_id, statement_run_id,
      event_type, cycle_date, days_past_due, principal_basis_cents,
      message_stub
    )
    select
      ci.workspace_id,
      ci.crm_company_id,
      ci.id,
      v_statement_run_id,
      'statement',
      p_cycle_date,
      greatest(p_cycle_date - ci.due_date, 0),
      round(ci.balance_due * 100)::bigint,
      'TODO: brand-voice'
    from public.ar_dunning_invoice_cycle_claims claim
    join public.customer_invoices ci
      on ci.id = claim.invoice_id
     and ci.workspace_id = claim.workspace_id
    join public.qrm_companies c
      on c.id = ci.crm_company_id
     and c.workspace_id = ci.workspace_id
    where claim.workspace_id = p_workspace_id
      and claim.cycle_date = p_cycle_date
      and claim.statement_run_id = v_statement_run_id
      and ci.crm_company_id is not null
      and ci.balance_due > 0
      and ci.status not in ('paid', 'void', 'reversed')
      and coalesce(c.assess_late_charges, true)
    on conflict do nothing;

    get diagnostics v_statement_count = row_count;
  end if;

  for v_invoice in
    select
      ci.*,
      greatest(p_cycle_date - ci.due_date, 0) as days_past_due
    from public.ar_dunning_invoice_cycle_claims claim
    join public.customer_invoices ci
      on ci.id = claim.invoice_id
     and ci.workspace_id = claim.workspace_id
    join public.qrm_companies c
      on c.id = ci.crm_company_id
     and c.workspace_id = ci.workspace_id
    where claim.workspace_id = p_workspace_id
      and claim.cycle_date = p_cycle_date
      and claim.statement_run_id = v_statement_run_id
      and ci.crm_company_id is not null
      and ci.balance_due > 0
      and ci.status not in ('paid', 'void', 'reversed')
      and coalesce(ci.invoice_source_code, '') <> 'FINANCE_CHARGE'
      and coalesce(c.assess_late_charges, true)
    order by ci.due_date, ci.created_at, ci.id
  loop
    -- Re-read the money row under lock. This prevents a payment committed
    -- after the cursor snapshot from being assessed on a stale balance.
    select ci.balance_due, ci.status
      into v_locked_balance, v_locked_status
    from public.customer_invoices ci
    where ci.id = v_invoice.id
      and ci.workspace_id = p_workspace_id
    for update;

    if coalesce(v_locked_balance, 0) <= 0
       or v_locked_status in ('paid', 'void', 'reversed') then
      continue;
    end if;
    v_invoice.balance_due := v_locked_balance;

    if v_invoice.days_past_due >= v_settings.ar_finance_charge_days_past_due
       and not exists (
         select 1
         from public.ar_dunning_events e
         where e.workspace_id = p_workspace_id
           and e.invoice_id = v_invoice.id
           and e.event_type = 'finance_charge'
           and (
             e.charge_period = v_charge_period
             or (
               e.charge_period is null
               and date_trunc('month', e.cycle_date::timestamp)::date = v_charge_period
             )
           )
       )
       and not exists (
         select 1
         from public.ar_dunning_events prior
         where prior.workspace_id = p_workspace_id
           and prior.invoice_id = v_invoice.id
           and prior.event_type = 'finance_charge'
           and prior.cycle_date + interval '1 month' > p_cycle_date::timestamp
       ) then
      v_prior_charge_balance_cents := 0;
      if v_compounding_active then
        select coalesce(sum(round(fc.balance_due * 100)::bigint), 0)::bigint
          into v_prior_charge_balance_cents
        from public.ar_dunning_events prior_event
        join public.customer_invoices fc
          on fc.id = prior_event.generated_invoice_id
        where prior_event.workspace_id = p_workspace_id
          and prior_event.invoice_id = v_invoice.id
          and prior_event.event_type = 'finance_charge'
          and fc.workspace_id = prior_event.workspace_id
          and fc.status not in ('paid', 'void', 'reversed')
          and fc.balance_due > 0;
      end if;

      v_principal_basis_cents :=
        round(v_locked_balance * 100)::bigint
        + v_prior_charge_balance_cents;
      v_charge_cents := greatest(
        floor(v_principal_basis_cents::numeric * v_monthly_rate), 0
      )::bigint;
      v_charge_event_id := null;

      select b.id into v_numbering_branch_id
      from public.branches b
      where b.workspace_id = p_workspace_id
        and b.deleted_at is null
        and (
          b.id::text = v_invoice.branch_id
          or b.slug = v_invoice.branch_id
          or b.legacy_code = v_invoice.branch_id
          or b.legacy_invoice_branch_code = v_invoice.branch_id
        )
      order by b.is_active desc, b.created_at
      limit 1;

      v_finance_department := case
        when v_invoice.invoice_department_code = 'E' or v_invoice.invoice_type = 'equipment' then 'equipment'
        when v_invoice.invoice_department_code = 'P' or v_invoice.invoice_type = 'parts' then 'parts'
        when v_invoice.invoice_department_code in ('S', 'W') or v_invoice.invoice_type = 'service' then 'service'
        when v_invoice.invoice_department_code = 'R' or v_invoice.invoice_type = 'rental' then 'rental'
        else null
      end;
      v_department_code := case v_finance_department
        when 'equipment' then 'E'
        when 'parts' then 'P'
        when 'service' then 'W'
        when 'rental' then 'R'
        else null
      end;

      -- Reserve the unique invoice/month assessment before creating money.
      if v_charge_cents > 0 and v_finance_department is null then
        insert into public.exception_queue (
          workspace_id, source, severity, title, detail, payload,
          entity_table, entity_id
        )
        select
          p_workspace_id,
          'data_quality',
          'warn',
          'Finance charge skipped: invoice department is unclassified',
          'No finance-charge event or receivable was created. Classify the original invoice as Equipment, Parts, Service, or Rental before a later eligible run.',
          jsonb_build_object(
            'exception_subtype', 'ar_finance_charge_department',
            'workspace_id', p_workspace_id,
            'invoice_id', v_invoice.id,
            'invoice_type', v_invoice.invoice_type,
            'invoice_department_code', v_invoice.invoice_department_code,
            'cycle_date', p_cycle_date,
            'charge_cents', v_charge_cents
          ),
          'customer_invoices',
          v_invoice.id
        where not exists (
          select 1
          from public.exception_queue q
          where q.workspace_id = p_workspace_id
            and q.source = 'data_quality'
            and q.entity_table = 'customer_invoices'
            and q.entity_id = v_invoice.id
            and q.status in ('open', 'in_progress')
            and q.payload->>'exception_subtype' = 'ar_finance_charge_department'
        );
      elsif v_charge_cents > 0 and v_numbering_branch_id is not null then
        insert into public.ar_dunning_events (
          workspace_id, crm_company_id, invoice_id, statement_run_id,
          event_type, cycle_date, charge_period, days_past_due,
          principal_basis_cents, rate_pct, lawful_cap_rate_pct, charge_cents,
          compounded, finance_charge_policy_approval_id, message_stub, metadata
        )
        values (
          p_workspace_id,
          v_invoice.crm_company_id,
          v_invoice.id,
          v_statement_run_id,
          'finance_charge',
          p_cycle_date,
          v_charge_period,
          v_invoice.days_past_due,
          v_principal_basis_cents,
          v_monthly_rate,
          v_lawful_annual_cap / 12.0,
          v_charge_cents,
          v_compounding_active,
          case when v_compounding_active then v_policy.id else null end,
          'TODO: brand-voice',
          jsonb_build_object(
            'prior_finance_charge_balance_cents', v_prior_charge_balance_cents,
            'compounding_requested', v_settings.ar_finance_charge_compounding_enabled,
            'compounding_active', v_compounding_active
          )
        )
        on conflict do nothing
        returning id into v_charge_event_id;
      elsif v_charge_cents > 0 then
        insert into public.exception_queue (
          workspace_id, source, severity, title, detail, payload,
          entity_table, entity_id
        )
        select
          p_workspace_id,
          'data_quality',
          'warn',
          'Finance charge skipped: invoice branch does not resolve',
          'No finance-charge event or receivable was created. Correct the original invoice branch and rerun on a later eligible day.',
          jsonb_build_object(
            'exception_subtype', 'ar_finance_charge_numbering',
            'workspace_id', p_workspace_id,
            'invoice_id', v_invoice.id,
            'invoice_branch_id', v_invoice.branch_id,
            'cycle_date', p_cycle_date,
            'charge_cents', v_charge_cents
          ),
          'customer_invoices',
          v_invoice.id
        where not exists (
          select 1
          from public.exception_queue q
          where q.workspace_id = p_workspace_id
            and q.source = 'data_quality'
            and q.entity_table = 'customer_invoices'
            and q.entity_id = v_invoice.id
            and q.status in ('open', 'in_progress')
            and q.payload->>'exception_subtype' = 'ar_finance_charge_numbering'
        );
      end if;

      if v_charge_event_id is not null then
        v_generated_invoice_id := null;

        select pc.id into v_portal_customer_id
        from public.portal_customers pc
        where pc.workspace_id = p_workspace_id
          and pc.crm_company_id = v_invoice.crm_company_id
          and pc.is_active = true
        order by pc.created_at
        limit 1;

        if v_charge_cents > 0 then
          v_generated_invoice_number := public.qep_next_finance_invoice_number(
            p_workspace_id,
            v_numbering_branch_id,
            v_department_code,
            null
          );

          insert into public.customer_invoices (
            workspace_id, portal_customer_id, crm_company_id, invoice_number,
            invoice_date, due_date, description, amount, tax, total, status,
            invoice_type, invoice_source_code, invoice_department_code,
            qep_invoice_number, branch_id, deal_id
          )
          values (
            p_workspace_id,
            v_portal_customer_id,
            v_invoice.crm_company_id,
            v_generated_invoice_number,
            p_cycle_date,
            p_cycle_date,
            'TODO: brand-voice finance charge',
            v_charge_cents::numeric / 100.0,
            0,
            v_charge_cents::numeric / 100.0,
            'pending',
            'general',
            'FINANCE_CHARGE',
            v_department_code,
            v_generated_invoice_number,
            v_invoice.branch_id,
            v_invoice.deal_id
          )
          returning id into v_generated_invoice_id;

          v_finance_segment := 'customer';

          insert into public.customer_invoice_line_items (
            workspace_id, invoice_id, line_number, description, quantity,
            unit_price, finance_department, finance_segment, finance_category,
            finance_classification_source, finance_classified_at
          )
          values (
            p_workspace_id,
            v_generated_invoice_id,
            1,
            'TODO: brand-voice finance charge',
            1,
            v_charge_cents::numeric / 100.0,
            v_finance_department,
            v_finance_segment,
            'finance_charge',
            'original_invoice_department',
            now()
          );
        end if;

        update public.ar_dunning_events
        set
          generated_invoice_id = v_generated_invoice_id,
          metadata = metadata || jsonb_build_object(
            'receivable_status',
            case
              when v_generated_invoice_id is null then 'creation_failed'
              else 'created'
            end
          ),
          updated_at = now()
        where id = v_charge_event_id;

        v_charge_count := v_charge_count + 1;
      end if;
    end if;

    if v_invoice.days_past_due >= v_settings.ar_reminder_min_days
       and v_invoice.days_past_due < v_settings.ar_reminder_max_days then
      insert into public.ar_dunning_events (
        workspace_id, crm_company_id, invoice_id, statement_run_id,
        event_type, cycle_date, days_past_due, principal_basis_cents,
        message_stub
      )
      values (
        p_workspace_id,
        v_invoice.crm_company_id,
        v_invoice.id,
        v_statement_run_id,
        'reminder_email',
        p_cycle_date,
        v_invoice.days_past_due,
        round(v_invoice.balance_due * 100)::bigint,
        'TODO: brand-voice'
      )
      on conflict do nothing;
      get diagnostics v_rows = row_count;
      v_reminder_count := v_reminder_count + v_rows;
    end if;

    if v_invoice.days_past_due >= v_settings.ar_auto_hold_days then
      update public.qrm_companies c
      set
        credit_hold = true,
        credit_hold_reason = coalesce(
          c.credit_hold_reason,
          format('AR auto-hold at %s days past due', v_settings.ar_auto_hold_days)
        ),
        credit_hold_set_by = coalesce(c.credit_hold_set_by, (select auth.uid())),
        credit_hold_set_at = coalesce(c.credit_hold_set_at, now())
      where c.id = v_invoice.crm_company_id
        and c.workspace_id = p_workspace_id;

      insert into public.ar_dunning_events (
        workspace_id, crm_company_id, invoice_id, statement_run_id,
        event_type, cycle_date, days_past_due, principal_basis_cents,
        message_stub
      )
      values (
        p_workspace_id,
        v_invoice.crm_company_id,
        v_invoice.id,
        v_statement_run_id,
        'auto_hold',
        p_cycle_date,
        v_invoice.days_past_due,
        round(v_invoice.balance_due * 100)::bigint,
        'TODO: brand-voice'
      )
      on conflict do nothing;
      get diagnostics v_rows = row_count;
      v_hold_count := v_hold_count + v_rows;
    end if;
  end loop;

  update public.ar_dunning_invoice_cycle_claims claim
  set completed_at = now()
  where claim.statement_run_id = v_statement_run_id
    and claim.workspace_id = p_workspace_id
    and claim.cycle_date = p_cycle_date;

  select exists (
    select 1
    from public.customer_invoices ci
    join public.qrm_companies c
      on c.id = ci.crm_company_id
     and c.workspace_id = ci.workspace_id
    left join public.ar_dunning_invoice_cycle_claims prior_claim
      on prior_claim.workspace_id = ci.workspace_id
     and prior_claim.cycle_date = p_cycle_date
     and prior_claim.invoice_id = ci.id
    where ci.workspace_id = p_workspace_id
      and ci.crm_company_id is not null
      and ci.balance_due > 0
      and ci.status not in ('paid', 'void', 'reversed')
      and coalesce(c.assess_late_charges, true)
      and prior_claim.id is null
  ) into v_has_more;

  update public.ar_dunning_workspace_cursors cursor
  set last_run_at = now(),
      drained_cycle_date = case
        when v_has_more then null
        else p_cycle_date
      end,
      updated_at = now()
  where cursor.workspace_id = p_workspace_id;

  update public.ar_statement_runs
  set
    delivered_count = v_statement_count + v_charge_count + v_reminder_count + v_hold_count,
    completed_at = now()
  where id = v_statement_run_id;

  return jsonb_build_object(
    'ok', true,
    'statement_run_id', v_statement_run_id,
    'claimed_invoices', v_claimed_count,
    'batch_limit', v_batch_limit,
    'has_more', v_has_more,
    'drained_cycle_date', case when v_has_more then null else p_cycle_date end,
    'cursor_invoice_id', v_last_invoice_id,
    'charge_period', v_charge_period,
    'statement_events', v_statement_count,
    'finance_charge_events', v_charge_count,
    'reminder_events', v_reminder_count,
    'auto_hold_events', v_hold_count,
    'finance_charge_basis', case
      when v_compounding_active then 'principal_plus_unpaid_prior_charges'
      else 'principal_only'
    end,
    'compounding_requested', v_settings.ar_finance_charge_compounding_enabled,
    'compounding_active', v_compounding_active,
    'legal_policy_approval_id', case when v_compounding_active then v_policy.id else null end,
    'monthly_rate_applied', v_monthly_rate
  );
end;
$$;

comment on function public.run_ar_dunning_cycle(text, date) is
  'F9 bounded daily evaluator with deterministic SKIP LOCKED invoice claims and repeatable drain state. Monthly finance-charge reservation remains idempotent; compounding is impossible without active legal approval and an explicit workspace setting.';

revoke all on function public.run_ar_dunning_cycle(text, date)
  from public, anon, authenticated;
grant execute on function public.run_ar_dunning_cycle(text, date)
  to authenticated, service_role;

-- Override the earlier all-workspace wrapper with a one-workspace turn. Each
-- cron transaction therefore owns at most one 250-invoice batch. New
-- workspaces receive a first turn before resumptions; thereafter least-recent
-- turns rotate fairly until each cursor records today's drained date.
create or replace function public.run_ar_dunning_cycle_all()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace record;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_workspace_batch_limit constant integer := 1;
begin
  if (select auth.role()) is not null
     and (select auth.role()) <> 'service_role' then
    raise exception 'run_ar_dunning_cycle_all: service caller required';
  end if;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);

  for v_workspace in
    with active_workspaces as materialized (
      select settings.workspace_id
      from public.workspace_settings settings
      union
      select 'default'
    )
    select active.workspace_id
    from active_workspaces active
    left join public.ar_dunning_workspace_cursors cursor
      on cursor.workspace_id = active.workspace_id
    where cursor.drained_cycle_date is distinct from current_date
    order by
      case when cursor.workspace_id is null then 0 else 1 end,
      cursor.last_run_at nulls first,
      active.workspace_id
    limit v_workspace_batch_limit
  loop
    begin
      v_result := public.run_ar_dunning_cycle(
        v_workspace.workspace_id,
        current_date
      );
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'workspace_id', v_workspace.workspace_id,
        'result', v_result
      ));
    exception when others then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'workspace_id', v_workspace.workspace_id,
        'error', sqlerrm
      ));
    end;
  end loop;

  return v_results;
end;
$$;

revoke all on function public.run_ar_dunning_cycle_all() from public;
grant execute on function public.run_ar_dunning_cycle_all() to service_role;

do $cron$
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'Skipping run-ar-dunning-cycle drain schedule: pg_cron not available.';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'run-ar-dunning-cycle') then
    perform cron.unschedule('run-ar-dunning-cycle');
  end if;

  perform cron.schedule(
    'run-ar-dunning-cycle',
    '*/5 * * * *',
    $job$select public.run_ar_dunning_cycle_all()$job$
  );
exception
  when others then
    raise notice 'Skipping run-ar-dunning-cycle drain schedule: %', sqlerrm;
end;
$cron$;

-- ---------------------------------------------------------------------------
-- 3. Unified sale/rental deposit liability subledger.
-- ---------------------------------------------------------------------------

-- A Stripe webhook can commit the exception row and then lose the subsequent
-- portal-intent metadata update. Keep that retry from opening duplicate
-- critical work while the original exception remains actionable.
create unique index if not exists uq_exception_stripe_sale_deposit_reconciliation_open
  on public.exception_queue (
    workspace_id,
    entity_table,
    entity_id,
    ((payload ->> 'stripe_payment_intent_id'))
  )
  where source = 'data_quality'
    and payload ->> 'exception_subtype' = 'stripe_sale_deposit_reconciliation'
    and status in ('open', 'in_progress');

alter table public.deposits
  drop constraint if exists deposits_status_check;

alter table public.deposits
  add constraint deposits_status_check
  check (status in (
    'pending', 'requested', 'received', 'verified', 'partially_applied',
    'applied', 'refund_requested', 'refunded'
  )) not valid;

alter table public.deposits
  add column if not exists applied_amount numeric(14, 2);

comment on column public.deposits.applied_amount is
  'F11 amount of a sale deposit actually applied to final invoices. NULL on historical rows means application amount was not silently guessed; new partial/full applications persist exact value.';

create table if not exists public.customer_deposit_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  deposit_kind text not null check (deposit_kind in ('sale_deposit', 'rental_security')),
  source_type text not null check (source_type in ('sale_deposit', 'rental_contract', 'manual')),
  source_id uuid,
  entry_type text not null check (entry_type in (
    'receipt', 'apply_invoice', 'apply_damage', 'refund', 'forfeit',
    'adjustment_in', 'adjustment_out'
  )),
  amount_cents bigint not null check (amount_cents > 0),
  liability_delta_cents bigint generated always as (
    case
      when entry_type in ('receipt', 'adjustment_in') then amount_cents
      else -amount_cents
    end
  ) stored,
  liability_account_key text not null,
  customer_invoice_id uuid references public.customer_invoices(id) on delete restrict,
  rental_return_id uuid references public.rental_returns(id) on delete restrict,
  original_payment_method text,
  payment_reference text,
  idempotency_key text not null,
  entry_date date not null default current_date,
  memo text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  check (
    (source_type = 'manual' and source_id is null)
    or (source_type <> 'manual' and source_id is not null)
  )
);

comment on table public.customer_deposit_ledger_entries is
  'F11 append-only liability subledger spanning existing sale deposits and rental security deposits. A receipt raises liability; application, damage settlement, refund, or forfeit relieves it.';
comment on column public.customer_deposit_ledger_entries.liability_delta_cents is
  'Signed liability movement generated from entry_type; this is the single balance math and prevents direction drift.';

create index if not exists idx_customer_deposit_ledger_source
  on public.customer_deposit_ledger_entries(
    workspace_id, deposit_kind, source_type, source_id, entry_date
  );
create index if not exists idx_customer_deposit_ledger_account
  on public.customer_deposit_ledger_entries(
    workspace_id, liability_account_key, entry_date
  );
create index if not exists idx_customer_deposit_ledger_invoice
  on public.customer_deposit_ledger_entries(customer_invoice_id)
  where customer_invoice_id is not null;
create index if not exists idx_customer_deposit_ledger_rental_return
  on public.customer_deposit_ledger_entries(rental_return_id)
  where rental_return_id is not null;

alter table public.customer_deposit_ledger_entries enable row level security;

create policy "customer_deposit_ledger_service_all"
  on public.customer_deposit_ledger_entries for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');
create policy "customer_deposit_ledger_finance_read"
  on public.customer_deposit_ledger_entries for select
  using (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_read()
  );

-- The RPC below is the sole write boundary. Revoke inherited grants explicitly:
-- RLS does not protect TRUNCATE and a service-role INSERT could otherwise skip
-- idempotency, balance, source-identity, and refund-tender checks.
revoke insert, update, delete, truncate on table public.customer_deposit_ledger_entries
  from anon, authenticated, service_role;
grant select on table public.customer_deposit_ledger_entries
  to authenticated, service_role;

create or replace function public.customer_deposit_ledger_block_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'customer_deposit_ledger_entries is append-only';
end;
$$;

create trigger trg_customer_deposit_ledger_append_only
  before update or delete on public.customer_deposit_ledger_entries
  for each row execute function public.customer_deposit_ledger_block_mutation();

revoke all on function public.customer_deposit_ledger_block_mutation()
  from public, anon, authenticated, service_role;

create or replace function public.record_customer_deposit_ledger_entry(
  p_workspace_id text,
  p_deposit_kind text,
  p_source_type text,
  p_source_id uuid,
  p_entry_type text,
  p_amount_cents bigint,
  p_liability_account_key text,
  p_idempotency_key text,
  p_customer_invoice_id uuid default null,
  p_rental_return_id uuid default null,
  p_original_payment_method text default null,
  p_payment_reference text default null,
  p_entry_date date default current_date,
  p_memo text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.customer_deposit_ledger_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_workspace text;
  v_source_payment_method text;
  v_source_deal_id uuid;
  v_source_deal_workspace text;
  v_invoice_deal_id uuid;
  v_return_contract_id uuid;
  v_return_payment_method text;
  v_current_balance_cents bigint := 0;
  v_requested_delta_cents bigint;
  v_existing public.customer_deposit_ledger_entries;
  v_entry public.customer_deposit_ledger_entries;
  v_entry_date date := coalesce(p_entry_date, current_date);
  v_normalized_memo text := nullif(trim(coalesce(p_memo, '')), '');
  v_normalized_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if (select auth.role()) is distinct from 'service_role' then
    if p_workspace_id is distinct from public.get_my_workspace() then
      raise exception 'deposit ledger workspace does not match caller workspace';
    end if;
    if not public.qep_finance_can_mutate() then
      raise exception 'deposit ledger mutation requires finance/admin privileges';
    end if;
  end if;

  if p_deposit_kind not in ('sale_deposit', 'rental_security')
     or p_source_type not in ('sale_deposit', 'rental_contract', 'manual')
     or p_entry_type not in (
       'receipt', 'apply_invoice', 'apply_damage', 'refund', 'forfeit',
       'adjustment_in', 'adjustment_out'
     )
     or coalesce(p_amount_cents, 0) <= 0
     or nullif(trim(p_liability_account_key), '') is null
     or nullif(trim(p_idempotency_key), '') is null then
    raise exception 'invalid deposit ledger entry';
  end if;

  if p_entry_type = 'apply_invoice' and p_customer_invoice_id is null then
    raise exception 'invoice application requires a customer invoice';
  end if;

  if p_entry_type = 'apply_damage' and p_rental_return_id is null then
    raise exception 'damage application requires a rental return';
  end if;

  if p_entry_type = 'refund'
     and nullif(trim(p_original_payment_method), '') is null then
    raise exception 'refund requires the original payment method';
  end if;

  if p_source_type = 'rental_contract'
     and p_entry_type = 'refund'
     and p_rental_return_id is null then
    raise exception 'rental deposit refund requires its rental return';
  end if;

  -- Serialize both idempotency identity and balance math. The order is stable
  -- across callers, avoiding concurrent duplicate or over-application races.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'deposit-ledger-key:' || p_workspace_id || ':' || trim(p_idempotency_key),
      0
    )
  );
  perform pg_advisory_xact_lock(
    hashtextextended(
      'deposit-ledger-source:' || p_workspace_id || ':' || p_deposit_kind || ':' ||
      p_source_type || ':' || coalesce(p_source_id::text, 'manual') || ':' ||
      trim(p_liability_account_key),
      0
    )
  );

  select * into v_existing
  from public.customer_deposit_ledger_entries e
  where e.workspace_id = p_workspace_id
    and e.idempotency_key = trim(p_idempotency_key);

  if v_existing.id is not null then
    if v_existing.deposit_kind is distinct from p_deposit_kind
       or v_existing.source_type is distinct from p_source_type
       or v_existing.source_id is distinct from p_source_id
       or v_existing.entry_type is distinct from p_entry_type
       or v_existing.amount_cents is distinct from p_amount_cents
       or v_existing.liability_account_key is distinct from trim(p_liability_account_key)
       or v_existing.customer_invoice_id is distinct from p_customer_invoice_id
       or v_existing.rental_return_id is distinct from p_rental_return_id
       or v_existing.original_payment_method is distinct from p_original_payment_method
       or v_existing.payment_reference is distinct from p_payment_reference
       or v_existing.entry_date is distinct from v_entry_date
       or nullif(trim(coalesce(v_existing.memo, '')), '')
          is distinct from v_normalized_memo
       or v_existing.metadata is distinct from v_normalized_metadata then
      raise exception 'idempotency key already belongs to a different deposit entry';
    end if;
    return v_existing;
  end if;

  if p_source_type = 'sale_deposit' then
    select d.workspace_id, d.payment_method, d.deal_id, deal.workspace_id
      into v_source_workspace, v_source_payment_method, v_source_deal_id,
           v_source_deal_workspace
    from public.deposits d
    join public.crm_deals deal on deal.id = d.deal_id
    where d.id = p_source_id;
    if p_deposit_kind <> 'sale_deposit' then
      raise exception 'sale deposit source requires sale_deposit kind';
    end if;
    if v_source_deal_workspace is distinct from p_workspace_id then
      raise exception 'sale deposit deal is outside the requested workspace';
    end if;
  elsif p_source_type = 'rental_contract' then
    select c.workspace_id, ci.payment_method
      into v_source_workspace, v_source_payment_method
    from public.rental_contracts c
    left join public.customer_invoices ci
      on ci.id = c.deposit_invoice_id
     and ci.workspace_id = c.workspace_id
    where c.id = p_source_id and c.deleted_at is null;
    if p_deposit_kind <> 'rental_security' then
      raise exception 'rental contract source requires rental_security kind';
    end if;
  else
    v_source_workspace := p_workspace_id;
    if (select auth.role()) is distinct from 'service_role'
       and coalesce((select public.get_my_role())::text, '') not in ('owner', 'finance_admin') then
      raise exception 'manual deposit entries require owner or finance_admin';
    end if;
  end if;

  if v_source_workspace is null or v_source_workspace is distinct from p_workspace_id then
    raise exception 'deposit source is missing or outside the requested workspace';
  end if;

  if p_customer_invoice_id is not null then
    select ci.deal_id into v_invoice_deal_id
    from public.customer_invoices ci
    where ci.id = p_customer_invoice_id
      and ci.workspace_id = p_workspace_id;

    if not found then
      raise exception 'customer invoice is outside the deposit workspace';
    end if;

    if p_source_type = 'sale_deposit'
       and v_invoice_deal_id is distinct from v_source_deal_id then
      raise exception 'sale deposit and customer invoice must belong to the same deal';
    end if;

    if v_invoice_deal_id is not null and not exists (
      select 1
      from public.crm_deals deal
      where deal.id = v_invoice_deal_id
        and deal.workspace_id = p_workspace_id
        and deal.deleted_at is null
    ) then
      raise exception 'customer invoice deal is outside the deposit workspace';
    end if;

    if p_source_type = 'rental_contract' and not exists (
      select 1
      from public.rental_invoices ri
      where ri.workspace_id = p_workspace_id
        and ri.rental_contract_id = p_source_id
        and ri.customer_invoice_id = p_customer_invoice_id
        and ri.deleted_at is null
    ) then
      raise exception 'rental deposit invoice application must belong to the source contract';
    end if;
  end if;

  if p_rental_return_id is not null then
    select rr.rental_contract_id, rr.original_payment_method
      into v_return_contract_id, v_return_payment_method
    from public.rental_returns rr
    where rr.id = p_rental_return_id
      and rr.workspace_id = p_workspace_id
      and rr.deleted_at is null;

    if not found then
      raise exception 'rental return is outside the deposit workspace';
    end if;

    if p_source_type <> 'rental_contract'
       or v_return_contract_id is distinct from p_source_id then
      raise exception 'rental return must belong to the source contract';
    end if;
  end if;

  if p_entry_type = 'refund' then
    v_source_payment_method := coalesce(v_source_payment_method, v_return_payment_method);
    if v_source_payment_method is null then
      raise exception 'refund is blocked until original tender evidence is present';
    end if;
    if lower(trim(p_original_payment_method)) is distinct from lower(trim(v_source_payment_method)) then
      raise exception 'deposit refund must use the original payment method';
    end if;
  end if;

  v_requested_delta_cents := case
    when p_entry_type in ('receipt', 'adjustment_in') then p_amount_cents
    else -p_amount_cents
  end;

  select coalesce(sum(e.liability_delta_cents), 0)::bigint
    into v_current_balance_cents
  from public.customer_deposit_ledger_entries e
  where e.workspace_id = p_workspace_id
    and e.deposit_kind = p_deposit_kind
    and e.source_type = p_source_type
    and e.source_id is not distinct from p_source_id
    and e.liability_account_key = trim(p_liability_account_key);

  if v_current_balance_cents + v_requested_delta_cents < 0 then
    raise exception 'deposit liability cannot become negative';
  end if;

  insert into public.customer_deposit_ledger_entries (
    workspace_id, deposit_kind, source_type, source_id, entry_type,
    amount_cents, liability_account_key, customer_invoice_id,
    rental_return_id, original_payment_method, payment_reference,
    idempotency_key, entry_date, memo, metadata
  )
  values (
    p_workspace_id, p_deposit_kind, p_source_type, p_source_id, p_entry_type,
    p_amount_cents, trim(p_liability_account_key), p_customer_invoice_id,
    p_rental_return_id, p_original_payment_method, p_payment_reference,
    trim(p_idempotency_key), v_entry_date, v_normalized_memo,
    v_normalized_metadata
  )
  returning * into v_entry;

  return v_entry;
end;
$$;

revoke all on function public.record_customer_deposit_ledger_entry(
  text, text, text, uuid, text, bigint, text, text,
  uuid, uuid, text, text, date, text, jsonb
) from public, anon, authenticated;
grant execute on function public.record_customer_deposit_ledger_entry(
  text, text, text, uuid, text, bigint, text, text,
  uuid, uuid, text, text, date, text, jsonb
) to service_role;

-- Atomic Stripe/manual sale-deposit receipt boundary: source status, deal
-- status, and the liability receipt commit together.
create or replace function public.record_sale_deposit_receipt(
  p_workspace_id text,
  p_deposit_id uuid,
  p_amount_cents bigint,
  p_payment_method text,
  p_payment_reference text,
  p_received_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deposit public.deposits;
  v_required_cents bigint;
  v_existing_receipt public.customer_deposit_ledger_entries;
  v_entry public.customer_deposit_ledger_entries;
begin
  if (select auth.role()) is distinct from 'service_role' then
    if p_workspace_id is distinct from public.get_my_workspace()
       or not public.qep_finance_can_mutate() then
      raise exception 'sale deposit receipt requires finance access in the caller workspace';
    end if;
  end if;

  select d.* into v_deposit
  from public.deposits d
  where d.id = p_deposit_id
    and d.workspace_id = p_workspace_id
  for update;

  if v_deposit.id is null then
    raise exception 'sale deposit not found';
  end if;
  if not exists (
    select 1
    from public.crm_deals deal
    where deal.id = v_deposit.deal_id
      and deal.workspace_id = p_workspace_id
      and deal.deleted_at is null
  ) then
    raise exception 'sale deposit deal is outside the requested workspace';
  end if;

  v_required_cents := round(v_deposit.required_amount * 100)::bigint;
  if nullif(trim(p_payment_method), '') is null
     or nullif(trim(p_payment_reference), '') is null
     or p_received_at is null
     or nullif(trim(p_idempotency_key), '') is null then
    raise exception 'sale deposit receipt requires method, reference, timestamp, and idempotency key';
  end if;

  select e.* into v_existing_receipt
  from public.customer_deposit_ledger_entries e
  where e.workspace_id = p_workspace_id
    and e.deposit_kind = 'sale_deposit'
    and e.source_type = 'sale_deposit'
    and e.source_id = p_deposit_id
    and e.entry_type = 'receipt'
  order by e.created_at, e.id
  limit 1;

  if v_existing_receipt.id is not null then
    if v_existing_receipt.amount_cents is distinct from p_amount_cents
       or lower(trim(coalesce(v_existing_receipt.original_payment_method, '')))
          is distinct from lower(trim(p_payment_method))
       or trim(coalesce(v_existing_receipt.payment_reference, ''))
          is distinct from trim(p_payment_reference)
       or v_existing_receipt.idempotency_key
          is distinct from trim(p_idempotency_key)
       or (v_existing_receipt.metadata ->> 'received_at')::timestamptz
          is distinct from p_received_at
       or v_deposit.received_at is distinct from p_received_at then
      raise exception 'sale deposit receipt already exists with different payment evidence';
    end if;

    return jsonb_build_object(
      'ok', true,
      'deposit_id', p_deposit_id,
      'ledger_entry_id', v_existing_receipt.id,
      'amount_cents', v_existing_receipt.amount_cents,
      'idempotent_replay', true
    );
  end if;

  if coalesce(p_amount_cents, 0) is distinct from v_required_cents then
    raise exception 'sale deposit receipt must equal the required amount';
  end if;
  if v_deposit.status not in ('pending', 'requested', 'received', 'verified') then
    raise exception 'sale deposit status % cannot receive money', v_deposit.status;
  end if;

  v_entry := public.record_customer_deposit_ledger_entry(
    p_workspace_id,
    'sale_deposit',
    'sale_deposit',
    p_deposit_id,
    'receipt',
    p_amount_cents,
    'customer_deposits_payable',
    p_idempotency_key,
    null,
    null,
    p_payment_method,
    p_payment_reference,
    p_received_at::date,
    'Sale deposit receipt',
    jsonb_build_object(
      'source', 'record_sale_deposit_receipt',
      'received_at', p_received_at
    )
  );

  update public.deposits d
  set
    status = 'verified',
    payment_method = p_payment_method,
    received_at = coalesce(d.received_at, p_received_at),
    verified_at = coalesce(d.verified_at, p_received_at),
    invoice_reference = p_payment_reference,
    updated_at = now()
  where d.id = p_deposit_id;

  update public.crm_deals deal
  set
    deposit_status = 'verified',
    deposit_amount = v_deposit.required_amount,
    updated_at = now()
  where deal.id = v_deposit.deal_id
    and deal.workspace_id = p_workspace_id;

  return jsonb_build_object(
    'ok', true,
    'deposit_id', p_deposit_id,
    'ledger_entry_id', v_entry.id,
    'amount_cents', p_amount_cents
  );
end;
$$;

revoke all on function public.record_sale_deposit_receipt(
  text, uuid, bigint, text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.record_sale_deposit_receipt(
  text, uuid, bigint, text, text, timestamptz, text
) to authenticated, service_role;

-- Atomic sale-deposit application boundary used by equipment invoicing. Every
-- deposit is locked, bound to the invoice's deal, liability-backed, posted,
-- and source-marked in one transaction.
create or replace function public.apply_sale_deposits_to_invoice(
  p_workspace_id text,
  p_customer_invoice_id uuid,
  p_deposit_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.customer_invoices;
  v_deposit public.deposits;
  v_required_cents bigint;
  v_liability_cents bigint;
  v_remaining_liability_cents bigint;
  v_application_cents bigint;
  v_invoice_total_cents bigint;
  v_invoice_paid_cents bigint;
  v_remaining_invoice_cents bigint;
  v_final_paid_cents bigint;
  v_invoice_status text;
  v_application_recorded boolean;
  v_processed_count integer := 0;
  v_applied_count integer := 0;
  v_newly_applied_total_cents bigint := 0;
begin
  if (select auth.role()) is distinct from 'service_role' then
    if p_workspace_id is distinct from public.get_my_workspace()
       or not public.qep_finance_can_mutate() then
      raise exception 'sale deposit application requires finance access in the caller workspace';
    end if;
  end if;

  select * into v_invoice
  from public.customer_invoices ci
  where ci.id = p_customer_invoice_id
    and ci.workspace_id = p_workspace_id
  for update;

  if v_invoice.id is null or v_invoice.deal_id is null then
    raise exception 'sale deposit application requires a deal-linked customer invoice';
  end if;
  if v_invoice.invoice_type is distinct from 'equipment'
     or v_invoice.reversal_of_invoice_id is not null
     or v_invoice.status in ('void', 'reversed')
     or coalesce(v_invoice.total, 0) <= 0 then
    raise exception 'sale deposits may apply only to an active original equipment invoice';
  end if;
  if coalesce(cardinality(p_deposit_ids), 0) = 0
     or exists (select 1 from unnest(p_deposit_ids) as requested(id) where id is null)
     or exists (
       select 1
       from unnest(p_deposit_ids) as requested(id)
       group by id
       having count(*) > 1
     ) then
    raise exception 'sale deposit application requires one or more unique non-null deposit ids';
  end if;

  v_invoice_total_cents := greatest(round(coalesce(v_invoice.total, 0) * 100)::bigint, 0);
  v_invoice_paid_cents := least(
    greatest(round(coalesce(v_invoice.amount_paid, 0) * 100)::bigint, 0),
    v_invoice_total_cents
  );
  v_remaining_invoice_cents := greatest(v_invoice_total_cents - v_invoice_paid_cents, 0);

  for v_deposit in
    select d.*
    from public.deposits d
    where d.workspace_id = p_workspace_id
      and d.id = any(coalesce(p_deposit_ids, '{}'::uuid[]))
    order by d.id
    for update
  loop
    if v_deposit.deal_id is distinct from v_invoice.deal_id then
      raise exception 'sale deposit % belongs to a different deal', v_deposit.id;
    end if;
    if v_deposit.status not in ('received', 'verified', 'partially_applied', 'applied') then
      raise exception 'sale deposit % is not received or verified', v_deposit.id;
    end if;

    if not exists (
      select 1
      from public.crm_deals deal
      where deal.id = v_deposit.deal_id
        and deal.workspace_id = p_workspace_id
        and deal.deleted_at is null
    ) then
      raise exception 'sale deposit deal is outside the invoice workspace';
    end if;

    v_processed_count := v_processed_count + 1;

    v_required_cents := round(v_deposit.required_amount * 100)::bigint;

    if not exists (
      select 1
      from public.customer_deposit_ledger_entries e
      where e.workspace_id = p_workspace_id
        and e.source_type = 'sale_deposit'
        and e.source_id = v_deposit.id
        and e.entry_type = 'receipt'
    ) then
      raise exception 'sale deposit % has no audited liability receipt; record payment evidence before invoice application',
        v_deposit.id;
    end if;

    select coalesce(sum(e.liability_delta_cents), 0)::bigint
      into v_liability_cents
    from public.customer_deposit_ledger_entries e
    where e.workspace_id = p_workspace_id
      and e.deposit_kind = 'sale_deposit'
      and e.source_type = 'sale_deposit'
      and e.source_id = v_deposit.id
      and e.liability_account_key = 'customer_deposits_payable';

    v_application_cents := least(
      greatest(v_liability_cents, 0),
      v_required_cents,
      v_remaining_invoice_cents
    );
    v_application_recorded := false;

    if v_application_cents > 0 then
      if not exists (
        select 1
        from public.customer_deposit_ledger_entries e
        where e.workspace_id = p_workspace_id
          and e.idempotency_key =
            'sale-deposit-apply:' || v_deposit.id::text || ':' || p_customer_invoice_id::text
      ) then
        perform public.record_customer_deposit_ledger_entry(
          p_workspace_id,
          'sale_deposit',
          'sale_deposit',
          v_deposit.id,
          'apply_invoice',
          v_application_cents,
          'customer_deposits_payable',
          'sale-deposit-apply:' || v_deposit.id::text || ':' || p_customer_invoice_id::text,
          p_customer_invoice_id,
          null,
          v_deposit.payment_method,
          v_deposit.invoice_reference,
          v_invoice.invoice_date,
          'Applied to final equipment invoice',
          jsonb_build_object('deal_id', v_invoice.deal_id)
        );

        v_applied_count := v_applied_count + 1;
        v_application_recorded := true;
        v_newly_applied_total_cents :=
          v_newly_applied_total_cents + v_application_cents;
        v_remaining_invoice_cents :=
          greatest(v_remaining_invoice_cents - v_application_cents, 0);
      end if;

      select coalesce(sum(e.liability_delta_cents), 0)::bigint
        into v_remaining_liability_cents
      from public.customer_deposit_ledger_entries e
      where e.workspace_id = p_workspace_id
        and e.deposit_kind = 'sale_deposit'
        and e.source_type = 'sale_deposit'
        and e.source_id = v_deposit.id
        and e.liability_account_key = 'customer_deposits_payable';

      update public.deposits d
      set
        status = case
          when v_remaining_liability_cents <= 0 then 'applied'
          else 'partially_applied'
        end,
        applied_amount = least(
          d.required_amount,
          coalesce(d.applied_amount, 0) +
            (case when v_application_recorded then v_application_cents / 100.0 else 0 end)
        ),
        applied_to_final_invoice = true,
        invoice_reference = v_invoice.invoice_number,
        updated_at = now()
      where d.id = v_deposit.id;
    end if;
  end loop;

  if v_processed_count <> coalesce(cardinality(p_deposit_ids), 0) then
    raise exception 'one or more requested sale deposits were not found in the invoice workspace';
  end if;

  v_final_paid_cents := least(
    v_invoice_total_cents,
    v_invoice_paid_cents + v_newly_applied_total_cents
  );

  update public.customer_invoices ci
  set
    amount_paid = v_final_paid_cents / 100.0,
    status = case
      when v_invoice_total_cents > 0 and v_final_paid_cents >= v_invoice_total_cents then 'paid'
      when v_final_paid_cents > 0 then 'partial'
      else 'pending'
    end,
    updated_at = now()
  where ci.id = p_customer_invoice_id
    and ci.workspace_id = p_workspace_id
  returning ci.status into v_invoice_status;

  return jsonb_build_object(
    'ok', true,
    'invoice_id', p_customer_invoice_id,
    'applied_count', v_applied_count,
    'newly_applied_total_cents', v_newly_applied_total_cents,
    'invoice_amount_paid_cents', v_final_paid_cents,
    'invoice_status', v_invoice_status
  );
end;
$$;

revoke all on function public.apply_sale_deposits_to_invoice(text, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.apply_sale_deposits_to_invoice(text, uuid, uuid[])
  to authenticated, service_role;

-- Rental final-invoice mirroring is already one database transaction. This
-- trigger joins that transaction so the receipt, application, and contract
-- deposit state cannot diverge from the canonical rental/customer invoice link.
create or replace function public.sync_rental_deposit_liability_on_mirror()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract public.rental_contracts;
  v_deposit_invoice public.customer_invoices;
  v_return record;
  v_deposit_cents bigint;
  v_applied_cents bigint;
  v_damage_to_apply_cents bigint;
  v_damage_remaining_cents bigint;
  v_damage_entry_cents bigint;
  v_damage_applied_cents bigint := 0;
  v_invoice_applied_cents bigint;
begin
  if new.customer_invoice_id is null
     or coalesce(new.metadata->>'kind', '') <> 'final' then
    return new;
  end if;

  select * into v_contract
  from public.rental_contracts c
  where c.id = new.rental_contract_id
    and c.workspace_id = new.workspace_id
    and c.deleted_at is null
  for update;

  if v_contract.id is null
     or coalesce(v_contract.deposit_amount, 0) <= 0
     or v_contract.deposit_status is distinct from 'paid' then
    return new;
  end if;

  v_deposit_cents := round(v_contract.deposit_amount * 100)::bigint;

  select * into v_deposit_invoice
  from public.customer_invoices ci
  where ci.id = v_contract.deposit_invoice_id
    and ci.workspace_id = new.workspace_id;

  if v_deposit_invoice.id is null
     or v_deposit_invoice.status is distinct from 'paid'
     or round(coalesce(v_deposit_invoice.amount_paid, 0) * 100)::bigint < v_deposit_cents
     or (
       v_contract.portal_customer_id is not null
       and v_deposit_invoice.portal_customer_id is distinct from v_contract.portal_customer_id
     )
     or (
       v_contract.qrm_company_id is not null
       and v_deposit_invoice.crm_company_id is distinct from v_contract.qrm_company_id
     )
     or lower(trim(coalesce(v_deposit_invoice.description, ''))) <> 'rental deposit' then
    raise exception 'paid rental deposit lacks a fully paid same-workspace deposit invoice';
  end if;

  v_applied_cents := least(greatest(coalesce(new.amount_paid_cents, 0), 0), v_deposit_cents);

  if not exists (
    select 1
    from public.customer_deposit_ledger_entries e
    where e.workspace_id = new.workspace_id
      and e.source_type = 'rental_contract'
      and e.source_id = v_contract.id
      and e.entry_type = 'receipt'
  ) then
    perform public.record_customer_deposit_ledger_entry(
      new.workspace_id,
      'rental_security',
      'rental_contract',
      v_contract.id,
      'receipt',
      v_deposit_cents,
      'rental_security_deposits_payable',
      'rental-deposit-receipt:' || v_contract.id::text || ':' || coalesce(v_contract.deposit_invoice_id::text, 'legacy'),
      null,
      null,
      v_deposit_invoice.payment_method,
      v_deposit_invoice.payment_reference,
      coalesce(v_deposit_invoice.paid_at, v_contract.on_rent_at, now())::date,
      'Rental security deposit receipt synchronized at final invoice mirror',
      jsonb_build_object('rental_invoice_id', new.id)
    );
  end if;

  v_damage_to_apply_cents := least(
    v_applied_cents,
    greatest(coalesce(new.damage_charge_cents, 0), 0)
  );
  v_damage_remaining_cents := v_damage_to_apply_cents;

  if v_damage_remaining_cents > 0 then
    for v_return in
      select
        rr.id,
        greatest(coalesce(rr.damage_charge_cents, 0), 0)::bigint as damage_charge_cents
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(new.metadata->'source_return_ids') = 'array'
          then new.metadata->'source_return_ids'
          else '[]'::jsonb
        end
      ) source(return_id)
      join public.rental_returns rr
        on rr.id = source.return_id::uuid
       and rr.workspace_id = new.workspace_id
       and rr.rental_contract_id = v_contract.id
       and rr.deleted_at is null
      where coalesce(rr.damage_charge_cents, 0) > 0
      order by rr.created_at, rr.id
    loop
      exit when v_damage_remaining_cents <= 0;
      v_damage_entry_cents := least(
        v_damage_remaining_cents,
        v_return.damage_charge_cents
      );

      perform public.record_customer_deposit_ledger_entry(
        new.workspace_id,
        'rental_security',
        'rental_contract',
        v_contract.id,
        'apply_damage',
        v_damage_entry_cents,
        'rental_security_deposits_payable',
        'rental-deposit-damage:' || v_contract.id::text || ':' ||
          new.id::text || ':' || v_return.id::text,
        new.customer_invoice_id,
        v_return.id,
        v_deposit_invoice.payment_method,
        v_deposit_invoice.payment_reference,
        new.period_end,
        'Rental security deposit applied to renter damage before other charges',
        jsonb_build_object('rental_invoice_id', new.id)
      );

      v_damage_applied_cents := v_damage_applied_cents + v_damage_entry_cents;
      v_damage_remaining_cents := v_damage_remaining_cents - v_damage_entry_cents;
    end loop;

    if v_damage_remaining_cents > 0 then
      raise exception 'rental deposit damage application lacks complete source-return evidence';
    end if;
  end if;

  v_invoice_applied_cents := greatest(v_applied_cents - v_damage_applied_cents, 0);
  if v_invoice_applied_cents > 0 then
    perform public.record_customer_deposit_ledger_entry(
      new.workspace_id,
      'rental_security',
      'rental_contract',
      v_contract.id,
      'apply_invoice',
      v_invoice_applied_cents,
      'rental_security_deposits_payable',
      'rental-deposit-apply:' || v_contract.id::text || ':' || new.id::text,
      new.customer_invoice_id,
      null,
      v_deposit_invoice.payment_method,
      v_deposit_invoice.payment_reference,
      new.period_end,
      'Rental security deposit applied to non-damage final-invoice charges after damage',
      jsonb_build_object(
        'rental_invoice_id', new.id,
        'damage_applied_cents', v_damage_applied_cents
      )
    );
  end if;

  if v_deposit_cents - v_applied_cents > 0
     and v_contract.deposit_status is distinct from 'refund_due' then
    insert into public.exception_queue (
      workspace_id, source, severity, title, detail, payload,
      entity_table, entity_id
    ) values (
      new.workspace_id,
      'data_quality',
      'info',
      'Rental deposit refund due',
      format(
        'Final invoice applied %s cents; refund %s cents through the original tender.',
        v_applied_cents,
        v_deposit_cents - v_applied_cents
      ),
      jsonb_build_object(
        'exception_subtype', 'rental_deposit_refund',
        'workspace_id', new.workspace_id,
        'rental_contract_id', v_contract.id,
        'rental_invoice_id', new.id,
        'deposit_cents', v_deposit_cents,
        'applied_cents', v_applied_cents,
        'refund_due_cents', v_deposit_cents - v_applied_cents,
        'original_payment_method', v_deposit_invoice.payment_method
      ),
      'rental_contracts',
      v_contract.id
    );
  end if;

  update public.rental_contracts c
  set
    deposit_status = case
      when v_deposit_cents - v_applied_cents > 0 then 'refund_due'
      else 'applied'
    end,
    updated_at = now()
  where c.id = v_contract.id;

  return new;
end;
$$;

create trigger trg_rental_deposit_liability_on_mirror
  after insert or update of customer_invoice_id, amount_paid_cents, metadata
  on public.rental_invoices
  for each row execute function public.sync_rental_deposit_liability_on_mirror();

revoke all on function public.sync_rental_deposit_liability_on_mirror()
  from public, anon, authenticated, service_role;

create or replace view public.customer_deposit_liability_balances
with (security_invoker = true) as
select
  e.workspace_id,
  e.deposit_kind,
  e.source_type,
  e.source_id,
  e.liability_account_key,
  sum(e.liability_delta_cents)::bigint as liability_balance_cents,
  min(e.entry_date) as first_entry_date,
  max(e.entry_date) as last_entry_date,
  count(*)::bigint as entry_count
from public.customer_deposit_ledger_entries e
group by
  e.workspace_id, e.deposit_kind, e.source_type, e.source_id,
  e.liability_account_key;

create or replace view public.customer_deposit_liability_reconciliation
with (security_invoker = true) as
with sources as (
  select
    d.workspace_id,
    'sale_deposit'::text as deposit_kind,
    'sale_deposit'::text as source_type,
    d.id as source_id,
    d.status as source_status,
    'customer_deposits_payable'::text as expected_liability_account_key,
    round(d.required_amount * 100)::bigint as source_amount_cents,
    case
      when d.status in ('received', 'verified', 'refund_requested')
      then round(d.required_amount * 100)::bigint
      when d.status = 'partially_applied' and d.applied_amount is not null
      then greatest(
        round((d.required_amount - d.applied_amount) * 100)::bigint,
        0::bigint
      )
      when d.status in ('pending', 'requested') then 0::bigint
      when d.status in ('applied', 'refunded') then 0::bigint
      else null::bigint
    end as expected_liability_cents
  from public.deposits d

  union all

  select
    c.workspace_id,
    'rental_security'::text,
    'rental_contract'::text,
    c.id,
    case
      when c.deposit_status is null and c.deposit_required then 'unknown_required'
      else coalesce(c.deposit_status, 'not_required')
    end,
    'rental_security_deposits_payable'::text,
    round(coalesce(c.deposit_amount, 0) * 100)::bigint,
    case
      when c.deposit_status = 'paid' then round(coalesce(c.deposit_amount, 0) * 100)::bigint
      when c.deposit_status in ('applied', 'refunded', 'not_required', 'pending', 'failed') then 0::bigint
      when c.deposit_status is null and not c.deposit_required then 0::bigint
      else null::bigint
    end
  from public.rental_contracts c
  where c.deleted_at is null
), ledger as (
  select
    b.workspace_id,
    b.deposit_kind,
    b.source_type,
    b.source_id,
    sum(b.liability_balance_cents)::bigint as ledger_liability_cents,
    sum(b.entry_count)::bigint as entry_count,
    array_agg(distinct b.liability_account_key order by b.liability_account_key) as liability_account_keys,
    bool_or(
      b.liability_account_key <> case b.deposit_kind
        when 'sale_deposit' then 'customer_deposits_payable'
        when 'rental_security' then 'rental_security_deposits_payable'
      end
    ) as has_wrong_account
  from public.customer_deposit_liability_balances b
  group by b.workspace_id, b.deposit_kind, b.source_type, b.source_id
)
select
  coalesce(s.workspace_id, l.workspace_id) as workspace_id,
  coalesce(s.deposit_kind, l.deposit_kind) as deposit_kind,
  coalesce(s.source_type, l.source_type) as source_type,
  coalesce(s.source_id, l.source_id) as source_id,
  coalesce(
    s.source_status,
    case when l.source_type = 'manual' then 'manual_ledger' else 'ledger_only' end
  ) as source_status,
  s.expected_liability_account_key,
  coalesce(l.liability_account_keys, '{}'::text[]) as liability_account_keys,
  s.source_amount_cents,
  s.expected_liability_cents,
  coalesce(l.ledger_liability_cents, 0)::bigint as ledger_liability_cents,
  coalesce(l.entry_count, 0)::bigint as entry_count,
  case
    when s.source_id is null and l.source_type = 'manual' then 'manual_ledger_review'
    when s.source_id is null then 'orphan_ledger'
    when s.source_status in ('pending', 'requested')
      and coalesce(l.entry_count, 0) = 0 then 'not_received'
    when s.source_status = 'not_required'
      and coalesce(l.entry_count, 0) = 0 then 'not_required'
    when coalesce(l.has_wrong_account, false) then 'wrong_liability_account'
    when s.expected_liability_cents is null then 'review_required'
    when coalesce(l.entry_count, 0) = 0 then 'unledgered_source'
    when s.expected_liability_cents = coalesce(l.ledger_liability_cents, 0) then 'reconciled'
    else 'mismatch'
  end as reconciliation_status
from sources s
full outer join ledger l
  on l.workspace_id = s.workspace_id
 and l.deposit_kind = s.deposit_kind
 and l.source_type = s.source_type
 and l.source_id is not distinct from s.source_id;

comment on view public.customer_deposit_liability_reconciliation is
  'F11 monthly reconciliation queue across existing sale/rental source state and the append-only liability ledger. No historical money is guessed or silently backfilled.';

grant select on public.customer_deposit_liability_balances
  to authenticated, service_role;
grant select on public.customer_deposit_liability_reconciliation
  to authenticated, service_role;

update public.qep_roadmap_tasks
set
  evidence_link = concat_ws(' | ', nullif(evidence_link, ''), 'supabase/migrations/828_ar_monthly_charge_and_deposit_liability_ledger.sql'),
  notes = coalesce(notes, '') || E'\n[2026-07-20] F9/F11: daily evaluator now reserves one finance charge per original invoice/month before creating a receivable; compounding is legal-evidence gated. Sale/rental deposits share an append-only liability ledger and monthly reconciliation queue.',
  updated_at = now()
where task_id in ('M0.1', 'M6.1');

commit;

-- Rollback / fix-forward notes:
--   First revoke execute on finance-charge and deposit-liability mutation RPCs
--   and stop their scheduled/caller paths. Retain every receivable, exception,
--   receipt, and append-only liability entry. Correct balances with explicit
--   reversing entries; never delete or rewrite cash/deposit audit evidence.
