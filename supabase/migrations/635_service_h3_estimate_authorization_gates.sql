-- ============================================================================
-- Migration 635: H3 estimate authorization gates
--
-- Models the owner-binding "No approval = No repair" rule without bricking
-- legacy work already in flight: existing service_jobs are marked not_required,
-- while new rows default to pending authorization after this migration.
--
-- No enum values are added in H3; approval kind/status are constrained text.
-- ============================================================================

alter table public.service_jobs
  add column if not exists estimate_authorization_required boolean,
  add column if not exists estimate_authorization_status text,
  add column if not exists approved_estimate_quote_id uuid references public.service_quotes(id) on delete set null,
  add column if not exists approved_estimate_approval_id uuid references public.service_quote_approvals(id) on delete set null,
  add column if not exists approved_estimate_amount numeric(12, 2),
  add column if not exists approved_estimate_authorized_at timestamptz,
  add column if not exists estimate_reauth_threshold_pct numeric(5, 2),
  add column if not exists estimate_reauthorization_required_at timestamptz,
  add column if not exists estimate_reauthorization_reason text;

update public.service_jobs
set
  estimate_authorization_required = coalesce(estimate_authorization_required, false),
  estimate_authorization_status = coalesce(estimate_authorization_status, 'not_required'),
  estimate_reauth_threshold_pct = coalesce(estimate_reauth_threshold_pct, 10.00)
where estimate_authorization_required is null
   or estimate_authorization_status is null
   or estimate_reauth_threshold_pct is null;

alter table public.service_jobs
  alter column estimate_authorization_required set default true,
  alter column estimate_authorization_required set not null,
  alter column estimate_authorization_status set default 'pending',
  alter column estimate_authorization_status set not null,
  alter column estimate_reauth_threshold_pct set default 10.00,
  alter column estimate_reauth_threshold_pct set not null;

comment on column public.service_jobs.estimate_authorization_required is
  'H3 gate flag. Existing jobs are backfilled false/not_required; new jobs default true so work-start requires an approved estimate.';
comment on column public.service_jobs.estimate_authorization_status is
  'H3 estimate authorization state: not_required, pending, approved, or reauthorization_required.';
comment on column public.service_jobs.approved_estimate_quote_id is
  'H3 approved estimate baseline quote used by work-start and >10% re-authorization gates.';
comment on column public.service_jobs.approved_estimate_approval_id is
  'H3 service_quote_approvals row documenting the current approved estimate baseline.';
comment on column public.service_jobs.approved_estimate_amount is
  'H3 approved estimate baseline amount. Additional scope over estimate_reauth_threshold_pct requires re-authorization.';
comment on column public.service_jobs.estimate_reauth_threshold_pct is
  'H3 re-authorization threshold percentage over the approved estimate amount. Owner-binding default is 10%.';
comment on column public.service_jobs.estimate_reauthorization_required_at is
  'Set when a current quote/scope estimate exceeds approved_estimate_amount by more than estimate_reauth_threshold_pct.';
comment on column public.service_jobs.estimate_reauthorization_reason is
  'Human-readable reason for the H3 re-authorization block.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'service_jobs_estimate_authorization_status_chk') then
    alter table public.service_jobs
      add constraint service_jobs_estimate_authorization_status_chk
      check (estimate_authorization_status in ('not_required', 'pending', 'approved', 'reauthorization_required')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'service_jobs_estimate_auth_required_consistency_chk') then
    alter table public.service_jobs
      add constraint service_jobs_estimate_auth_required_consistency_chk
      check (
        (estimate_authorization_required = false and estimate_authorization_status = 'not_required')
        or (estimate_authorization_required = true and estimate_authorization_status in ('pending', 'approved', 'reauthorization_required'))
      ) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'service_jobs_approved_estimate_amount_nonnegative_chk') then
    alter table public.service_jobs
      add constraint service_jobs_approved_estimate_amount_nonnegative_chk
      check (approved_estimate_amount is null or approved_estimate_amount >= 0) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'service_jobs_approved_estimate_documented_chk') then
    alter table public.service_jobs
      add constraint service_jobs_approved_estimate_documented_chk
      check (
        estimate_authorization_required = false
        or estimate_authorization_status <> 'approved'
        or (
          approved_estimate_quote_id is not null
          and approved_estimate_approval_id is not null
          and approved_estimate_amount is not null
        )
      ) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'service_jobs_estimate_reauth_threshold_chk') then
    alter table public.service_jobs
      add constraint service_jobs_estimate_reauth_threshold_chk
      check (estimate_reauth_threshold_pct >= 0 and estimate_reauth_threshold_pct <= 100) not valid;
  end if;
end $$;

alter table public.service_quote_approvals
  add column if not exists approval_kind text not null default 'initial_estimate',
  add column if not exists approved_amount numeric(12, 2),
  add column if not exists scope_increase_pct numeric(8, 4),
  add column if not exists approval_metadata jsonb not null default '{}'::jsonb;

comment on column public.service_quote_approvals.approval_kind is
  'H3 approval documentation kind: initial_estimate or scope_increase_reauthorization. Portal e-sign is a future channel, not built in H3.';
comment on column public.service_quote_approvals.approved_amount is
  'H3 quote total approved by this approval record.';
comment on column public.service_quote_approvals.scope_increase_pct is
  'H3 percent increase over the previous approved baseline when this approval documents re-authorization.';
comment on column public.service_quote_approvals.approval_metadata is
  'Structured H3 approval details for auditability without adding portal e-sign in this slice.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'service_quote_approvals_approval_kind_chk') then
    alter table public.service_quote_approvals
      add constraint service_quote_approvals_approval_kind_chk
      check (approval_kind in ('initial_estimate', 'scope_increase_reauthorization')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'service_quote_approvals_approved_amount_nonnegative_chk') then
    alter table public.service_quote_approvals
      add constraint service_quote_approvals_approved_amount_nonnegative_chk
      check (approved_amount is null or approved_amount >= 0) not valid;
  end if;
end $$;

create index if not exists idx_service_jobs_estimate_auth_open
  on public.service_jobs(workspace_id, estimate_authorization_status, current_stage)
  where estimate_authorization_required = true and closed_at is null and deleted_at is null;
comment on index public.idx_service_jobs_estimate_auth_open is
  'Supports H3 queues and diagnostics for open service jobs blocked by estimate authorization.';

create index if not exists idx_service_quote_approvals_kind_quote
  on public.service_quote_approvals(quote_id, approval_kind, approved_at desc);
comment on index public.idx_service_quote_approvals_kind_quote is
  'Supports H3 lookup of documented initial approvals and scope-increase re-authorizations by quote.';

create or replace function public.service_job_estimate_authorization_gate(
  p_job_id uuid,
  p_scope_estimate_amount numeric default null
)
returns table (
  ok boolean,
  code text,
  reason text,
  approved_amount numeric,
  threshold_amount numeric,
  scope_estimate_amount numeric,
  threshold_pct numeric,
  status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  j record;
  v_scope numeric;
  v_threshold numeric;
  v_documented_approval boolean := false;
begin
  select
    id,
    estimate_authorization_required,
    estimate_authorization_status,
    approved_estimate_amount,
    approved_estimate_quote_id,
    approved_estimate_approval_id,
    estimate_reauth_threshold_pct,
    quote_total
  into j
  from public.service_jobs
  where id = p_job_id;

  if not found then
    return query select
      false,
      'service_job_not_found'::text,
      'Service job not found for estimate authorization gate.'::text,
      null::numeric,
      null::numeric,
      null::numeric,
      10.00::numeric,
      'pending'::text;
    return;
  end if;

  v_scope := coalesce(p_scope_estimate_amount, j.quote_total);
  v_threshold := case
    when j.approved_estimate_amount is null then null
    else round(j.approved_estimate_amount * (1 + coalesce(j.estimate_reauth_threshold_pct, 10.00) / 100.0), 2)
  end;

  select exists(
    select 1
    from public.service_quote_approvals a
    where a.id = j.approved_estimate_approval_id
      and a.quote_id = j.approved_estimate_quote_id
      and a.approval_kind in ('initial_estimate', 'scope_increase_reauthorization')
      and (
        a.approved_amount is null
        or j.approved_estimate_amount is null
        or a.approved_amount = j.approved_estimate_amount
      )
  ) into v_documented_approval;

  if coalesce(j.estimate_authorization_required, false) = false
     or j.estimate_authorization_status = 'not_required' then
    return query select
      true,
      'estimate_authorization_not_required'::text,
      'Estimate authorization is not required for this legacy service job.'::text,
      j.approved_estimate_amount,
      v_threshold,
      v_scope,
      coalesce(j.estimate_reauth_threshold_pct, 10.00),
      coalesce(j.estimate_authorization_status, 'not_required')::text;
    return;
  end if;

  if j.estimate_authorization_status <> 'approved'
     or j.approved_estimate_amount is null
     or j.approved_estimate_quote_id is null
     or j.approved_estimate_approval_id is null
     or v_documented_approval is not true then
    return query select
      false,
      case
        when j.estimate_authorization_status = 'reauthorization_required'
          then 'estimate_reauthorization_required'
        else 'estimate_approval_required'
      end::text,
      case
        when j.estimate_authorization_status = 'reauthorization_required'
          then 'Repair work is blocked because the current estimate exceeds the approved amount by more than the re-authorization threshold. Document customer re-authorization before proceeding.'
        else 'Repair work is blocked until a documented approved estimate is recorded for this service job.'
      end::text,
      j.approved_estimate_amount,
      v_threshold,
      v_scope,
      coalesce(j.estimate_reauth_threshold_pct, 10.00),
      coalesce(j.estimate_authorization_status, 'pending')::text;
    return;
  end if;

  if v_scope is not null and v_threshold is not null and v_scope > v_threshold then
    return query select
      false,
      'estimate_reauthorization_required'::text,
      'Repair work is blocked because the current estimate exceeds the approved amount by more than the re-authorization threshold. Document customer re-authorization before proceeding.'::text,
      j.approved_estimate_amount,
      v_threshold,
      v_scope,
      coalesce(j.estimate_reauth_threshold_pct, 10.00),
      j.estimate_authorization_status::text;
    return;
  end if;

  return query select
    true,
    'estimate_authorization_approved'::text,
    'A documented approved estimate is on file for this service job.'::text,
    j.approved_estimate_amount,
    v_threshold,
    v_scope,
    coalesce(j.estimate_reauth_threshold_pct, 10.00),
    j.estimate_authorization_status::text;
end;
$$;

comment on function public.service_job_estimate_authorization_gate(uuid, numeric) is
  'H3 work-start gate: returns whether a service job can enter repair/clock labor based on approved estimate baseline and >10% re-authorization threshold.';

revoke execute on function public.service_job_estimate_authorization_gate(uuid, numeric) from public;
revoke execute on function public.service_job_estimate_authorization_gate(uuid, numeric) from authenticated;
grant execute on function public.service_job_estimate_authorization_gate(uuid, numeric) to service_role;

create or replace function public.enforce_service_job_repair_estimate_authorization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate record;
begin
  if new.current_stage::text = 'in_progress'
     and coalesce(old.current_stage::text, '') is distinct from new.current_stage::text then
    select * into gate
    from public.service_job_estimate_authorization_gate(new.id, new.quote_total)
    limit 1;

    if gate.ok is not true then
      raise exception using
        errcode = 'P0001',
        message = gate.reason,
        detail = gate.code;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.enforce_service_job_repair_estimate_authorization() is
  'H3 DB backstop for direct service_jobs updates into in_progress. Edge router returns 422 before this trigger for normal calls.';

drop trigger if exists service_jobs_h3_repair_estimate_authorization_trg on public.service_jobs;
create trigger service_jobs_h3_repair_estimate_authorization_trg
  before update of current_stage, quote_total on public.service_jobs
  for each row execute function public.enforce_service_job_repair_estimate_authorization();

create or replace function public.enforce_service_timecard_estimate_authorization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate record;
begin
  select * into gate
  from public.service_job_estimate_authorization_gate(new.service_job_id, null)
  limit 1;

  if gate.ok is not true then
    raise exception using
      errcode = 'P0001',
      message = gate.reason,
      detail = gate.code;
  end if;

  return new;
end;
$$;

comment on function public.enforce_service_timecard_estimate_authorization() is
  'H3 DB backstop for technician clock-on. Direct service_timecards inserts are blocked unless the job has approved estimate authorization.';

drop trigger if exists service_timecards_h3_estimate_authorization_trg on public.service_timecards;
create trigger service_timecards_h3_estimate_authorization_trg
  before insert on public.service_timecards
  for each row execute function public.enforce_service_timecard_estimate_authorization();
