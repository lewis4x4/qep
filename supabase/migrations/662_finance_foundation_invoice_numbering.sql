-- 662_finance_foundation_invoice_numbering.sql
--
-- Finance foundation Part 1: branch-prefixed invoice numbering.
--
-- Rollback notes:
--   drop function if exists public.qep_next_finance_invoice_number(text, text, text, uuid);
--   drop function if exists public.qep_next_finance_invoice_number(text, uuid, text, uuid);
--   drop function if exists public.qep_finance_config_value(text, text);
--   drop function if exists public.qep_finance_can_mutate();
--   drop function if exists public.qep_finance_can_read();
--   drop trigger if exists set_finance_invoice_sequences_updated_at on public.finance_invoice_sequences;
--   drop trigger if exists set_finance_foundation_config_updated_at on public.finance_foundation_config;
--   drop table if exists public.finance_invoice_sequences;
--   drop table if exists public.finance_foundation_config;
--   drop index if exists public.uq_customer_invoices_qep_invoice_number;
--   drop index if exists public.idx_customer_invoices_qep_invoice_number;
--   alter table public.customer_invoices drop column if exists qep_invoice_number;
--   alter table public.customer_invoices drop column if exists invoice_department_code;
--   alter table public.branches drop column if exists legacy_invoice_branch_code;

create or replace function public.qep_finance_can_read()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'finance_admin');
$$;

create or replace function public.qep_finance_can_mutate()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select public.get_my_role())::text, '') in ('admin', 'owner', 'finance_admin');
$$;

revoke execute on function public.qep_finance_can_read() from public;
revoke execute on function public.qep_finance_can_mutate() from public;
grant execute on function public.qep_finance_can_read() to authenticated;
grant execute on function public.qep_finance_can_mutate() to authenticated;

create table if not exists public.finance_foundation_config (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  company_id uuid references public.gl_companies(id) on delete cascade,
  config_key text not null,
  config_value jsonb not null,
  safe_default jsonb not null,
  authorizing_question text,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.finance_foundation_config is
  'Workspace-scoped finance foundation configuration for open AUTHORIZE-class values. Stores safe defaults without hard-coding business decisions in functions.';
comment on column public.finance_foundation_config.authorizing_question is
  'Spec or owner-question reference for the unresolved business decision behind this config row.';

create unique index if not exists uq_finance_foundation_config_scope_key
  on public.finance_foundation_config (
    workspace_id,
    coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    config_key
  )
  where deleted_at is null;

alter table public.finance_foundation_config enable row level security;

create policy "finance_foundation_config_service_all"
  on public.finance_foundation_config for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "finance_foundation_config_finance_read"
  on public.finance_foundation_config for select
  using (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_read()
  );

create policy "finance_foundation_config_finance_mutate"
  on public.finance_foundation_config for all
  using (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_mutate()
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_mutate()
  );

create trigger set_finance_foundation_config_updated_at
  before update on public.finance_foundation_config
  for each row execute function public.set_updated_at();

create or replace function public.qep_finance_config_value(
  p_config_key text,
  p_workspace_id text default public.get_my_workspace()
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(c.config_value, c.safe_default)
  from public.finance_foundation_config c
  where c.workspace_id = p_workspace_id
    and c.config_key = p_config_key
    and c.is_active = true
    and c.deleted_at is null
  order by c.company_id nulls first, c.updated_at desc
  limit 1;
$$;

revoke execute on function public.qep_finance_config_value(text, text) from public;
grant execute on function public.qep_finance_config_value(text, text) to authenticated;
grant execute on function public.qep_finance_config_value(text, text) to service_role;

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
  'invoice_pad_width',
  '{"digits": 6}'::jsonb,
  '{"digits": 6}'::jsonb,
  'Round 3 open item: invoice width',
  'Safe default is six digits; five digits caps each branch/department sequence at 99,999.'
)
on conflict do nothing;

alter table public.branches
  add column if not exists legacy_invoice_branch_code text;

comment on column public.branches.legacy_invoice_branch_code is
  'Two-digit legacy invoice branch code used as QEP OS invoice prefix. Distinct from branches.short_code labels such as LC/MY.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'branches_legacy_invoice_branch_code_chk'
  ) then
    alter table public.branches
      add constraint branches_legacy_invoice_branch_code_chk
      check (legacy_invoice_branch_code is null or legacy_invoice_branch_code ~ '^[0-9]{2}$');
  end if;
end $$;

create unique index if not exists uq_branches_legacy_invoice_branch_code
  on public.branches(workspace_id, legacy_invoice_branch_code)
  where legacy_invoice_branch_code is not null and deleted_at is null;

with candidate as (
  select id
  from public.branches
  where workspace_id = 'default'
    and legacy_invoice_branch_code is null
    and deleted_at is null
    and (
      lower(slug) in ('lake-city', 'lake_city', 'lc', '01')
      or lower(short_code) = 'lc'
      or lower(display_name) like '%lake city%'
    )
  order by is_active desc, created_at asc, id asc
  limit 1
)
update public.branches b
set legacy_invoice_branch_code = '01'
from candidate c
where b.id = c.id
  and not exists (
    select 1
    from public.branches existing
    where existing.workspace_id = b.workspace_id
      and existing.legacy_invoice_branch_code = '01'
      and existing.deleted_at is null
  );

with candidate as (
  select id
  from public.branches
  where workspace_id = 'default'
    and legacy_invoice_branch_code is null
    and deleted_at is null
    and (
      lower(slug) in ('belleview', 'my', '02')
      or lower(short_code) = 'my'
      or lower(display_name) like '%belleview%'
    )
  order by is_active desc, created_at asc, id asc
  limit 1
)
update public.branches b
set legacy_invoice_branch_code = '02'
from candidate c
where b.id = c.id
  and not exists (
    select 1
    from public.branches existing
    where existing.workspace_id = b.workspace_id
      and existing.legacy_invoice_branch_code = '02'
      and existing.deleted_at is null
  );

alter table public.customer_invoices
  add column if not exists invoice_department_code text,
  add column if not exists qep_invoice_number text;

comment on column public.customer_invoices.invoice_department_code is
  'Department letter used in QEP OS invoice numbering, for example E, P, S, W, or R.';
comment on column public.customer_invoices.qep_invoice_number is
  'Generated branch-prefixed QEP OS invoice number in format [Branch]-[Department][sequence], for example 02-E000001.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'customer_invoices_department_code_chk'
  ) then
    alter table public.customer_invoices
      add constraint customer_invoices_department_code_chk
      check (invoice_department_code is null or invoice_department_code ~ '^[A-Z0-9]{1,4}$');
  end if;
end $$;

create unique index if not exists uq_customer_invoices_qep_invoice_number
  on public.customer_invoices(workspace_id, qep_invoice_number)
  where qep_invoice_number is not null;

create index if not exists idx_customer_invoices_qep_invoice_number
  on public.customer_invoices(qep_invoice_number)
  where qep_invoice_number is not null;

create table if not exists public.finance_invoice_sequences (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  department_code text not null,
  pad_width integer not null default 6 check (pad_width between 5 and 12),
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, branch_id, department_code),
  check (department_code ~ '^[A-Z0-9]{1,4}$')
);

comment on table public.finance_invoice_sequences is
  'Monotonic per-(branch, department) invoice sequence. Sequences never reset; pad width is initialized from finance_foundation_config.invoice_pad_width.';

create index if not exists idx_finance_invoice_sequences_branch
  on public.finance_invoice_sequences(workspace_id, branch_id, department_code);

alter table public.finance_invoice_sequences enable row level security;

create policy "finance_invoice_sequences_service_all"
  on public.finance_invoice_sequences for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "finance_invoice_sequences_finance_read"
  on public.finance_invoice_sequences for select
  using (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_read()
  );

create policy "finance_invoice_sequences_finance_mutate"
  on public.finance_invoice_sequences for all
  using (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_mutate()
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_mutate()
  );

create trigger set_finance_invoice_sequences_updated_at
  before update on public.finance_invoice_sequences
  for each row execute function public.set_updated_at();

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
  v_department_code text := upper(nullif(trim(p_department_code), ''));
  v_branch_code text;
  v_pad_width integer := 6;
  v_next_sequence bigint;
  v_invoice_number text;
begin
  if (select auth.role()) is distinct from 'service_role' and not public.qep_finance_can_mutate() then
    raise exception 'finance invoice sequence generation requires finance/admin privileges';
  end if;

  if p_workspace_id is null or p_branch_id is null or v_department_code is null then
    raise exception 'workspace, branch, and department are required for QEP invoice numbering';
  end if;

  select b.legacy_invoice_branch_code
    into v_branch_code
  from public.branches b
  where b.id = p_branch_id
    and b.workspace_id = p_workspace_id
    and b.deleted_at is null;

  if v_branch_code is null then
    raise exception 'branch % does not have a legacy invoice branch code', p_branch_id;
  end if;

  select coalesce((public.qep_finance_config_value('invoice_pad_width', p_workspace_id)->>'digits')::integer, 6)
    into v_pad_width;

  v_pad_width := greatest(5, least(coalesce(v_pad_width, 6), 12));

  insert into public.finance_invoice_sequences (
    workspace_id,
    branch_id,
    department_code,
    pad_width,
    last_sequence
  )
  values (
    p_workspace_id,
    p_branch_id,
    v_department_code,
    v_pad_width,
    0
  )
  on conflict (workspace_id, branch_id, department_code) do nothing;

  update public.finance_invoice_sequences s
  set last_sequence = s.last_sequence + 1,
      pad_width = v_pad_width,
      updated_at = now()
  where s.workspace_id = p_workspace_id
    and s.branch_id = p_branch_id
    and s.department_code = v_department_code
  returning s.last_sequence into v_next_sequence;

  v_invoice_number := v_branch_code || '-' || v_department_code || lpad(v_next_sequence::text, v_pad_width, '0');

  if p_invoice_id is not null then
    update public.customer_invoices ci
    set qep_invoice_number = v_invoice_number,
        invoice_department_code = v_department_code,
        updated_at = now()
    where ci.id = p_invoice_id
      and ci.workspace_id = p_workspace_id;
  end if;

  return v_invoice_number;
end;
$$;

comment on function public.qep_next_finance_invoice_number(text, uuid, text, uuid) is
  'Generates a company-unique QEP OS invoice number in [Branch]-[Department][sequence] format. Sequence is per branch and department, monotonic, and never resets.';

revoke execute on function public.qep_next_finance_invoice_number(text, uuid, text, uuid) from public;
grant execute on function public.qep_next_finance_invoice_number(text, uuid, text, uuid) to authenticated;
grant execute on function public.qep_next_finance_invoice_number(text, uuid, text, uuid) to service_role;

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
  select b.id
    into v_branch_id
  from public.branches b
  where b.workspace_id = p_workspace_id
    and b.slug = p_branch_slug
    and b.deleted_at is null
  limit 1;

  if v_branch_id is null then
    raise exception 'branch slug % does not resolve for workspace %', p_branch_slug, p_workspace_id;
  end if;

  return public.qep_next_finance_invoice_number(
    p_workspace_id,
    v_branch_id,
    p_department_code,
    p_invoice_id
  );
end;
$$;

comment on function public.qep_next_finance_invoice_number(text, text, text, uuid) is
  'Slug bridge for existing customer_invoices.branch_id callers. Resolves branches.slug, then delegates to the UUID invoice sequence generator.';

revoke execute on function public.qep_next_finance_invoice_number(text, text, text, uuid) from public;
grant execute on function public.qep_next_finance_invoice_number(text, text, text, uuid) to authenticated;
grant execute on function public.qep_next_finance_invoice_number(text, text, text, uuid) to service_role;
