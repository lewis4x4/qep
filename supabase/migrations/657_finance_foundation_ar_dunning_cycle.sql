-- 657_finance_foundation_ar_dunning_cycle.sql
--
-- Finance foundation Part 3: finance charge and dunning cycle.
--
-- Rollback notes:
--   drop function if exists public.run_ar_dunning_cycle(text, date);
--   drop trigger if exists set_ar_dunning_events_updated_at on public.ar_dunning_events;
--   drop table if exists public.ar_dunning_events;
--   alter table public.customer_invoices drop constraint if exists customer_invoices_source_code_chk;
--   alter table public.customer_invoices add constraint customer_invoices_source_code_chk
--     check (invoice_source_code is null or invoice_source_code in ('EQUIPMENT','PARTS','RENTAL','SERVICE','GENERAL')) not valid;
--   alter table public.workspace_settings drop column if exists ar_finance_charge_compounding_enabled;
--   alter table public.workspace_settings drop column if exists ar_finance_charge_principal_only;
--   alter table public.workspace_settings drop column if exists ar_auto_hold_days;
--   alter table public.workspace_settings drop column if exists ar_reminder_max_days;
--   alter table public.workspace_settings drop column if exists ar_reminder_min_days;
--   alter table public.workspace_settings drop column if exists ar_finance_charge_days_past_due;
--   alter table public.workspace_settings drop column if exists ar_finance_charge_rate_pct;
--   alter table public.workspace_settings drop column if exists ar_statement_day_of_month;

alter table public.workspace_settings
  add column if not exists ar_statement_day_of_month integer not null default 1,
  add column if not exists ar_finance_charge_rate_pct numeric(8, 6) not null default 0.015,
  add column if not exists ar_finance_charge_days_past_due integer not null default 30,
  add column if not exists ar_reminder_min_days integer not null default 30,
  add column if not exists ar_reminder_max_days integer not null default 60,
  add column if not exists ar_auto_hold_days integer not null default 60,
  add column if not exists ar_finance_charge_principal_only boolean not null default true,
  add column if not exists ar_finance_charge_compounding_enabled boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workspace_settings_ar_statement_day_chk') then
    alter table public.workspace_settings
      add constraint workspace_settings_ar_statement_day_chk
      check (ar_statement_day_of_month between 1 and 28);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'workspace_settings_ar_finance_charge_rate_chk') then
    alter table public.workspace_settings
      add constraint workspace_settings_ar_finance_charge_rate_chk
      check (ar_finance_charge_rate_pct >= 0 and ar_finance_charge_rate_pct <= 1);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'workspace_settings_ar_dunning_days_chk') then
    alter table public.workspace_settings
      add constraint workspace_settings_ar_dunning_days_chk
      check (
        ar_finance_charge_days_past_due >= 0
        and ar_reminder_min_days >= ar_finance_charge_days_past_due
        and ar_reminder_max_days >= ar_reminder_min_days
        and ar_auto_hold_days >= ar_reminder_min_days
      );
  end if;
end $$;

comment on column public.workspace_settings.ar_statement_day_of_month is
  'AR dunning cycle statement day. QEP default: 1st of month.';
comment on column public.workspace_settings.ar_finance_charge_rate_pct is
  'Monthly finance charge rate. QEP default: 1.5%; runner caps this by configured Florida lawful annual maximum divided by 12.';
comment on column public.workspace_settings.ar_finance_charge_principal_only is
  'Finance-charge basis flag. Safe default true: charge only original principal/open invoice balance, excluding prior finance-charge receivables.';
comment on column public.workspace_settings.ar_finance_charge_compounding_enabled is
  'Alternative compounding flag. Safe default false; do not enable without owner/legal authorization.';

insert into public.finance_foundation_config (
  workspace_id,
  config_key,
  config_value,
  safe_default,
  authorizing_question,
  note
)
values
  (
    'default',
    'finance_charge_basis',
    '{"basis": "principal_only", "compounding_enabled": false}'::jsonb,
    '{"basis": "principal_only", "compounding_enabled": false}'::jsonb,
    'Round 3 open item: finance-charge basis',
    'Safe default is principal-only. Compounding is modeled but disabled.'
  ),
  (
    'default',
    'florida_finance_charge_lawful_cap',
    '{"annual_rate": 0.18, "source": "Florida Statutes Chapter 687 general usury cap; verify before live billing"}'::jsonb,
    '{"annual_rate": 0.18, "source": "Florida Statutes Chapter 687 general usury cap; verify before live billing"}'::jsonb,
    'Finance charge lawful maximum cap',
    'Applies a conservative 18% annual cap for automated AR finance charges; legal review required before customer-facing billing.'
  )
on conflict do nothing;

drop policy if exists "ar_statement_runs_all_elevated" on public.ar_statement_runs;
create policy "ar_statement_runs_all_elevated"
  on public.ar_statement_runs for all
  using (
    coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'finance_admin')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'finance_admin')
    and workspace_id = (select public.get_my_workspace())
  );

alter table public.customer_invoices
  drop constraint if exists customer_invoices_source_code_chk;

alter table public.customer_invoices
  add constraint customer_invoices_source_code_chk
  check (
    invoice_source_code is null
    or invoice_source_code in ('EQUIPMENT','PARTS','RENTAL','SERVICE','GENERAL','FINANCE_CHARGE')
  ) not valid;

create table if not exists public.ar_dunning_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  crm_company_id uuid not null references public.qrm_companies(id) on delete cascade,
  invoice_id uuid references public.customer_invoices(id) on delete cascade,
  statement_run_id uuid references public.ar_statement_runs(id) on delete set null,
  event_type text not null check (event_type in ('statement', 'finance_charge', 'reminder_email', 'auto_hold')),
  cycle_date date not null default current_date,
  days_past_due integer not null default 0,
  principal_basis_cents bigint not null default 0 check (principal_basis_cents >= 0),
  rate_pct numeric(8, 6) not null default 0 check (rate_pct >= 0),
  lawful_cap_rate_pct numeric(8, 6) not null default 0 check (lawful_cap_rate_pct >= 0),
  charge_cents bigint not null default 0 check (charge_cents >= 0),
  compounded boolean not null default false,
  generated_invoice_id uuid references public.customer_invoices(id) on delete set null,
  message_stub text not null default 'TODO: brand-voice',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.ar_dunning_events is
  'Machine-readable AR statement, finance-charge, reminder, and auto-hold ledger. Customer-facing copy is intentionally a TODO: brand-voice stub.';
comment on column public.ar_dunning_events.message_stub is
  'Do not ship generated dunning copy. Replace TODO: brand-voice through QEP-approved copy review before customer delivery.';

create unique index if not exists uq_ar_dunning_events_cycle
  on public.ar_dunning_events(workspace_id, invoice_id, event_type, cycle_date)
  where invoice_id is not null and deleted_at is null;

create index if not exists idx_ar_dunning_events_company
  on public.ar_dunning_events(workspace_id, crm_company_id, cycle_date desc)
  where deleted_at is null;

alter table public.ar_dunning_events enable row level security;

create policy "ar_dunning_events_service_all"
  on public.ar_dunning_events for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "ar_dunning_events_finance_read"
  on public.ar_dunning_events for select
  using (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_read()
  );

create policy "ar_dunning_events_finance_mutate"
  on public.ar_dunning_events for all
  using (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_mutate()
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_mutate()
  );

create trigger set_ar_dunning_events_updated_at
  before update on public.ar_dunning_events
  for each row execute function public.set_updated_at();

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
  v_lawful_annual_cap numeric := 0.18;
  v_monthly_rate numeric;
  v_statement_count integer := 0;
  v_charge_count integer := 0;
  v_reminder_count integer := 0;
  v_hold_count integer := 0;
  v_invoice record;
  v_charge_cents bigint;
  v_generated_invoice_id uuid;
  v_portal_customer_id uuid;
begin
  if (select auth.role()) is distinct from 'service_role' and not public.qep_finance_can_mutate() then
    raise exception 'AR dunning cycle requires finance/admin privileges';
  end if;

  select *
    into v_settings
  from public.workspace_settings ws
  where ws.workspace_id = p_workspace_id;

  if v_settings.workspace_id is null then
    insert into public.workspace_settings (workspace_id)
    values (p_workspace_id)
    on conflict (workspace_id) do nothing;

    select *
      into v_settings
    from public.workspace_settings ws
    where ws.workspace_id = p_workspace_id;
  end if;

  select coalesce((public.qep_finance_config_value('florida_finance_charge_lawful_cap', p_workspace_id)->>'annual_rate')::numeric, 0.18)
    into v_lawful_annual_cap;

  v_monthly_rate := least(v_settings.ar_finance_charge_rate_pct, v_lawful_annual_cap / 12.0);

  insert into public.ar_statement_runs (
    workspace_id,
    run_type,
    scope_filter,
    scheduled_at,
    created_by
  )
  values (
    p_workspace_id,
    case when extract(day from p_cycle_date)::integer = v_settings.ar_statement_day_of_month then 'statement' else 'dunning' end,
    jsonb_build_object('cycle_date', p_cycle_date, 'automated', true),
    p_cycle_date::timestamptz,
    auth.uid()
  )
  returning id into v_statement_run_id;

  if extract(day from p_cycle_date)::integer = v_settings.ar_statement_day_of_month then
    insert into public.ar_dunning_events (
      workspace_id,
      crm_company_id,
      invoice_id,
      statement_run_id,
      event_type,
      cycle_date,
      days_past_due,
      principal_basis_cents,
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
    from public.customer_invoices ci
    join public.qrm_companies c on c.id = ci.crm_company_id
    where ci.workspace_id = p_workspace_id
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
      c.assess_late_charges,
      greatest(p_cycle_date - ci.due_date, 0) as days_past_due
    from public.customer_invoices ci
    join public.qrm_companies c on c.id = ci.crm_company_id
    where ci.workspace_id = p_workspace_id
      and ci.crm_company_id is not null
      and ci.balance_due > 0
      and ci.status not in ('paid', 'void', 'reversed')
      and coalesce(c.assess_late_charges, true)
  loop
    if v_invoice.days_past_due >= v_settings.ar_finance_charge_days_past_due
       and (not v_settings.ar_finance_charge_principal_only or coalesce(v_invoice.invoice_source_code, '') <> 'FINANCE_CHARGE')
       and not exists (
         select 1
         from public.ar_dunning_events e
         where e.workspace_id = p_workspace_id
           and e.invoice_id = v_invoice.id
           and e.event_type = 'finance_charge'
           and e.cycle_date = p_cycle_date
           and e.deleted_at is null
       ) then
      v_charge_cents := greatest(floor(round(v_invoice.balance_due * 100)::numeric * v_monthly_rate), 0)::bigint;
      v_generated_invoice_id := null;

      select pc.id
        into v_portal_customer_id
      from public.portal_customers pc
      where pc.workspace_id = p_workspace_id
        and pc.crm_company_id = v_invoice.crm_company_id
        and pc.is_active = true
      order by pc.created_at
      limit 1;

      if v_charge_cents > 0 and v_portal_customer_id is not null then
        insert into public.customer_invoices (
          workspace_id,
          portal_customer_id,
          crm_company_id,
          invoice_number,
          invoice_date,
          due_date,
          description,
          amount,
          tax,
          total,
          status,
          invoice_type,
          invoice_source_code
        )
        values (
          p_workspace_id,
          v_portal_customer_id,
          v_invoice.crm_company_id,
          'FC-' || to_char(p_cycle_date, 'YYYYMMDD') || '-' || left(v_invoice.id::text, 8),
          p_cycle_date,
          p_cycle_date,
          'TODO: brand-voice finance charge',
          (v_charge_cents::numeric / 100.0),
          0,
          (v_charge_cents::numeric / 100.0),
          'pending',
          'general',
          'FINANCE_CHARGE'
        )
        returning id into v_generated_invoice_id;

        insert into public.customer_invoice_line_items (
          workspace_id,
          invoice_id,
          line_number,
          description,
          quantity,
          unit_price
        )
        values (
          p_workspace_id,
          v_generated_invoice_id,
          1,
          'TODO: brand-voice finance charge',
          1,
          (v_charge_cents::numeric / 100.0)
        );
      end if;

      insert into public.ar_dunning_events (
        workspace_id,
        crm_company_id,
        invoice_id,
        statement_run_id,
        event_type,
        cycle_date,
        days_past_due,
        principal_basis_cents,
        rate_pct,
        lawful_cap_rate_pct,
        charge_cents,
        compounded,
        generated_invoice_id,
        message_stub
      )
      values (
        p_workspace_id,
        v_invoice.crm_company_id,
        v_invoice.id,
        v_statement_run_id,
        'finance_charge',
        p_cycle_date,
        v_invoice.days_past_due,
        round(v_invoice.balance_due * 100)::bigint,
        v_monthly_rate,
        v_lawful_annual_cap / 12.0,
        v_charge_cents,
        v_settings.ar_finance_charge_compounding_enabled,
        v_generated_invoice_id,
        'TODO: brand-voice'
      )
      on conflict do nothing;

      v_charge_count := v_charge_count + 1;
    end if;

    if v_invoice.days_past_due >= v_settings.ar_reminder_min_days
       and v_invoice.days_past_due < v_settings.ar_reminder_max_days then
      insert into public.ar_dunning_events (
        workspace_id,
        crm_company_id,
        invoice_id,
        statement_run_id,
        event_type,
        cycle_date,
        days_past_due,
        principal_basis_cents,
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

      v_reminder_count := v_reminder_count + 1;
    end if;

    if v_invoice.days_past_due >= v_settings.ar_auto_hold_days then
      update public.qrm_companies c
      set credit_hold = true,
          credit_hold_reason = coalesce(
            c.credit_hold_reason,
            format('AR auto-hold at %s days past due', v_settings.ar_auto_hold_days)
          ),
          credit_hold_set_by = coalesce(c.credit_hold_set_by, auth.uid()),
          credit_hold_set_at = coalesce(c.credit_hold_set_at, now())
      where c.id = v_invoice.crm_company_id
        and c.workspace_id = p_workspace_id;

      insert into public.ar_dunning_events (
        workspace_id,
        crm_company_id,
        invoice_id,
        statement_run_id,
        event_type,
        cycle_date,
        days_past_due,
        principal_basis_cents,
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

      v_hold_count := v_hold_count + 1;
    end if;
  end loop;

  update public.ar_statement_runs
  set delivered_count = v_statement_count + v_charge_count + v_reminder_count + v_hold_count,
      completed_at = now()
  where id = v_statement_run_id;

  return jsonb_build_object(
    'ok', true,
    'statement_run_id', v_statement_run_id,
    'statement_events', v_statement_count,
    'finance_charge_events', v_charge_count,
    'reminder_events', v_reminder_count,
    'auto_hold_events', v_hold_count,
    'finance_charge_basis', case when v_settings.ar_finance_charge_principal_only then 'principal_only' else 'compounding_allowed' end,
    'monthly_rate_applied', v_monthly_rate
  );
end;
$$;

comment on function public.run_ar_dunning_cycle(text, date) is
  'Idempotent AR dunning cycle runner: statement on configured day, capped 1.5% finance charge at 30 days past due, TODO brand-voice reminder 30-60 days, and credit hold at 60 days.';

revoke execute on function public.run_ar_dunning_cycle(text, date) from public;
grant execute on function public.run_ar_dunning_cycle(text, date) to authenticated;
grant execute on function public.run_ar_dunning_cycle(text, date) to service_role;
