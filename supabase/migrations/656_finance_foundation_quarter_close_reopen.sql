-- 656_finance_foundation_quarter_close_reopen.sql
--
-- Finance foundation Part 2: quarter close, hard lock, and dual-approver reopen.
--
-- Rollback notes:
--   drop function if exists public.reopen_gl_quarter(uuid, uuid, uuid, text, jsonb);
--   drop trigger if exists trg_quarter_reopen_log_append_only on public.quarter_reopen_log;
--   drop function if exists public.quarter_reopen_log_block_mutation();
--   drop table if exists public.quarter_reopen_log;
--   alter table public.workspace_settings drop constraint if exists workspace_settings_cpa_adjustment_posting_target_chk;
--   alter table public.workspace_settings drop column if exists cpa_adjustment_posting_target;
--   alter table public.gl_periods drop column if exists quarter_locked_by;
--   alter table public.gl_periods drop column if exists quarter_locked_at;
--   alter table public.gl_periods drop column if exists quarter_closed_by;
--   alter table public.gl_periods drop column if exists quarter_closed_at;
--   alter table public.gl_periods drop column if exists quarter_status;
--   alter table public.gl_periods drop column if exists quarter_end;
--   alter table public.gl_periods drop column if exists quarter_start;
--   alter table public.gl_periods drop column if exists period_quarter;

alter table public.gl_periods
  add column if not exists period_quarter smallint,
  add column if not exists quarter_start date,
  add column if not exists quarter_end date,
  add column if not exists quarter_status text not null default 'open',
  add column if not exists quarter_closed_at timestamptz,
  add column if not exists quarter_closed_by uuid references public.profiles(id) on delete set null,
  add column if not exists quarter_locked_at timestamptz,
  add column if not exists quarter_locked_by uuid references public.profiles(id) on delete set null;

update public.gl_periods
set
  period_quarter = ((period_month - 1) / 3 + 1)::smallint,
  quarter_start = make_date(period_year, (((period_month - 1) / 3) * 3 + 1)::integer, 1),
  quarter_end = (
    make_date(period_year, (((period_month - 1) / 3) * 3 + 1)::integer, 1)
    + interval '3 months'
    - interval '1 day'
  )::date,
  quarter_status = case when status = 'hard_closed' then 'hard_closed' else quarter_status end,
  quarter_locked_at = case when status = 'hard_closed' then coalesce(gl_closed_at, updated_at, now()) else quarter_locked_at end,
  quarter_locked_by = case when status = 'hard_closed' then coalesce(closed_by, quarter_locked_by) else quarter_locked_by end
where period_quarter is null
   or quarter_start is null
   or quarter_end is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'gl_periods_period_quarter_chk'
  ) then
    alter table public.gl_periods
      add constraint gl_periods_period_quarter_chk
      check (period_quarter between 1 and 4);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'gl_periods_quarter_status_chk'
  ) then
    alter table public.gl_periods
      add constraint gl_periods_quarter_status_chk
      check (quarter_status in ('open', 'soft_closed', 'hard_closed'));
  end if;
end $$;

create index if not exists idx_gl_periods_quarter
  on public.gl_periods(workspace_id, company_id, period_year, period_quarter)
  where deleted_at is null;

comment on column public.gl_periods.period_quarter is
  'Fiscal quarter number derived from period_month for QEP quarterly close.';
comment on column public.gl_periods.quarter_status is
  'Quarter-level close status. hard_closed is the lock primitive against back-dated edits.';
comment on column public.gl_periods.quarter_locked_at is
  'Timestamp when the quarter was hard-closed and locked against back-dated edits.';

drop policy if exists "gl_periods_all_elevated" on public.gl_periods;
create policy "gl_periods_all_elevated"
  on public.gl_periods for all
  using (
    coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'finance_admin')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'finance_admin')
    and workspace_id = (select public.get_my_workspace())
  );

alter table public.workspace_settings
  add column if not exists cpa_adjustment_posting_target text not null default 'current_period';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workspace_settings_cpa_adjustment_posting_target_chk'
  ) then
    alter table public.workspace_settings
      add constraint workspace_settings_cpa_adjustment_posting_target_chk
      check (cpa_adjustment_posting_target in ('current_period', 'source_period'));
  end if;
end $$;

comment on column public.workspace_settings.cpa_adjustment_posting_target is
  'OPEN DECISION Round 2 Q9: CPA adjustment target. Safe default is current_period until owner/CPA authorize source-period reopen behavior.';

insert into public.finance_foundation_config (
  workspace_id,
  config_key,
  config_value,
  safe_default,
  authorizing_question,
  note
)
values (
  'default',
  'cpa_adjustment_posting_target',
  '{"target": "current_period"}'::jsonb,
  '{"target": "current_period"}'::jsonb,
  'Round 2 Q9: CPA adjustment posting target',
  'PARKED: final CPA adjustment behavior remains open; default posts adjustments to current period.'
)
on conflict do nothing;

create table if not exists public.quarter_reopen_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  period_id uuid not null references public.gl_periods(id) on delete restrict,
  period_ids uuid[] not null default '{}'::uuid[],
  company_id uuid references public.gl_companies(id) on delete set null,
  period_year integer not null,
  period_quarter smallint not null check (period_quarter between 1 and 4),
  reason text not null check (length(trim(reason)) >= 10),
  prior_period_status text not null,
  prior_quarter_status text not null,
  owner_approved_by uuid not null references public.profiles(id) on delete restrict,
  owner_approved_at timestamptz not null default now(),
  finance_admin_approved_by uuid not null references public.profiles(id) on delete restrict,
  finance_admin_approved_at timestamptz not null default now(),
  reopened_by uuid not null references public.profiles(id) on delete restrict,
  reopened_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.quarter_reopen_log is
  'Permanent append-only audit log for hard-closed quarter reopens. Requires separate owner and finance_admin approvers.';

create index if not exists idx_quarter_reopen_log_quarter
  on public.quarter_reopen_log(workspace_id, company_id, period_year, period_quarter, reopened_at desc);

alter table public.quarter_reopen_log enable row level security;

create policy "quarter_reopen_log_service_all"
  on public.quarter_reopen_log for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "quarter_reopen_log_finance_read"
  on public.quarter_reopen_log for select
  using (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_read()
  );

create or replace function public.quarter_reopen_log_block_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'quarter_reopen_log is append-only';
end;
$$;

drop trigger if exists trg_quarter_reopen_log_append_only on public.quarter_reopen_log;
create trigger trg_quarter_reopen_log_append_only
  before update or delete on public.quarter_reopen_log
  for each row execute function public.quarter_reopen_log_block_mutation();

create or replace function public.reopen_gl_quarter(
  p_period_id uuid,
  p_owner_approver_id uuid,
  p_finance_admin_approver_id uuid,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
)
returns public.quarter_reopen_log
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period public.gl_periods;
  v_actor uuid := (select auth.uid());
  v_log public.quarter_reopen_log;
  v_period_ids uuid[];
begin
  if (select auth.role()) is distinct from 'service_role' and not public.qep_finance_can_mutate() then
    raise exception 'quarter reopen requires finance/admin privileges';
  end if;

  if p_owner_approver_id is null
     or p_finance_admin_approver_id is null
     or p_owner_approver_id = p_finance_admin_approver_id then
    raise exception 'quarter reopen requires two distinct approvers: owner and finance_admin';
  end if;

  if nullif(trim(p_reason), '') is null or length(trim(p_reason)) < 10 then
    raise exception 'quarter reopen reason must be at least 10 characters';
  end if;

  select *
    into v_period
  from public.gl_periods gp
  where gp.id = p_period_id
  for update;

  if v_period.id is null then
    raise exception 'gl period % not found', p_period_id;
  end if;

  if v_period.workspace_id is distinct from public.get_my_workspace()
     and (select auth.role()) is distinct from 'service_role' then
    raise exception 'gl period is outside caller workspace';
  end if;

  if coalesce(v_period.quarter_status, v_period.status) <> 'hard_closed'
     and v_period.status <> 'hard_closed' then
    raise exception 'only hard-closed quarters can be reopened through this path';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_owner_approver_id
      and p.role::text = 'owner'
  ) then
    raise exception 'owner approver must have owner role';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_finance_admin_approver_id
      and p.role::text = 'finance_admin'
  ) then
    raise exception 'finance approver must have finance_admin role';
  end if;

  select array_agg(gp.id order by gp.period_month)
    into v_period_ids
  from public.gl_periods gp
  where gp.workspace_id = v_period.workspace_id
    and gp.period_year = v_period.period_year
    and gp.period_quarter = v_period.period_quarter
    and (gp.company_id is not distinct from v_period.company_id)
    and gp.deleted_at is null;

  update public.gl_periods gp
  set status = case when gp.status = 'hard_closed' then 'open' else gp.status end,
      quarter_status = 'open',
      updated_at = now()
  where gp.workspace_id = v_period.workspace_id
    and gp.period_year = v_period.period_year
    and gp.period_quarter = v_period.period_quarter
    and (gp.company_id is not distinct from v_period.company_id)
    and gp.deleted_at is null;

  insert into public.quarter_reopen_log (
    workspace_id,
    period_id,
    period_ids,
    company_id,
    period_year,
    period_quarter,
    reason,
    prior_period_status,
    prior_quarter_status,
    owner_approved_by,
    finance_admin_approved_by,
    reopened_by,
    metadata
  )
  values (
    v_period.workspace_id,
    v_period.id,
    coalesce(v_period_ids, array[v_period.id]::uuid[]),
    v_period.company_id,
    v_period.period_year,
    v_period.period_quarter,
    trim(p_reason),
    v_period.status,
    v_period.quarter_status,
    p_owner_approver_id,
    p_finance_admin_approver_id,
    coalesce(v_actor, p_finance_admin_approver_id),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_log;

  return v_log;
end;
$$;

comment on function public.reopen_gl_quarter(uuid, uuid, uuid, text, jsonb) is
  'Reopens a hard-closed GL quarter only after distinct owner and finance_admin approvals, and writes a permanent quarter_reopen_log row.';

revoke execute on function public.reopen_gl_quarter(uuid, uuid, uuid, text, jsonb) from public;
grant execute on function public.reopen_gl_quarter(uuid, uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.reopen_gl_quarter(uuid, uuid, uuid, text, jsonb) to service_role;
