-- ══════════════════════════════════════════════════════════════════════════════
-- 655 — Branch-Prefixed Invoice Numbering
-- ══════════════════════════════════════════════════════════════════════════════
-- Composes company-wide-unique invoice numbers of the form `01-E1000`:
--   <2-digit branch legacy code>-<1-char dept prefix><zero-padded sequence>
--
-- Dept prefix by invoice_type:
--   equipment=E, parts=P, service=S, rental=R, general=G
--
-- Generation is concurrency-safe: a per-(workspace, branch legacy code, dept)
-- counter row is atomically incremented via INSERT ... ON CONFLICT DO UPDATE
-- ... RETURNING, so parallel callers each receive a distinct sequence value
-- and therefore a distinct invoice number.
--
-- Extends existing schema — does NOT recreate:
--   • public.branches (mig 142) gains a 2-digit legacy_code
--   • public.customer_invoices (mig 082) keeps its unique(workspace_id,
--     invoice_number) which is the company-wide (per-workspace) uniqueness
--     boundary for the composed number.
-- ══════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Branch legacy code ─────────────────────────────────────────────────────
-- 2-digit legacy branch code used as the leading segment of every invoice number.

alter table public.branches
  add column if not exists legacy_code text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'branches_legacy_code_format_chk'
      and conrelid = 'public.branches'::regclass
  ) then
    alter table public.branches
      add constraint branches_legacy_code_format_chk
      check (legacy_code is null or legacy_code ~ '^[0-9]{2}$');
  end if;
end
$$;

comment on column public.branches.legacy_code is
  '2-digit legacy branch code (e.g. "01") used as the leading segment of composed invoice numbers.';

-- Company-wide-unique legacy code per workspace (ignoring soft-deleted rows).
create unique index if not exists branches_ws_legacy_code_uidx
  on public.branches(workspace_id, legacy_code)
  where legacy_code is not null and deleted_at is null;

-- ── 2. Per-(branch, dept) sequence counters ───────────────────────────────────

create table if not exists public.invoice_number_sequences (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  branch_legacy_code text not null,
  dept_prefix text not null check (dept_prefix in ('E', 'P', 'S', 'R', 'G')),
  next_value bigint not null default 1000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, branch_legacy_code, dept_prefix)
);

comment on table public.invoice_number_sequences is
  'Per-(workspace, branch legacy code, dept prefix) monotonic counter backing concurrency-safe invoice number generation.';

create trigger set_invoice_number_sequences_updated_at
  before update on public.invoice_number_sequences
  for each row execute function public.set_updated_at();

-- ── 2a. RLS ───────────────────────────────────────────────────────────────────

alter table public.invoice_number_sequences enable row level security;

create policy "invoice_number_sequences_select" on public.invoice_number_sequences
  for select
  using (workspace_id = (select public.get_my_workspace()));

create policy "invoice_number_sequences_insert" on public.invoice_number_sequences
  for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin', 'manager', 'owner')
  );

create policy "invoice_number_sequences_update" on public.invoice_number_sequences
  for update
  using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin', 'manager', 'owner')
  );

-- The SECURITY DEFINER generator function bypasses the role gate via service_role.
create policy "invoice_number_sequences_service_all" on public.invoice_number_sequences
  for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

-- ── 3. Concurrency-safe generator ─────────────────────────────────────────────

create or replace function public.next_invoice_number(
  p_workspace_id text,
  p_branch_legacy_code text,
  p_invoice_type text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dept_prefix text;
  v_next bigint;
begin
  -- Map invoice_type → dept prefix.
  v_dept_prefix := case lower(coalesce(p_invoice_type, 'general'))
    when 'equipment' then 'E'
    when 'parts'     then 'P'
    when 'service'   then 'S'
    when 'rental'    then 'R'
    when 'general'   then 'G'
    else null
  end;

  if v_dept_prefix is null then
    raise exception 'Unsupported invoice_type for invoice numbering: %', p_invoice_type;
  end if;

  if p_branch_legacy_code is null or p_branch_legacy_code !~ '^[0-9]{2}$' then
    raise exception 'Invalid branch legacy code (expected 2 digits): %', p_branch_legacy_code;
  end if;

  -- Atomic upsert-and-increment. Under concurrency each caller either inserts the
  -- seed row (getting 1000) or locks the existing row via the ON CONFLICT DO
  -- UPDATE and receives next_value + 1 — guaranteeing distinct values with no gaps
  -- from lost updates.
  insert into public.invoice_number_sequences (
    workspace_id, branch_legacy_code, dept_prefix, next_value
  )
  values (
    p_workspace_id, p_branch_legacy_code, v_dept_prefix, 1000
  )
  on conflict (workspace_id, branch_legacy_code, dept_prefix)
  do update set next_value = invoice_number_sequences.next_value + 1
  returning next_value into v_next;

  -- Compose `<legacy>-<prefix><value>`, e.g. `01-E1000`.
  return p_branch_legacy_code || '-' || v_dept_prefix || v_next::text;
end;
$$;

comment on function public.next_invoice_number(text, text, text) is
  'Concurrency-safe generator returning a company-wide-unique invoice number of the form 01-E1000 for a workspace/branch legacy code/invoice type.';

-- Only trusted callers may mint invoice numbers.
revoke execute on function public.next_invoice_number(text, text, text) from public, anon;
grant execute on function public.next_invoice_number(text, text, text) to authenticated, service_role;

commit;
