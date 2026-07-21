-- 827_finance_numbering_and_quarter_reopen_approvals.sql
--
-- Canonicalizes invoice minting on the existing invoice_number_sequences
-- table (five digits, E/R/P/W, one workspace-safe generator) and replaces the
-- one-call quarter reopen with independently recorded Ryan/Tina approvals.

begin;

-- ---------------------------------------------------------------------------
-- 1. One collision-safe invoice-number generator.
-- ---------------------------------------------------------------------------

alter table public.invoice_number_sequences
  alter column next_value set default 1;

alter table public.invoice_number_sequences
  drop constraint if exists invoice_number_sequences_dept_prefix_check;

alter table public.invoice_number_sequences
  add constraint invoice_number_sequences_dept_prefix_owner_chk
  check (dept_prefix in ('E', 'P', 'S', 'W', 'R', 'G')) not valid;

comment on column public.invoice_number_sequences.next_value is
  'Last value issued for a branch/department counter. New combinations begin at 1; existing counters are never reset.';

create or replace function public.next_invoice_number(
  p_workspace_id text,
  p_branch_legacy_code text,
  p_invoice_type text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dept_prefix text;
  v_next bigint;
  v_caller_workspace text := public.get_my_workspace();
begin
  if (select auth.role()) is distinct from 'service_role' then
    if p_workspace_id is distinct from v_caller_workspace then
      raise exception 'invoice numbering workspace does not match caller workspace';
    end if;
    if not public.qep_finance_can_mutate() then
      raise exception 'invoice numbering requires finance/admin privileges';
    end if;
  end if;

  v_dept_prefix := case lower(coalesce(p_invoice_type, ''))
    when 'equipment' then 'E'
    when 'parts' then 'P'
    when 'service' then 'W'
    when 'rental' then 'R'
    when 'general' then 'G'
    else null
  end;

  if v_dept_prefix is null then
    raise exception 'unsupported invoice_type for invoice numbering: %', p_invoice_type;
  end if;

  if p_branch_legacy_code is null or p_branch_legacy_code !~ '^[0-9]{2}$' then
    raise exception 'invalid branch legacy code (expected 2 digits): %', p_branch_legacy_code;
  end if;

  if not exists (
    select 1
    from public.branches b
    where b.workspace_id = p_workspace_id
      and b.deleted_at is null
      and (
        b.legacy_code = p_branch_legacy_code
        or b.legacy_invoice_branch_code = p_branch_legacy_code
      )
  ) then
    raise exception 'branch code % is not registered in workspace %',
      p_branch_legacy_code, p_workspace_id;
  end if;

  insert into public.invoice_number_sequences (
    workspace_id, branch_legacy_code, dept_prefix, next_value
  )
  values (
    p_workspace_id, p_branch_legacy_code, v_dept_prefix, 1
  )
  on conflict (workspace_id, branch_legacy_code, dept_prefix)
  do update set
    next_value = public.invoice_number_sequences.next_value + 1,
    updated_at = now()
  returning next_value into v_next;

  return p_branch_legacy_code || '-' || v_dept_prefix || lpad(v_next::text, 5, '0');
end;
$$;

comment on function public.next_invoice_number(text, text, text) is
  'F7 workspace-safe canonical generator. Returns [branch]-[E|R|P|W][five digits], preserves existing counters, and starts new branch/department counters at 00001.';

revoke all on function public.next_invoice_number(text, text, text)
  from public, anon, authenticated;
grant execute on function public.next_invoice_number(text, text, text)
  to authenticated, service_role;

-- Retain both historical qep_next_finance_invoice_number signatures as
-- compatibility wrappers, but delegate every new mint to the canonical table.
create or replace function public.qep_next_finance_invoice_number(
  p_workspace_id text,
  p_branch_id uuid,
  p_department_code text,
  p_invoice_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch_code text;
  v_department_code text := upper(nullif(trim(p_department_code), ''));
  v_invoice_type text;
  v_invoice_number text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    if p_workspace_id is distinct from public.get_my_workspace() then
      raise exception 'finance invoice workspace does not match caller workspace';
    end if;
    if not public.qep_finance_can_mutate() then
      raise exception 'finance invoice generation requires finance/admin privileges';
    end if;
  end if;

  select coalesce(b.legacy_invoice_branch_code, b.legacy_code)
    into v_branch_code
  from public.branches b
  where b.id = p_branch_id
    and b.workspace_id = p_workspace_id
    and b.deleted_at is null;

  if v_branch_code is null then
    raise exception 'branch % does not have a registered invoice code', p_branch_id;
  end if;

  v_invoice_type := case v_department_code
    when 'E' then 'equipment'
    when 'R' then 'rental'
    when 'P' then 'parts'
    when 'W' then 'service'
    when 'S' then 'service'
    when 'G' then 'general'
    else null
  end;

  if v_invoice_type is null then
    raise exception 'unsupported finance department code: %', p_department_code;
  end if;

  v_invoice_number := public.next_invoice_number(
    p_workspace_id, v_branch_code, v_invoice_type
  );

  if p_invoice_id is not null then
    update public.customer_invoices ci
    set
      qep_invoice_number = v_invoice_number,
      invoice_department_code = case when v_department_code = 'S' then 'W' else v_department_code end,
      updated_at = now()
    where ci.id = p_invoice_id
      and ci.workspace_id = p_workspace_id;
  end if;

  return v_invoice_number;
end;
$$;

create or replace function public.qep_next_finance_invoice_number(
  p_workspace_id text,
  p_branch_slug text,
  p_department_code text,
  p_invoice_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch_id uuid;
begin
  if (select auth.role()) is distinct from 'service_role'
     and p_workspace_id is distinct from public.get_my_workspace() then
    raise exception 'finance invoice workspace does not match caller workspace';
  end if;

  select b.id
    into v_branch_id
  from public.branches b
  where b.workspace_id = p_workspace_id
    and b.slug = p_branch_slug
    and b.deleted_at is null
  limit 1;

  if v_branch_id is null then
    raise exception 'branch slug % does not resolve for workspace %',
      p_branch_slug, p_workspace_id;
  end if;

  return public.qep_next_finance_invoice_number(
    p_workspace_id, v_branch_id, p_department_code, p_invoice_id
  );
end;
$$;

revoke all on function public.qep_next_finance_invoice_number(text, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.qep_next_finance_invoice_number(text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.qep_next_finance_invoice_number(text, uuid, text, uuid)
  to authenticated, service_role;
grant execute on function public.qep_next_finance_invoice_number(text, text, text, uuid)
  to authenticated, service_role;

comment on table public.finance_invoice_sequences is
  'Deprecated compatibility table retained for audit. New numbers are minted only through invoice_number_sequences and next_invoice_number.';

-- ---------------------------------------------------------------------------
-- 2. Named approval principals and independently attested quarter reopen.
-- ---------------------------------------------------------------------------

create table if not exists public.finance_approval_principals (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  approval_scope text not null,
  approval_role text not null,
  expected_name text not null,
  profile_id uuid references public.profiles(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, approval_scope, approval_role),
  check (approval_scope in ('quarter_reopen')),
  check (approval_role in ('owner', 'finance_controller'))
);

comment on table public.finance_approval_principals is
  'F5 named approver slots. Quarter reopen requires Ryan McKenzie in owner and Tina McKenzie in finance_controller; profile_id binds once the account exists.';

alter table public.finance_approval_principals enable row level security;

create policy "finance_approval_principals_service_all"
  on public.finance_approval_principals for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "finance_approval_principals_finance_read"
  on public.finance_approval_principals for select
  using (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_read()
  );

-- Approval authority is an identity binding, not owner-editable configuration.
-- Migration 831 adds the audited bind-once service boundary used when an
-- expected principal's production profile becomes available.
revoke insert, update, delete on public.finance_approval_principals
  from public, anon, authenticated;

create trigger set_finance_approval_principals_updated_at
  before update on public.finance_approval_principals
  for each row execute function public.set_updated_at();

insert into public.finance_approval_principals (
  workspace_id, approval_scope, approval_role, expected_name, profile_id
)
values
  (
    'default', 'quarter_reopen', 'owner', 'Ryan McKenzie',
    (
      select p.id
      from public.profiles p
      join public.profile_workspaces pw
        on pw.profile_id = p.id
       and pw.workspace_id = 'default'
      where p.id = '3162f130-021a-45d4-a13c-be98f357a38b'::uuid
        and p.is_active = true
      limit 1
    )
  ),
  (
    'default', 'quarter_reopen', 'finance_controller', 'Tina McKenzie',
    null
  )
on conflict (workspace_id, approval_scope, approval_role) do update set
  expected_name = excluded.expected_name,
  profile_id = coalesce(public.finance_approval_principals.profile_id, excluded.profile_id),
  is_active = true,
  updated_at = now();

create table if not exists public.quarter_reopen_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  period_id uuid not null references public.gl_periods(id) on delete restrict,
  company_id uuid references public.gl_companies(id) on delete set null,
  period_year integer not null,
  period_quarter smallint not null check (period_quarter between 1 and 4),
  reason text not null check (length(trim(reason)) >= 10),
  status text not null default 'pending'
    check (status in ('pending', 'partially_approved', 'approved', 'rejected', 'executed', 'cancelled')),
  requested_by uuid not null references public.profiles(id) on delete restrict,
  requested_at timestamptz not null default now(),
  executed_at timestamptz,
  execution_log_id uuid references public.quarter_reopen_log(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_quarter_reopen_requests_active_period
  on public.quarter_reopen_requests(workspace_id, period_id)
  where status in ('pending', 'partially_approved', 'approved');

create index if not exists idx_quarter_reopen_requests_queue
  on public.quarter_reopen_requests(workspace_id, status, requested_at desc);

create table if not exists public.quarter_reopen_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  request_id uuid not null references public.quarter_reopen_requests(id) on delete cascade,
  approval_role text not null check (approval_role in ('owner', 'finance_controller')),
  approver_id uuid not null references public.profiles(id) on delete restrict,
  decision text not null check (decision in ('approve', 'reject')),
  attestation text not null check (length(trim(attestation)) >= 5),
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (request_id, approval_role),
  unique (request_id, approver_id)
);

comment on table public.quarter_reopen_requests is
  'F5 durable quarter-reopen request. Reopen is impossible until the named owner and finance controller independently attest.';
comment on table public.quarter_reopen_approvals is
  'F5 immutable per-role approval/rejection evidence; one human cannot occupy both slots.';

alter table public.quarter_reopen_requests enable row level security;
alter table public.quarter_reopen_approvals enable row level security;

create policy "quarter_reopen_requests_service_all"
  on public.quarter_reopen_requests for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');
create policy "quarter_reopen_requests_finance_read"
  on public.quarter_reopen_requests for select
  using (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_read()
  );
create policy "quarter_reopen_approvals_service_all"
  on public.quarter_reopen_approvals for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');
create policy "quarter_reopen_approvals_finance_read"
  on public.quarter_reopen_approvals for select
  using (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_read()
  );

create trigger set_quarter_reopen_requests_updated_at
  before update on public.quarter_reopen_requests
  for each row execute function public.set_updated_at();

create or replace function public.quarter_reopen_approvals_block_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'quarter_reopen_approvals is append-only';
end;
$$;

create trigger trg_quarter_reopen_approvals_append_only
  before update or delete on public.quarter_reopen_approvals
  for each row execute function public.quarter_reopen_approvals_block_mutation();

create or replace function public.request_gl_quarter_reopen(
  p_period_id uuid,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
)
returns public.quarter_reopen_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period public.gl_periods;
  v_request public.quarter_reopen_requests;
begin
  if not public.qep_finance_can_mutate() then
    raise exception 'quarter reopen request requires finance/admin privileges';
  end if;
  if (select auth.uid()) is null then
    raise exception 'quarter reopen request requires an authenticated actor';
  end if;
  if nullif(trim(p_reason), '') is null or length(trim(p_reason)) < 10 then
    raise exception 'quarter reopen reason must be at least 10 characters';
  end if;

  select * into v_period
  from public.gl_periods gp
  where gp.id = p_period_id
    and gp.workspace_id = public.get_my_workspace()
  for update;

  if v_period.id is null then
    raise exception 'hard-closed GL period not found in caller workspace';
  end if;
  if coalesce(v_period.quarter_status, v_period.status) <> 'hard_closed'
     and v_period.status <> 'hard_closed' then
    raise exception 'only a hard-closed quarter may be requested for reopen';
  end if;

  insert into public.quarter_reopen_requests (
    workspace_id, period_id, company_id, period_year, period_quarter,
    reason, requested_by, metadata
  )
  values (
    v_period.workspace_id, v_period.id, v_period.company_id,
    v_period.period_year, v_period.period_quarter, trim(p_reason),
    (select auth.uid()), coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_request;

  return v_request;
end;
$$;

create or replace function public.decide_gl_quarter_reopen(
  p_request_id uuid,
  p_decision text,
  p_attestation text
)
returns public.quarter_reopen_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.quarter_reopen_requests;
  v_actor public.profiles;
  v_principal public.finance_approval_principals;
  v_approval_role text;
  v_approve_count integer;
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'decision must be approve or reject';
  end if;
  if nullif(trim(p_attestation), '') is null or length(trim(p_attestation)) < 5 then
    raise exception 'approval attestation must be at least 5 characters';
  end if;

  select * into v_request
  from public.quarter_reopen_requests r
  where r.id = p_request_id
    and r.workspace_id = public.get_my_workspace()
  for update;

  if v_request.id is null or v_request.status not in ('pending', 'partially_approved') then
    raise exception 'quarter reopen request is not awaiting approval';
  end if;

  select * into v_actor
  from public.profiles p
  where p.id = (select auth.uid());

  if v_actor.id is null then
    raise exception 'approval requires an authenticated profile';
  end if;

  v_approval_role := case v_actor.role::text
    when 'owner' then 'owner'
    when 'finance_admin' then 'finance_controller'
    else null
  end;
  if v_approval_role is null then
    raise exception 'quarter reopen approval requires owner or finance_admin role';
  end if;

  select * into v_principal
  from public.finance_approval_principals p
  where p.workspace_id = v_request.workspace_id
    and p.approval_scope = 'quarter_reopen'
    and p.approval_role = v_approval_role
    and p.is_active;

  if v_principal.id is null
     or (
       v_principal.profile_id is not null
       and v_principal.profile_id <> v_actor.id
     )
     or (
       v_principal.profile_id is null
       and lower(trim(v_actor.full_name)) <> lower(trim(v_principal.expected_name))
     ) then
    raise exception 'actor is not the named % quarter-reopen principal', v_approval_role;
  end if;

  insert into public.quarter_reopen_approvals (
    workspace_id, request_id, approval_role, approver_id, decision, attestation
  )
  values (
    v_request.workspace_id, v_request.id, v_approval_role, v_actor.id,
    p_decision, trim(p_attestation)
  );

  if p_decision = 'reject' then
    update public.quarter_reopen_requests
    set status = 'rejected', updated_at = now()
    where id = v_request.id
    returning * into v_request;
    return v_request;
  end if;

  select count(*) into v_approve_count
  from public.quarter_reopen_approvals a
  where a.request_id = v_request.id
    and a.decision = 'approve';

  update public.quarter_reopen_requests
  set status = case when v_approve_count = 2 then 'approved' else 'partially_approved' end,
      updated_at = now()
  where id = v_request.id
  returning * into v_request;

  return v_request;
end;
$$;

create or replace function public.execute_gl_quarter_reopen(
  p_request_id uuid
)
returns public.quarter_reopen_log
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.quarter_reopen_requests;
  v_owner_id uuid;
  v_controller_id uuid;
  v_log public.quarter_reopen_log;
begin
  select * into v_request
  from public.quarter_reopen_requests r
  where r.id = p_request_id
    and (
      (select auth.role()) = 'service_role'
      or r.workspace_id = public.get_my_workspace()
    )
  for update;

  if v_request.id is null or v_request.status <> 'approved' then
    raise exception 'quarter reopen request is not fully approved';
  end if;
  if (select auth.role()) is distinct from 'service_role'
     and not public.qep_finance_can_mutate() then
    raise exception 'quarter reopen execution requires finance/admin privileges';
  end if;

  select a.approver_id into v_owner_id
  from public.quarter_reopen_approvals a
  where a.request_id = v_request.id
    and a.approval_role = 'owner'
    and a.decision = 'approve';

  select a.approver_id into v_controller_id
  from public.quarter_reopen_approvals a
  where a.request_id = v_request.id
    and a.approval_role = 'finance_controller'
    and a.decision = 'approve';

  if v_owner_id is null or v_controller_id is null or v_owner_id = v_controller_id then
    raise exception 'quarter reopen requires two independent recorded approvals';
  end if;

  v_log := public.reopen_gl_quarter(
    v_request.period_id,
    v_owner_id,
    v_controller_id,
    v_request.reason,
    v_request.metadata || jsonb_build_object('quarter_reopen_request_id', v_request.id)
  );

  update public.quarter_reopen_requests
  set
    status = 'executed',
    executed_at = now(),
    execution_log_id = v_log.id,
    updated_at = now()
  where id = v_request.id;

  return v_log;
end;
$$;

-- Retire the one-call authenticated bypass. Only the controlled execution RPC
-- (or an internal service job) may call the historical low-level function.
revoke all on function public.reopen_gl_quarter(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.reopen_gl_quarter(uuid, uuid, uuid, text, jsonb)
  to service_role;

revoke all on function public.request_gl_quarter_reopen(uuid, text, jsonb)
  from public, anon;
revoke all on function public.decide_gl_quarter_reopen(uuid, text, text)
  from public, anon;
revoke all on function public.execute_gl_quarter_reopen(uuid)
  from public, anon;
grant execute on function public.request_gl_quarter_reopen(uuid, text, jsonb)
  to authenticated;
grant execute on function public.decide_gl_quarter_reopen(uuid, text, text)
  to authenticated;
grant execute on function public.execute_gl_quarter_reopen(uuid)
  to authenticated, service_role;

update public.qep_roadmap_tasks
set
  evidence_link = concat_ws(' | ', nullif(evidence_link, ''), 'supabase/migrations/827_finance_numbering_and_quarter_reopen_approvals.sql'),
  notes = coalesce(notes, '') || E'\n[2026-07-20] F5/F7: canonical five-digit E/R/P/W minting is workspace-guarded; existing counters remain monotonic. Quarter reopen now requires independent named Ryan/Tina attestations before execution.',
  updated_at = now()
where task_id in ('K3.1', 'M0.1');

commit;

-- Rollback / fix-forward notes:
--   Preserve issued finance numbers and quarter-reopen attestations. To
--   disable this release, revoke execute on the new numbering/reopen RPCs and
--   stop creating new requests; do not delete sequence or approval evidence.
--   Any principal correction must be a new audited migration because an
--   already-used identity binding is part of the accounting audit trail.
